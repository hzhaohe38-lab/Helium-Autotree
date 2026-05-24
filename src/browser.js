/**
 * ============================================
 *  浏览器管理
 *  启动 Chrome / 连接 Edge + 反自动化检测
 * ============================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');
const config = require('../config');
const { logger } = require('./logger');

// ══════════════════════════════════════════════
//  反自动化检测脚本
//  注入到页面，越早越好
// ══════════════════════════════════════════════

/** 字符串形式（避免函数 toString 被检测） */
const STEALTH_SOURCE = `
// === 反自动化检测 v2 ===
(function(){
  try {
    // 1. navigator.webdriver（最重要的！直接在实例上覆盖）
    const nav = navigator;
    if (nav.webdriver !== undefined) {
      Object.defineProperty(nav, 'webdriver', { get: function(){ return undefined; }, configurable: true });
    }
  } catch(e){}

  try {
    // 2. document.documentElement 上的 webdriver 属性
    if (document.documentElement.getAttribute('webdriver') !== null) {
      document.documentElement.removeAttribute('webdriver');
    }
    new MutationObserver(function(){
      if (document.documentElement.getAttribute('webdriver') !== null)
        document.documentElement.removeAttribute('webdriver');
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['webdriver'] });
  } catch(e){}

  try {
    // 3. window.chrome.runtime（真实 Chrome 有）
    if (window.chrome) {
      window.chrome.runtime = window.chrome.runtime || {};
      window.chrome.runtime.connect = window.chrome.runtime.connect || function(){
        return { onMessage: { addListener: function(){} }, onDisconnect: { addListener: function(){} }, postMessage: function(){} };
      };
      window.chrome.runtime.sendMessage = window.chrome.runtime.sendMessage || function(){};
    }
  } catch(e){}

  try {
    // 4. navigator.languages
    Object.defineProperty(Navigator.prototype, 'languages', { get: function(){ return ['zh-CN','zh','en']; }, configurable: true });
  } catch(e){}

  try {
    // 5. navigator.plugins（真实浏览器不为空）
    var pl = [
      { name:'Chrome PDF Plugin', filename:'internal-pdf-viewer', description:'Portable Document Format' },
      { name:'Chrome PDF Viewer', filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', description:'' },
      { name:'Native Client', filename:'internal-nacl-plugin', description:'' },
    ];
    var arr = Object.create(PluginArray.prototype);
    pl.forEach(function(p,i){ arr[i]=p; });
    arr.length = pl.length;
    arr.item = function(i){ return arr[i]||null; };
    arr.namedItem = function(){ return null; };
    Object.defineProperty(Navigator.prototype, 'plugins', { get: function(){ return arr; }, configurable: true });
  } catch(e){}

  try {
    // 6. navigator.permissions
    var q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (desc.name === 'notifications')
        return Promise.resolve({ state:'prompt', onchange:null });
      return q(desc);
    };
  } catch(e){}

  try {
    // 7. 清除可能的自动化痕迹变量
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('$cdc_') === 0 || keys[i].indexOf('$chrome_') === 0) {
        delete window[keys[i]];
      }
    }
  } catch(e){}

  try {
    // 8. navigator.deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', { get: function(){ return 8; }, configurable: true });
  } catch(e){}

  try {
    // 9. navigator.hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: function(){ return 8; }, configurable: true });
  } catch(e){}

  try {
    // 10. chrome.csi / chrome.loadTimes（真实 Chrome 有）
    if (window.chrome) {
      window.chrome.csi = window.chrome.csi || function(){ return {}; };
      window.chrome.loadTimes = window.chrome.loadTimes || function(){ return {}; };
    }
  } catch(e){}

  try {
    // 11. screen 属性一致性
    var sw = screen.width, sh = screen.height;
    if (screen.availWidth === 0 || screen.availHeight === 0) {
      Object.defineProperty(screen, 'availWidth', { get: function(){ return sw; }, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: function(){ return sh; }, configurable: true });
    }
  } catch(e){}
})();
`;

/** 对已加载的页面执行反检测 */
async function applyStealthToPage(page) {
  try {
    await page.evaluate(STEALTH_SOURCE);
  } catch {}
}

// ══════════════════════════════════════════════
//  Edge 查找与自动启动
// ══════════════════════════════════════════════

function findEdge() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function portReady(port, timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    function check() {
      if (Date.now() - start > timeout) { resolve(false); return; }
      const s = new net.Socket();
      s.setTimeout(800);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => { s.destroy(); setTimeout(check, 400); });
      s.on('timeout', () => { s.destroy(); setTimeout(check, 400); });
      s.connect(port, '127.0.0.1');
    }
    check();
  });
}

async function launchEdge(port = 9222) {
  const exe = findEdge();
  if (!exe) throw new Error('未找到 Edge 浏览器');

  logger.info('正在结束残留 Edge 进程...');
  try {
    require('child_process').execSync('taskkill /f /im msedge.exe >nul 2>nul', { stdio: 'ignore' });
  } catch {}
  await new Promise(r => setTimeout(r, 1500));

  const userDataDir = path.join(os.tmpdir(), 'zhs-edge-' + Date.now());
  logger.info('正在启动 Edge（调试端口 ' + port + '）...');

  const child = spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir="${userDataDir}"`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    'https://www.zhihuishu.com/',
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();

  logger.info('等待 Edge 就绪...');
  const ready = await portReady(port, 15000);
  if (!ready) throw new Error('Edge 启动超时');

  logger.info('Edge 已就绪，正在连接...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  for (const p of context.pages()) await applyStealthToPage(p);

  logger.info('已连接到 Edge ✅');
  return { browser, context };
}

// ══════════════════════════════════════════════
//  启动自有 Chromium
// ══════════════════════════════════════════════

async function createBrowser() {
  logger.info('正在启动 Chromium 浏览器...');

  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      '--start-maximized',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
    ],
  });

  const context = await browser.newContext({
    viewport: config.viewport,
    locale: 'zh-CN',
    permissions: [],
  });

  // addInitScript 会在页面任何脚本之前执行
  await context.addInitScript(STEALTH_SOURCE);

  const page = await context.newPage();
  page.on('crash', () => logger.error('页面已崩溃！'));
  page.on('pageerror', (err) => logger.debug('页面 JS 错误:', err.message));

  logger.info('浏览器启动完成 ✅（反自动化检测已启用）');
  return { browser, context, page };
}

// ══════════════════════════════════════════════
//  连接到已有浏览器
// ══════════════════════════════════════════════

async function attachToBrowser(port = 9222, autoLaunch = true) {
  const url = `http://127.0.0.1:${port}`;
  logger.info('正在连接 ' + url + ' ...');

  if (await portReady(port, 3000)) {
    logger.info('检测到浏览器调试端口，正在连接...');
    const browser = await chromium.connectOverCDP(url);
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    for (const p of context.pages()) await applyStealthToPage(p);
    logger.info('已成功连接到浏览器 ✅');
    return { browser, context, launched: false };
  }

  if (!autoLaunch) throw new Error('连接失败，未找到调试端口 ' + port);

  logger.warn('未检测到已有调试端口，自动启动 Edge...');
  return await launchEdge(port);
}

async function closeBrowser(browser, isAttached = false) {
  try {
    if (isAttached) { await browser.disconnect(); logger.info('已断开连接'); }
    else { await browser.close(); logger.info('浏览器已关闭'); }
  } catch {}
}

module.exports = { createBrowser, attachToBrowser, closeBrowser, applyStealthToPage, STEALTH_SOURCE };

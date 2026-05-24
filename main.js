#!/usr/bin/env node

/**
 * ==========================================================
 *  智慧树 (Zhihuishu) 网课自动化辅助脚本 — 主程序
 *  版本: 1.0.0
 *
 *  用途:
 *    - 自动播放视频 (1.5倍速)
 *    - 自动处理课堂互动（不计分弹题）
 *    - 自动切换到下一节
 *    - 自动恢复播放异常
 *    - 图形控制面板（暂停/恢复/统计）
 *
 *  不处理:
 *    - 单元检测 / 章节测验 / 考试（计分内容）
 *
 *  运行:
 *    npm start
 *    手动登录智慧树，打开视频页面即可
 * ==========================================================
 */

const config = require('./config');
const { logger, formatTime } = require('./src/logger');
const { sleep, randomDelay, randomMouseMove, isPageAlive, captureScreenshot, showRipple, ensureRippleCSS } = require('./src/utils');
const { createBrowser, attachToBrowser, closeBrowser, applyStealthToPage, STEALTH_SOURCE } = require('./src/browser');
const { ControlPanel } = require('./src/ui');
const {
  findVideoFrame,
  getVideoStatus,
} = require('./src/frame-finder');
const {
  ensureVideoPlaying,
  checkStall,
  handleStall,
} = require('./src/video-controller');
const {
  detectInteraction,
  handleInteraction,
} = require('./src/interaction');
const {
  isVideoEnded,
  detectTestPage,
  handleResumePopup,
  goToNextSection,
} = require('./src/navigation');

// ══════════════════════════════════════════════
//  全局状态
// ══════════════════════════════════════════════

const state = {
  videoFrame: null,
  lastCurrentTime: 0,
  stallCount: 0,
  refreshRetries: 0,
  videoEnded: false,
  noVideoFrames: 0,
  interactionCooldown: 0,
  interactionCount: 0,
  paused: false,             // 由控制面板控制
  mainPage: null,            // 智慧树页面
  panel: null,               // 控制面板实例
  videoClickCounter: 0,      // 定时点击视频计数器
  shouldExit: false,          // 退出标记
};

// 退出信号，用于优雅退出（不记作异常）
class ExitSignal extends Error { constructor() { super('ExitSignal'); this.name = 'ExitSignal'; } }

// ══════════════════════════════════════════════
//  MutationObserver 注入
// ══════════════════════════════════════════════

const OBSERVER_SCRIPT = `
(function() {
  if (window.__zhsObserverInstalled) return;
  window.__zhsObserverInstalled = true;
  new MutationObserver(function(mutations) {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        window.dispatchEvent(new CustomEvent('zhs-dom-changed', { detail: { time: Date.now() } }));
        break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'display'] });
  new MutationObserver(function(mutations) {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        window.dispatchEvent(new CustomEvent('zhs-dom-changed', { detail: { time: Date.now() } }));
        break;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

async function injectObserver(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try { await frame.evaluate(OBSERVER_SCRIPT); } catch { /* 跨域跳过 */ }
  }
}

// ─── 页面可见性覆盖 ──────────────────────────
// 防止智慧树检测到标签页被隐藏/最小化后暂停视频
const VISIBILITY_OVERRIDE = `
(function() {
  // 仅覆盖属性，让页面始终认为自己是可见的
  // 不拦截 addEventListener，避免被检测
  try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); } catch(e){}
  try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch(e){}
  try { document.dispatchEvent(new Event('visibilitychange')); } catch(e){}
})();
`;

/**
 * 注入可见性覆盖到页面及所有同源 iframe
 * 这样即使窗口最小化，智慧树也以为页面可见，不会暂停视频
 */
async function injectVisibilityOverride(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try { await frame.evaluate(VISIBILITY_OVERRIDE); } catch { /* 跨域跳过 */ }
  }
}

// ══════════════════════════════════════════════
//  页面恢复
// ══════════════════════════════════════════════

async function recoverPage(page) {
  logger.warn('页面可能已崩溃，尝试恢复...');
  state.panel.addLog('warn', '页面可能已崩溃，尝试恢复');
  await captureScreenshot(page, 'crash');
  try {
    const url = page.url();
    if (url && url.includes('zhihuishu')) {
      logger.info('刷新页面: ' + url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      await injectObserver(page);
      await injectVisibilityOverride(page);
      state.refreshRetries = 0;
      state.panel.addLog('ok', '页面已刷新恢复');
      return true;
    }
  } catch (e) {
    logger.error('恢复失败:', e.message);
    state.refreshRetries++;
  }
  return false;
}

// ══════════════════════════════════════════════
//  主循环
// ══════════════════════════════════════════════

async function runMainLoop() {
  const page = state.mainPage;
  const panel = state.panel;

  logger.divider();
  logger.info('主循环已启动');
  panel.addLog('ok', '自动化已启动');
  panel.setStatus('运行中');
  state.paused = false;

  while (true) {
    if (state.shouldExit) { break; }
    try {
      // ── 暂停检测 ──
      while (state.paused) {
        if (state.shouldExit) { break; }
        panel.setStatus('已暂停');
        await panel.refresh();
        await sleep(1000);
      }
      if (state.shouldExit) break;
      panel.setStatus('运行中');

      // ── 1. 检查页面是否活着 ──
      if (!(await isPageAlive(page))) {
        logger.error('页面无响应');
        panel.addLog('error', '页面无响应，尝试恢复');
        const recovered = await recoverPage(page);
        if (!recovered) {
          panel.addLog('error', '无法恢复，等待手动处理');
          await sleep(10000);
        }
        await sleep(config.checkInterval);
        continue;
      }

      // ── 2. 单元检测页面跳过 ──
      if (await detectTestPage(page)) {
        panel.setStatus('检测到测试页');
        panel.addLog('warn', '检测到单元检测，暂停自动化（等待用户完成）');
        // 每 10 秒检查是否离开
        while (await detectTestPage(page)) {
          await panel.refresh();
          await sleep(5000);
        }
        panel.addLog('ok', '已离开测试页，继续自动化');
        continue;
      }

      // ── 3. 查找视频 frame ──
      state.videoFrame = await findVideoFrame(page);

      if (!state.videoFrame) {
        state.noVideoFrames++;
        if (state.noVideoFrames === 3) {
          panel.addLog('warn', '未检测到视频，等待中...');
        }
        if (state.noVideoFrames > 8) {
          if (state.refreshRetries < config.maxRefreshRetries) {
            panel.addLog('warn', '长时间未检测到视频，刷新页面');
            await recoverPage(page);
            state.refreshRetries++;
            state.noVideoFrames = 0;
            await sleep(config.refreshCooldown);
          } else {
            panel.addLog('error', '多次刷新仍未找到视频');
            state.refreshRetries = 0;
            await sleep(10000);
          }
        }
        panel.setStatus('等待视频...');
        await panel.refresh();
        await sleep(config.checkInterval);
        continue;
      }
      state.noVideoFrames = 0;

      // ── 4. 注入 Observer + 可见性覆盖 + 反检测重刷 + 浮窗检查 ──
      await injectObserver(page);
      await injectVisibilityOverride(page);
      // 定期重刷反检测（每 30 次循环 ≈ 每 1-2 分钟）
      state.stealthTick = (state.stealthTick || 0) + 1;
      if (state.stealthTick % 30 === 0) {
        await applyStealthToPage(page);
      }
      await state.panel.ensureInjected();

      // ── 5. 检查互动题 ──
      if (state.interactionCooldown < Date.now()) {
        const hasInteraction = await detectInteraction(page);
        if (hasInteraction) {
          state.interactionCooldown = Date.now() + 5000;
          panel.addLog('info', '检测到课堂互动题');
          await handleInteraction(page);
          state.interactionCount++;
          panel.incrementInteraction();
          panel.addLog('ok', '课堂互动题已处理（累计 ' + state.interactionCount + ' 次）');
          await sleep(config.checkInterval);
          continue;
        }
      }

      // ── 6. 处理"继续学习"弹窗 ──
      await handleResumePopup(page);

      // ── 7. 获取视频状态 ──
      const status = await getVideoStatus(state.videoFrame);
      if (!status.valid) {
        await sleep(config.checkInterval);
        continue;
      }

      // 更新进度
      const percent = status.duration > 0 ? (status.currentTime / status.duration) * 100 : 0;
      panel.updateProgress(status.currentTime, status.duration, percent);

      // 控制台进度
      logger.progress(status.currentTime, status.duration);

      // ── 8. 视频结束 → 下一节 ──
      if (isVideoEnded(status)) {
        if (!state.videoEnded) {
          state.videoEnded = true;
          logger.success('视频播放完毕！');
          panel.addLog('ok', '视频播放完毕，准备进入下一节');
          const navigated = await goToNextSection(page);
          if (navigated) {
            panel.addLog('ok', '已切换到下一节');
          } else {
            panel.addLog('warn', '未找到下一节按钮');
          }
          await sleep(3000);
          state.lastCurrentTime = 0;
          state.stallCount = 0;
        }
        await sleep(config.checkInterval);
        continue;
      }
      state.videoEnded = false;

      // ── 9. 确保播放 + 倍速 ──
      const wasPaused = await ensureVideoPlaying(page, state.videoFrame);
      if (wasPaused) {
        panel.addLog('info', '视频已恢复播放');
      }

      // ── 10. 卡顿检测 ──
      const { stalled, newCount } = checkStall(
        status.currentTime, state.lastCurrentTime, state.stallCount
      );
      state.stallCount = newCount;
      state.lastCurrentTime = status.currentTime;

      if (stalled) {
        panel.addLog('warn', '视频可能卡住，尝试恢复');
        const recovered = await handleStall(page, state.videoFrame);
        if (!recovered) {
          panel.addLog('warn', '恢复失败，刷新页面');
          await recoverPage(page);
        } else {
          panel.addLog('ok', '视频已恢复');
        }
        state.stallCount = 0;
        await sleep(2000);
      }

      // ── 11. 模拟人类行为 ──
      await randomMouseMove(page);

      // 偶尔轻微滚动页面（像真人在看）
      if (Math.random() < 0.1) {
        try { await page.evaluate(function(){ window.scrollBy(0, Math.random()*60-30); }); } catch {}
      }

      // 不定期点击视频区域（模拟查看进度，每 50~80 次循环 ≈ 2~5 分钟一次）
      state.videoClickCounter++;
      if (state.videoClickCounter > 50 + Math.floor(Math.random() * 30) && state.videoFrame) {
        state.videoClickCounter = 0;
        try {
          const box = await state.videoFrame.evaluate(function() {
            var v = document.querySelector('video');
            if (!v) return null;
            var r = v.getBoundingClientRect();
            return { x: r.left + r.width * 0.3 + Math.random() * r.width * 0.4, y: r.top + r.height * 0.3 + Math.random() * r.height * 0.4 };
          });
          if (box) {
            // 鼠标先挪过去
            await page.mouse.move(box.x + 50, box.y + 30, { steps: 6 + Math.floor(Math.random() * 6) });
            await sleep(200 + Math.random() * 400);
            await page.mouse.move(box.x, box.y, { steps: 3 + Math.floor(Math.random() * 3) });
            // 显示波纹
            await ensureRippleCSS(page);
            await showRipple(page, box.x, box.y);
            await sleep(100 + Math.random() * 150);
            await page.mouse.click(box.x, box.y);
            await sleep(100 + Math.random() * 200);
            // 点完后微移
            await page.mouse.move(box.x + (Math.random() - 0.5) * 30, box.y + (Math.random() - 0.5) * 20, { steps: 3 });
            logger.debug('已点击视频区域（模拟查看进度）');
          }
        } catch(e) {
          logger.debug('点击视频区域失败:', e.message);
        }
      }

      // ── 12. 刷新控制面板 ──
      await panel.refresh();

      // ── 13. 随机等待（非固定间隔，防检测） ──
      // 基础间隔 + 随机偏移，每 10-15 次循环额外休息一次
      var baseWait = config.checkInterval;
      var jitter = Math.floor(Math.random() * 1500);
      var extraRest = (Math.floor(Math.random() * 15) === 0) ? 2000 + Math.floor(Math.random() * 3000) : 0;
      var waitMs = baseWait + jitter + extraRest;
      await sleep(Math.min(waitMs, 6000));

    } catch (error) {
      logger.error('主循环异常:', error.message);
      state.panel.addLog('error', '异常: ' + error.message);
      await captureScreenshot(page, 'fatal_error');
      await sleep(3000);
      if (!(await isPageAlive(page))) {
        await recoverPage(page);
      }
    }
  }
}

// ══════════════════════════════════════════════
//  启动流程
// ══════════════════════════════════════════════

async function main() {
  console.log('');
  logger.divider();
  logger.info('智慧树网课自动化辅助脚本 v1.0.0');
  logger.info('='.repeat(42));
  logger.info('  ✅ 自动播放视频 (1.5倍速)');
  logger.info('  ✅ 自动处理课堂互动');
  logger.info('  ✅ 自动切换下一节');
  logger.info('  ❌ 不处理单元检测/考试');
  logger.info('  🖥  图形控制面板');
  logger.info('='.repeat(42));
  logger.divider();

  // ─── 解析命令行参数 ─────────────────────
  const isAttach = process.argv.includes('--attach');

  // --headless: 无窗口模式运行（完全后台）
  if (process.argv.includes('--headless')) {
    config.headless = true;
    logger.info('无窗口模式已启用（--headless）');
  }

  // 提取 --attach=PORT 中的端口号
  let attachPort = 9222;
  const attachArg = process.argv.find(a => a.startsWith('--attach='));
  if (attachArg) {
    attachPort = parseInt(attachArg.split('=')[1], 10) || 9222;
  }

  if (process.argv.includes('--debug')) {
    require('./src/logger').logger.debugMode = true;
    logger.info('调试模式已启用');
  }

  // ─── 连接/启动浏览器 ─────────────────────
  let browser, context, page;
  if (isAttach) {
    // attach 模式：连 Edge，连不上就自动启动
    logger.info('--attach 模式：连接或自动启动 Edge');
    const result = await attachToBrowser(attachPort, true);
    browser = result.browser;
    context = result.context;

    // 确保新页面自动注入反检测脚本
    context.addInitScript(STEALTH_SOURCE).catch(function(){});

    // 在已有标签页中找智慧树页面
    const pages = context.pages();
    logger.info(`当前有 ${pages.length} 个标签页`);

    let targetPage = null;
    for (const p of pages) {
      const url = p.url();
      if (url.includes('zhihuishu')) {
        targetPage = p;
        logger.info('找到智慧树页面: ' + url.slice(0, 80));
        break;
      }
    }
    if (!targetPage) {
      // 没有智慧树页面 → 导航到智慧树首页
      targetPage = pages[pages.length - 1] || (await context.newPage());
      logger.info('未找到智慧树页面，正在导航到 zhihuishu.com...');
      await targetPage.goto('https://www.zhihuishu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(e => logger.warn('导航到智慧树失败:', e.message));
    }

    page = targetPage;
    state.mainPage = page;
    await page.bringToFront();

    // 监听新标签页
    context.on('page', async (newPage) => {
      if (newPage.url().includes('zhihuishu') || newPage.url().includes('player')) {
        logger.debug('检测到新智慧树标签页');
        await applyStealthToPage(newPage);
      }
    });

  } else {
    // 默认模式：启动自有 Chromium
    const result = await createBrowser();
    browser = result.browser;
    context = result.context;
    page = result.page;
    state.mainPage = page;
  }

  // ─── 创建浮窗控制面板 ────────────────────────
  const panel = new ControlPanel(page);
  state.panel = panel;
  // 等进入视频页面后再注入浮窗

  // 面板暂停/恢复回调
  panel.onToggle = (paused) => {
    state.paused = paused;
    if (paused) {
      panel.setStatus('已暂停');
      panel.addLog('warn', '自动化已暂停（用户操作）');
    } else {
      panel.setStatus('运行中');
      panel.addLog('ok', '自动化已恢复（用户操作）');
    }
    logger.info('自动化' + (paused ? '已暂停' : '已恢复'));
  };

  // ─── 等待视频页面 ────────────────────────
  try {
    if (isAttach) {
      // 附加模式：用户已在视频页面，直接检测
      panel.addLog('info', '已连接到浏览器，检测视频中...');
      panel.setStatus('检测视频中...');
      await sleep(2000);
    } else {
      // 自有模式：导航到智慧树首页
      panel.addLog('info', '正在打开智慧树...');
      panel.setStatus('页面加载中');
      await page.goto('https://www.zhihuishu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      logger.divider();
      logger.info('请在浏览器中手动登录 → 进入视频页面');
      panel.addLog('info', '请在智慧树页面手动登录');
      panel.addLog('info', '登录后点击进入任意课程视频');
      panel.setStatus('等待登录...');
    }

    // 等待检测到视频
    let videoFound = false;
    let waitCounter = 0;
    while (!videoFound) {
      if (state.shouldExit) break;
      await sleep(3000);
      await injectObserver(page);
      await injectVisibilityOverride(page);

      const vf = await findVideoFrame(page);
      if (vf) {
        videoFound = true;
        logger.success('检测到视频页面！');
        // 注入浮窗控制面板
        await panel.inject();
        panel.addLog('ok', '检测到视频页面，开始自动化');
        panel.setStatus('运行中');
        panel.stats.running = true;
        break;
      }

      waitCounter++;
      if (waitCounter % 10 === 0) {
        const url = page.url();
        logger.info(`等待视频页面... 当前: ${url.slice(0, 60)}`);
        panel.addLog('info', `等待视频页面 (${url.slice(0, 40)})`);
      }
      panel.setStatus('等待视频页面...');
      await panel.refresh();
    }

    // 进入主循环
    if (state.shouldExit) { throw new ExitSignal(); }
    panel.stats.running = true;
    await runMainLoop();

  } catch (error) {
    if (error instanceof ExitSignal) {
      logger.info('收到退出信号，正在关闭...');
      if (panel) panel.addLog('info', '自动化已停止');
    } else {
      logger.error('脚本异常退出:', error.message);
      if (panel) panel.addLog('error', '脚本异常退出: ' + error.message);
      await captureScreenshot(page, 'fatal');
    }
  } finally {
    if (panel) {
      panel.setStatus('已停止');
      await panel.refresh();
    }
    logger.info('脚本已停止');
    if (panel) await panel.close();
    await closeBrowser(browser, isAttach);
  }
}

// ══════════════════════════════════════════════
//  启动
// ══════════════════════════════════════════════

process.on('SIGINT', () => {
  if (state.shouldExit) return;
  console.log('\n');
  logger.info('收到中断信号，正在退出...');
  state.shouldExit = true;
  // 安全兜底：8 秒后强制退出
  setTimeout(function(){ process.exit(0); }, 8000).unref();
});

process.on('unhandledRejection', (err) => {
  logger.error('未处理的 Promise 异常:', err.message);
});

main();

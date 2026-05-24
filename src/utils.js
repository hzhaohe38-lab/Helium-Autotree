/**
 * ============================================
 *  工具函数
 *  模拟人类行为、截图、文字匹配等
 * ============================================
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

/** 基础 sleep 函数（Promise 版） */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 在 min ~ max 之间随机等待，模拟人类反应时间 */
async function randomDelay(min = config.randomDelayMin, max = config.randomDelayMax) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(ms);
  return ms;
}

/**
 * 模拟鼠标移动到页面随机位置
 */
async function randomMouseMove(page) {
  if (Math.random() > config.mouseMoveChance) return;
  const x = Math.floor(Math.random() * config.viewport.width);
  const y = Math.floor(Math.random() * config.viewport.height);
  await page.mouse.move(x, y, { steps: 5 });
}

/**
 * 检查页面是否还活着
 */
async function isPageAlive(page) {
  try {
    await page.evaluate(() => 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测页面文字是否包含任意关键词
 */
async function pageContainsText(page, keywords) {
  try {
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    for (const kw of keywords) {
      if (bodyText.includes(kw)) return true;
    }
  } catch {}
  return false;
}

/**
 * 截取页面截图并保存
 */
async function captureScreenshot(page, label = 'debug') {
  const dir = path.resolve(__dirname, '..', 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${label}_${Date.now()}.png`);
  try {
    await page.screenshot({ path: filepath, fullPage: false });
    // 限制截图数量，最多 20 张，超出则删最早
    try {
      const files = fs.readdirSync(dir)
        .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => a.time - b.time);
      if (files.length > 20) {
        for (let i = 0; i < files.length - 20; i++) {
          fs.unlinkSync(path.join(dir, files[i].name));
        }
      }
    } catch {}
    return filepath;
  } catch { return null; }
}

/**
 * 在 frame 中搜索匹配指定文本模式的按钮
 */
async function findClickableByText(frame, patterns) {
  for (const text of patterns) {
    try {
      const byRole = frame.getByRole('button', { name: text, exact: false });
      if ((await byRole.count()) > 0) return byRole.first();
    } catch {}
    try {
      const byText = frame.getByText(text, { exact: false });
      if ((await byText.count()) > 0) return byText.first();
    } catch {}
    try {
      const byXPath = frame.locator(`//*[contains(text(), '${text}')]`).first();
      if ((await byXPath.count()) > 0) return byXPath;
    } catch {}
  }
  return null;
}

// ─── 页面注入：点击波纹效果 ──────────────────
// 蓝色星空流星扩散特效，点击位置生成光晕 + 流星粒子
// 持续 1 秒，外层渐渐消散

/**
 * 将流星特效 CSS 注入页面（只需一次）
 */
async function ensureRippleCSS(page) {
  try {
    await page.evaluate(() => {
      if (document.getElementById('zhs-meteor-style')) return;
      const s = document.createElement('style');
      s.id = 'zhs-meteor-style';
      s.textContent = [
        '@keyframes zhs-meteor-ring{',
          '0%{width:0;height:0;opacity:0.7;box-shadow:0 0 30px rgba(37,99,235,0.5),0 0 60px rgba(59,130,246,0.2)}',
          '40%{opacity:0.5;box-shadow:0 0 50px rgba(37,99,235,0.3),0 0 100px rgba(59,130,246,0.1)}',
          '100%{width:140px;height:140px;opacity:0;box-shadow:0 0 0 rgba(37,99,235,0)}',
        '}',
        '@keyframes zhs-meteor-core{',
          '0%{width:8px;height:8px;opacity:1;box-shadow:0 0 20px rgba(59,130,246,0.9),0 0 60px rgba(37,99,235,0.4)}',
          '40%{opacity:0.7;box-shadow:0 0 30px rgba(59,130,246,0.4),0 0 80px rgba(37,99,235,0.2)}',
          '100%{width:20px;height:20px;opacity:0;transform:translate(-50%,-50%) scale(0.3)}',
        '}',
        '@keyframes zhs-meteor-particle{',
          '0%{opacity:0.9;transform:translate(0,0) scale(1)}',
          '50%{opacity:0.5}',
          '100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0)}',
        '}',
        '@keyframes zhs-meteor-spark{',
          '0%{opacity:0;transform:translate(0,0) scale(0)}',
          '20%{opacity:1;transform:translate(var(--dx),var(--dy)) scale(1)}',
          '100%{opacity:0;transform:translate(var(--sx),var(--sy)) scale(0.2)}',
        '}',
        // ── 红色流星（关闭按钮用） ──
        '@keyframes zhs-meteor-red-ring{',
          '0%{width:0;height:0;opacity:0.7;box-shadow:0 0 30px rgba(220,38,38,0.5),0 0 60px rgba(239,68,68,0.2)}',
          '40%{opacity:0.5;box-shadow:0 0 50px rgba(220,38,38,0.3),0 0 100px rgba(239,68,68,0.1)}',
          '100%{width:140px;height:140px;opacity:0;box-shadow:0 0 0 rgba(220,38,38,0)}',
        '}',
        '@keyframes zhs-meteor-red-core{',
          '0%{width:8px;height:8px;opacity:1;box-shadow:0 0 20px rgba(239,68,68,0.9),0 0 60px rgba(220,38,38,0.4)}',
          '40%{opacity:0.7;box-shadow:0 0 30px rgba(239,68,68,0.4),0 0 80px rgba(220,38,38,0.2)}',
          '100%{width:20px;height:20px;opacity:0;transform:translate(-50%,-50%) scale(0.3)}',
        '}',
        '@keyframes zhs-meteor-red-particle{',
          '0%{opacity:0.9;transform:translate(0,0) scale(1)}',
          '50%{opacity:0.5}',
          '100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0)}',
        '}',
        '@keyframes zhs-meteor-red-spark{',
          '0%{opacity:0;transform:translate(0,0) scale(0)}',
          '20%{opacity:1;transform:translate(var(--dx),var(--dy)) scale(1)}',
          '100%{opacity:0;transform:translate(var(--sx),var(--sy)) scale(0.2)}',
        '}',
      ].join('');
      document.head.appendChild(s);
    });
  } catch {}
}

/**
 * 在页面指定坐标显示蓝色星空流星特效
 * - 主光晕扩散环（渐蓝消散）
 * - 中心亮星（持续发光）
 * - 5 个粒子飞散
 * - 8 个细小星光闪烁
 */
async function showRipple(page, x, y) {
  try {
    await ensureRippleCSS(page);
    await page.evaluate(([cx, cy]) => {
      // 1. 外层蓝色光晕扩散环
      var ring = document.createElement('div');
      ring.style.cssText = [
        'position:fixed;z-index:9999999;pointer-events:none;',
        'left:'+cx+'px;top:'+cy+'px;',
        'width:0;height:0;border-radius:50%;',
        'background:radial-gradient(circle,rgba(59,130,246,0.15),rgba(37,99,235,0.05),transparent);',
        'border:2px solid rgba(59,130,246,0.3);',
        'transform:translate(-50%,-50%);',
        'animation:zhs-meteor-ring 1s cubic-bezier(0,.5,.5,1) forwards;',
      ].join('');
      document.body.appendChild(ring);

      // 2. 中心亮星
      var core = document.createElement('div');
      core.style.cssText = [
        'position:fixed;z-index:9999999;pointer-events:none;',
        'left:'+cx+'px;top:'+cy+'px;',
        'width:8px;height:8px;border-radius:50%;',
        'background:radial-gradient(circle,#93c5fd,#3b82f6,#2563eb);',
        'transform:translate(-50%,-50%);',
        'animation:zhs-meteor-core 1s ease-out forwards;',
      ].join('');
      document.body.appendChild(core);

      // 3. 粒子飞散（5 个方向）
      var colors = ['#60a5fa','#3b82f6','#93c5fd','#bfdbfe','#2563eb'];
      for (var i = 0; i < 5; i++) {
        var angle = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
        var dist = 40 + Math.random() * 50;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        var pt = document.createElement('div');
        pt.style.cssText = [
          'position:fixed;z-index:9999999;pointer-events:none;',
          'left:'+cx+'px;top:'+cy+'px;',
          'width:'+(3+Math.random()*3)+'px;height:'+(3+Math.random()*3)+'px;',
          'border-radius:50%;',
          'background:'+colors[i]+';',
          'box-shadow:0 0 4px '+colors[i]+';',
          'transform:translate(-50%,-50%);',
          '--dx:'+dx+'px;--dy:'+dy+'px;',
          'animation:zhs-meteor-particle 1s ease-out forwards;',
          'animation-delay:'+(Math.random()*0.1)+'s;',
        ].join('');
        document.body.appendChild(pt);
        setTimeout(function(el){ el.remove(); }, 1100, pt);
      }

      // 4. 细小星光闪烁（8 个方向）
      for (var i = 0; i < 8; i++) {
        var angle = (i / 8) * Math.PI * 2;
        var dist = 20 + Math.random() * 30;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        var sx = Math.cos(angle) * (dist + 15 + Math.random() * 20);
        var sy = Math.sin(angle) * (dist + 15 + Math.random() * 20);
        var sp = document.createElement('div');
        sp.style.cssText = [
          'position:fixed;z-index:9999999;pointer-events:none;',
          'left:'+cx+'px;top:'+cy+'px;',
          'width:2px;height:2px;border-radius:50%;',
          'background:#bfdbfe;',
          'box-shadow:0 0 3px #93c5fd;',
          'transform:translate(-50%,-50%);',
          '--dx:'+dx+'px;--dy:'+dy+'px;',
          '--sx:'+sx+'px;--sy:'+sy+'px;',
          'animation:zhs-meteor-spark 0.8s ease-out forwards;',
          'animation-delay:'+(Math.random()*0.15)+'s;',
        ].join('');
        document.body.appendChild(sp);
        setTimeout(function(el){ el.remove(); }, 1000, sp);
      }

      // 清理
      setTimeout(function(el){ el.remove(); }, 1100, ring);
      setTimeout(function(el){ el.remove(); }, 1100, core);
    }, [x, y]);
  } catch {}
}

/**
 * 在页面指定坐标显示红色星空流星特效
 * 与蓝色版本完全一致，仅颜色不同
 */
async function showRippleRed(page, x, y) {
  try {
    await ensureRippleCSS(page);
    await page.evaluate(([cx, cy]) => {
      // 1. 外层红色光晕扩散环
      var ring = document.createElement('div');
      ring.style.cssText = [
        'position:fixed;z-index:9999999;pointer-events:none;',
        'left:'+cx+'px;top:'+cy+'px;',
        'width:0;height:0;border-radius:50%;',
        'background:radial-gradient(circle,rgba(220,38,38,0.15),rgba(239,68,68,0.05),transparent);',
        'border:2px solid rgba(220,38,38,0.3);',
        'transform:translate(-50%,-50%);',
        'animation:zhs-meteor-red-ring 1s cubic-bezier(0,.5,.5,1) forwards;',
      ].join('');
      document.body.appendChild(ring);

      // 2. 中心亮星
      var core = document.createElement('div');
      core.style.cssText = [
        'position:fixed;z-index:9999999;pointer-events:none;',
        'left:'+cx+'px;top:'+cy+'px;',
        'width:8px;height:8px;border-radius:50%;',
        'background:radial-gradient(circle,#fca5a5,#ef4444,#dc2626);',
        'transform:translate(-50%,-50%);',
        'animation:zhs-meteor-red-core 1s ease-out forwards;',
      ].join('');
      document.body.appendChild(core);

      // 3. 粒子飞散（5 个方向）
      var colors = ['#ef4444','#dc2626','#fca5a5','#f87171','#b91c1c'];
      for (var i = 0; i < 5; i++) {
        var angle = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
        var dist = 40 + Math.random() * 50;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        var pt = document.createElement('div');
        pt.style.cssText = [
          'position:fixed;z-index:9999999;pointer-events:none;',
          'left:'+cx+'px;top:'+cy+'px;',
          'width:'+(3+Math.random()*3)+'px;height:'+(3+Math.random()*3)+'px;',
          'border-radius:50%;',
          'background:'+colors[i]+';',
          'box-shadow:0 0 4px '+colors[i]+';',
          'transform:translate(-50%,-50%);',
          '--dx:'+dx+'px;--dy:'+dy+'px;',
          'animation:zhs-meteor-red-particle 1s ease-out forwards;',
          'animation-delay:'+(Math.random()*0.1)+'s;',
        ].join('');
        document.body.appendChild(pt);
        setTimeout(function(el){ el.remove(); }, 1100, pt);
      }

      // 4. 细小星光闪烁（8 个方向）
      for (var i = 0; i < 8; i++) {
        var angle = (i / 8) * Math.PI * 2;
        var dist = 20 + Math.random() * 30;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        var sx = Math.cos(angle) * (dist + 15 + Math.random() * 20);
        var sy = Math.sin(angle) * (dist + 15 + Math.random() * 20);
        var sp = document.createElement('div');
        sp.style.cssText = [
          'position:fixed;z-index:9999999;pointer-events:none;',
          'left:'+cx+'px;top:'+cy+'px;',
          'width:2px;height:2px;border-radius:50%;',
          'background:#fca5a5;',
          'box-shadow:0 0 3px #ef4444;',
          'transform:translate(-50%,-50%);',
          '--dx:'+dx+'px;--dy:'+dy+'px;',
          '--sx:'+sx+'px;--sy:'+sy+'px;',
          'animation:zhs-meteor-red-spark 0.8s ease-out forwards;',
          'animation-delay:'+(Math.random()*0.15)+'s;',
        ].join('');
        document.body.appendChild(sp);
        setTimeout(function(el){ el.remove(); }, 1000, sp);
      }

      // 清理
      setTimeout(function(el){ el.remove(); }, 1100, ring);
      setTimeout(function(el){ el.remove(); }, 1100, core);
    }, [x, y]);
  } catch {}
}

/**
 * ★ 真人风格点击
 * 1. 鼠标缓慢移动到目标
 * 2. 在点击位置显示波纹
 * 3. 点击
 * 4. 随机小抖动
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 * @param {object} [opts]
 * @param {number} [opts.delayBefore] 点击前额外延迟 ms
 */
async function humanClick(page, locator, opts = {}) {
  // 先注入波纹样式
  await ensureRippleCSS(page);

  // 获取元素位置
  const box = await locator.boundingBox();
  if (!box) {
    // fallback: 直接 JS 点击
    await locator.click({ force: true });
    return;
  }

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 额外延迟（模拟犹豫）
  const extra = opts.delayBefore || Math.floor(Math.random() * 400 + 100);
  if (extra > 0) await sleep(extra);

  // 先挪到附近随机位置（人类不会直接瞄准）
  const approachX = cx + (Math.random() - 0.5) * 80;
  const approachY = cy + (Math.random() - 0.5) * 40;
  await page.mouse.move(approachX, approachY, { steps: 8 + Math.floor(Math.random() * 6) });
  await sleep(50 + Math.random() * 120);

  // 挪到目标位置
  await page.mouse.move(cx, cy, { steps: 4 + Math.floor(Math.random() * 4) });
  await sleep(30 + Math.random() * 80);

  // 显示波纹
  await showRipple(page, cx, cy);
  await sleep(80 + Math.random() * 100);

  // 点击
  await page.mouse.click(cx, cy);

  // 点完后稍微偏移（模拟手指抬起后的移动）
  await page.mouse.move(cx + (Math.random() - 0.5) * 20, cy + (Math.random() - 0.5) * 10, { steps: 3 });
}

module.exports = {
  sleep,
  randomDelay,
  randomMouseMove,
  isPageAlive,
  pageContainsText,
  captureScreenshot,
  findClickableByText,
  humanClick,
  ensureRippleCSS,
  showRipple,
  showRippleRed,
};

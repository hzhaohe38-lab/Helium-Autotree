/**
 * ============================================
 *  课堂互动弹题处理
 *  自动检测 → 等待 3-7 秒（像真人）→ 鼠标移动到选项
 *  → 点击（带波纹反馈）→ 确认 → 关闭
 *
 *  关键设计：
 *    全 frame 扫描 —— 搜索所有 iframe 内的交互元素
 *    多种关闭策略 —— Escape → 对话框右上角 → × 图标
 *    → "关闭"文本 → 坐标暴力点击（兜底）
 *    每次点击都显示蓝色流星波纹
 * ============================================
 */

const config = require('../config');
const { logger } = require('./logger');
const { sleep, randomDelay, captureScreenshot, humanClick, showRipple, showRippleRed, ensureRippleCSS } = require('./utils');

/**
 * 检测当前页面是否有课堂互动弹题
 * 搜索所有 frame，不仅仅主页面
 */
async function detectInteraction(page) {
  try {
    const frames = page.frames();

    for (const frame of frames) {
      try {
        const text = await frame.evaluate(() => document.body?.innerText || '');
        const hasConfirm = config.buttonTexts.confirm.some(t => text.includes(t));
        const hasKeyword = config.interactionKeywords.some(k => text.includes(k));
        if (hasConfirm && hasKeyword) {
          logger.info('检测到课堂互动题（frame %d 关键词匹配）', frames.indexOf(frame));
          return true;
        }
      } catch { /* 跨域跳过 */ }
    }

    // 兜底：检查弹窗类元素
    for (const frame of frames) {
      try {
        const hasModal = await frame.evaluate((keywords) => {
          const selectors = [
            '.modal', '.dialog', '.popup', '.mask', '.overlay',
            '[class*="modal"]', '[class*="dialog"]', '[class*="popup"]',
            '[class*="mask"]', '[class*="overlay"]', '[class*="shade"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const text = el.textContent || '';
            if (keywords.some(k => text.includes(k))) return true;
          }
          return false;
        }, config.interactionKeywords);
        if (hasModal) return true;
      } catch { /* 跨域跳过 */ }
    }

    return false;
  } catch (e) {
    logger.debug('检测互动题时出错:', e.message);
    return false;
  }
}

/**
 * 处理检测到的互动题
 * 等待 3~7 秒 → 鼠标移动到选项 → 点击（带波纹）
 * → 等待 → 点击确认 → 关闭弹窗
 */
async function handleInteraction(page) {
  logger.divider();
  logger.info('检测到课堂互动题');

  try {
    await ensureRippleCSS(page);
    await captureScreenshot(page, 'interaction');

    // 等待 3 秒再答题
    logger.info('思考中... 3 秒');
    await sleep(3000);

    // ══════════════════════════════════════════════
    //  固定坐标模式（从 config.js 读取）
    //  坐标系：浏览器**视口左上角**为 (0,0)
    //  如果你的测量是从屏幕左上角算的，需要减去浏览器
    //  标签栏/书签栏的高度（通常 80~120px）
    //  在 config.js 的 fixedCoords 里调整
    // ══════════════════════════════════════════════
    const vp = page.viewportSize();
    logger.info('当前视口: %d×%d', vp ? vp.width : '?', vp ? vp.height : '?');

    const co = config.fixedCoords;
    const optionX = co.option.x;
    const optionY = co.option.y;
    const closeX = co.close.x;
    const closeY = co.close.y;
    const yRange = co.yRange;

    // 随机选择总点击次数：1 次或 3 次（禁止 2 次中间态，防止点掉已选中的选项）
    const isSingleClick = Math.random() < 0.5;
    const totalClicks = isSingleClick ? 1 : 3;
    logger.info('总点击次数: %d', totalClicks);

    logger.info('固定坐标 — 点击选项 (%d, %d)', optionX, optionY);
    await fixedClick(page, optionX, optionY);

    if (!isSingleClick) {
      for (let i = 1; i < 3; i++) {
        logger.info('等待 1 秒后再次点击...');
        await sleep(1000);
        const yOffset = Math.floor(Math.random() * (yRange * 2 + 1)) - yRange;
        const clickY = optionY + yOffset;
        logger.info('固定坐标 — 再点选项 (%d, %d) [偏移 %dpx]', optionX, clickY, yOffset);
        await fixedClick(page, optionX, clickY);
      }
    }

    // ── 2. 选项完成后停顿 2 秒后点关闭 ──
    logger.info('等待 2 秒后关闭...');
    await sleep(2000);

    logger.info('固定坐标 — 点击关闭 (%d, %d) 🔴', closeX, closeY);
    await fixedClickRed(page, closeX, closeY);

    // ── 3. 等弹窗关闭 ──
    await sleep(2000);

    logger.success('课堂互动题处理完成 ✅');
    logger.divider();
    return true;
  } catch (e) {
    logger.error('处理互动题时出错:', e.message);
    await captureScreenshot(page, 'interaction_error');
    return false;
  }
}

/**
 * 固定坐标点击（带蓝色流星波纹）
 */
async function fixedClick(page, x, y) {
  const offset = config.fixedCoords.offset || { x: 0, y: 0 };
  const cx = x + (offset.x || 0);
  const cy = y + (offset.y || 0);

  await page.mouse.move(cx, cy, { steps: 5 + Math.floor(Math.random() * 3) });
  await sleep(30 + Math.random() * 80);
  await ensureRippleCSS(page);
  await showRipple(page, cx, cy);
  await sleep(80 + Math.random() * 120);
  await page.mouse.click(cx, cy);
}

/**
 * 固定坐标点击（带红色流星波纹，用于关闭按钮）
 */
async function fixedClickRed(page, x, y) {
  const offset = config.fixedCoords.offset || { x: 0, y: 0 };
  const cx = x + (offset.x || 0);
  const cy = y + (offset.y || 0);

  await page.mouse.move(cx, cy, { steps: 5 + Math.floor(Math.random() * 3) });
  await sleep(30 + Math.random() * 80);
  await ensureRippleCSS(page);
  await showRippleRed(page, cx, cy);
  await sleep(80 + Math.random() * 120);
  await page.mouse.click(cx, cy);
}

/**
 * 暴力关闭按钮查找器
 *
 * 按优先级依次尝试：
 *   策略 0: 按 Escape 键（大多数弹窗支持）
 *   策略 A: 找对话框容器 → 点击右上角 × 区域
 *   策略 B: 搜索所有 frame 中文本为"×"的元素
 *   策略 C: 搜索所有 frame 中包含"关闭"的短文本元素
 *   策略 D: 在视口右上角暴力点击（兜底）
 *
 * 每步成功后验证弹窗是否消失
 */
async function findAndClickCloseButton(page) {
  await ensureRippleCSS(page);

  // ── 策略0: Escape 键 ──
  logger.info('策略0 — 按 Escape 键');
  await page.keyboard.press('Escape');
  await sleep(800);
  if (!(await detectInteraction(page))) {
    logger.success('Escape 关闭成功 ✅');
    return true;
  }

  // ── 策略1: 搜索 "关闭" 按钮（用户确认的文字） ──
  logger.info('策略1 — 直接搜索"关闭"文字');
  for (const frame of page.frames()) {
    try {
      const closeBtns = frame.getByText('关闭', { exact: true });
      const cnt = await closeBtns.count();
      for (let i = 0; i < cnt; i++) {
        const btn = closeBtns.nth(i);
        const box = await btn.boundingBox();
        if (box && box.width > 30 && box.height > 15) {
          logger.info('策略1 — 点击 "关闭" (%d×%d)', Math.round(box.width), Math.round(box.height));
          await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
          await sleep(1000);
          if (!(await detectInteraction(page))) {
            logger.success('关闭成功 ✅');
            return true;
          }
        }
      }
    } catch { /* 跨域跳过 */ }

    // 也搜"关闭"的父元素（文字可能在子元素里）
    try {
      const anyClose = frame.locator('*').filter({ hasText: '关闭' });
      const cnt = await anyClose.count();
      for (let i = 0; i < Math.min(cnt, 20); i++) {
        const el = anyClose.nth(i);
        const text = ((await el.textContent()) || '').trim();
        if (!text.includes('关闭')) continue;
        if (text.length > 15) continue; // 只匹配短文本
        const box = await el.boundingBox();
        if (!box || box.width < 30 || box.width > 250) continue;
        logger.info('策略1(兜底) — 点击 "%s"', text.substring(0, 8));
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1000);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* 跨域跳过 */ }
  }

  // ── 策略1.5: 定位 .btn 关闭按钮（用户提供的 CSS 类名） ──
  logger.info('策略1.5 — 查找 .btn 关闭按钮');
  for (const frame of page.frames()) {
    try {
      const btns = frame.locator('.btn').filter({ hasText: '关闭' });
      const cnt = await btns.count();
      for (let i = 0; i < cnt; i++) {
        const btn = btns.nth(i);
        const text = ((await btn.textContent()) || '').trim();
        if (!text.includes('关闭')) continue;
        const box = await btn.boundingBox();
        if (!box || box.width < 50 || box.height < 15) continue;
        logger.info('策略1.5 — 点击 .btn "%s" (%d×%d)', text, Math.round(box.width), Math.round(box.height));
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1000);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* 跨域跳过 */ }

    try {
      const btns = frame.locator('.dialog-footer .btn').filter({ hasText: '关闭' });
      const cnt = await btns.count();
      for (let i = 0; i < cnt; i++) {
        const btn = btns.nth(i);
        const box = await btn.boundingBox();
        if (!box || box.width < 50) continue;
        logger.info('策略1.5(精确) — dialog-footer .btn');
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1000);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* 跨域跳过 */ }

    try {
      const btns = frame.locator('.el-dialog__footer .btn, .el-dialog_footer .btn');
      const cnt = await btns.count();
      for (let i = 0; i < cnt; i++) {
        const btn = btns.nth(i);
        const box = await btn.boundingBox();
        if (!box || box.width < 50) continue;
        logger.info('策略1.5(footer) — dialog footer .btn');
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1000);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* 跨域跳过 */ }
  }

  // ── 策略2: 找对话框容器 → 点击右上角 × 区域 ──
  logger.info('策略A — 查找对话框容器');
  const dialogSelectors = [
    '.el-dialog', '.el-dialog__wrapper', '.el-dialog__footer', '.el-dialog_footer',
    '.dialog', '.modal', '.popup', '.message',
    '[class*="dialog"]', '[class*="modal"]', '[class*="popup"]',
    '[class*="shade"]', '[class*="overlay"]', '[class*="message"]',
    '.interact', '[class*="interact"]',
    '.question', '[class*="question"]',
    '.topic', '[class*="topic"]',
    '.el-message-box', '.el-message',
    '.practice', '[class*="practice"]',
    '.answer', '[class*="answer"]',
  ];

  for (const frame of page.frames()) {
    for (const sel of dialogSelectors) {
      try {
        const dialogs = frame.locator(sel);
        const count = await dialogs.count();
        for (let i = 0; i < count; i++) {
          const dlg = dialogs.nth(i);
          const box = await dlg.boundingBox();
          if (!box || box.width < 80 || box.height < 50) continue;

          // × 图标通常在右上角，距离右边缘 50~80px，距离顶部 30~50px
          const cx = box.x + box.width - 60 + Math.floor(Math.random() * 20);
          const cy = box.y + Math.floor(Math.random() * 20) + 20;

          logger.info('策略A — 点击对话框右上角 (%d,%d)', Math.round(cx), Math.round(cy));
          await simpleClickRed(page, cx, cy);
          await sleep(800);
          if (!(await detectInteraction(page))) {
            logger.success('关闭成功 ✅');
            return true;
          }
        }
      } catch { /* 跨域跳过 */ }
    }
  }

  // ── 策略B: 搜索所有 frame 中文本为"×"的元素 ──
  logger.info('策略B — 搜索 "×" 图标');
  for (const frame of page.frames()) {
    try {
      // Playwright getByText
      const elements = frame.getByText('×', { exact: true });
      const cnt = await elements.count();
      for (let i = 0; i < cnt; i++) {
        const el = elements.nth(i);
        const box = await el.boundingBox();
        if (!box || box.width < 5 || box.height < 5) continue;
        logger.info('策略B — 点击 "×" (%d,%d)', Math.round(box.x), Math.round(box.y));
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(800);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* 跨域跳过 */ }

    try {
      // 兜底：locator + filter
      const elements = frame.locator('*').filter({ hasText: '×' });
      const cnt = await elements.count();
      for (let i = 0; i < Math.min(cnt, 20); i++) {
        const el = elements.nth(i);
        const text = (await el.textContent()) || '';
        if (text.trim().replace(/\s/g, '') !== '×') continue;
        if (text.length > 6) continue;
        const box = await el.boundingBox();
        if (!box || box.width < 5 || box.height < 5) continue;
        logger.info('策略B(兜底) — 点击 "×"');
        await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(800);
        if (!(await detectInteraction(page))) {
          logger.success('关闭成功 ✅');
          return true;
        }
      }
    } catch { /* ignore */ }
  }

  // ── 策略C: 搜索"关闭"短文本（兜底） ──
  logger.info('策略C — 搜索 "关闭" 文字');
  for (const kw of ['关闭', '关闭窗口', 'close', '×', '✕', '✖']) {
    for (const frame of page.frames()) {
      try {
        const elements = frame.getByText(kw, { exact: false });
        const cnt = await elements.count();
        for (let i = 0; i < cnt; i++) {
          const el = elements.nth(i);
          const text = ((await el.textContent()) || '').trim();
          if (!text || text.length > 6) continue;
          const box = await el.boundingBox();
          if (!box || box.width < 5 || box.height < 5) continue;
          logger.info('策略C — 点击 "%s"', text);
          await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
          await sleep(800);
          if (!(await detectInteraction(page))) {
            logger.success('关闭成功 ✅');
            return true;
          }
        }
      } catch { /* 跨域跳过 */ }
    }
  }

  // ── 策略D: 暴力坐标点击 ──
  // 弹窗一般在视口中央区域，关闭按钮在右上角
  // 尝试多个常见位置
  logger.info('策略D — 暴力坐标点击');
  const viewport = page.viewportSize() || { width: 1920, height: 1080 };

  // 常见弹窗位置模式：弹窗在视口中央，× 在弹窗右上角
  // 我们直接尝试点击视口中的各个"右上角"位置
  const positions = [];

  // 模式1: 弹窗宽约 400~600px，高约 250~400px，居中
  for (let w = 300; w <= 700; w += 100) {
    for (let h = 150; h <= 350; h += 100) {
      const left = (viewport.width - w) / 2;
      const top = (viewport.height - h) / 2;
      // × 在右上角
      positions.push({ x: left + w - 50, y: top + 25 });
      positions.push({ x: left + w - 40, y: top + 30 });
      positions.push({ x: left + w - 60, y: top + 20 });
    }
  }

  // 模式2: 弹窗从顶部弹出（常见于智慧树）
  for (let w = 400; w <= 800; w += 200) {
    const top = 80;
    for (let offset = 30; offset <= 60; offset += 10) {
      positions.push({ x: w - 50, y: top + offset });
      positions.push({ x: viewport.width - 100, y: top + offset });
    }
  }

  // 模式3: 全屏遮罩，× 在右上角区域
  positions.push({ x: viewport.width - 50, y: 30 });
  positions.push({ x: viewport.width - 70, y: 40 });
  positions.push({ x: viewport.width - 100, y: 50 });

  // 去重 + 执行
  const tried = new Set();
  for (const pos of positions) {
    const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
    if (tried.has(key)) continue;
    tried.add(key);

    logger.info('策略D — 尝试点击 (%d,%d)', Math.round(pos.x), Math.round(pos.y));
    await simpleClickRed(page, pos.x, pos.y);
    await sleep(500);
    if (!(await detectInteraction(page))) {
      logger.success('关闭成功 ✅');
      return true;
    }
  }

  // ── 策略E: 获取所有可见元素中带有 × / 关闭 / 短文本的，逐个尝试 ──
  logger.info('策略E — 遍历所有含短文本的可见元素');
  for (const frame of page.frames()) {
    try {
      // 找所有包含 × 或 关闭 的元素（不限制标签类型）
      for (const kw of ['×', '✕', '✖', '关闭', 'close']) {
        const elements = frame.locator('*').filter({ hasText: kw });
        const cnt = await elements.count();
        for (let i = 0; i < Math.min(cnt, 30); i++) {
          const el = elements.nth(i);
          const text = ((await el.textContent()) || '').trim();
          if (!text || text.length > 10) continue;
          const box = await el.boundingBox();
          if (!box || box.width < 5 || box.height < 5 || box.width > 200) continue;
          logger.info('策略E — 点击 "%s"', text.substring(0, 8));
          await simpleClickRed(page, box.x + box.width / 2, box.y + box.height / 2);
          await sleep(500);
          if (!(await detectInteraction(page))) {
            logger.success('关闭成功 ✅');
            return true;
          }
        }
      }
    } catch { /* 跨域跳过 */ }
  }

  logger.warn('所有关闭策略均未找到可点击的关闭按钮');
  return false;
}

/**
 * 在指定坐标执行真人风格点击（带蓝色流星波纹）
 * 使用 page.mouse 确保触发原生事件
 */
async function simpleClick(page, x, y) {
  const vp = page.viewportSize() || { width: 1920, height: 1080 };
  const cx = Math.max(5, Math.min(vp.width - 5, x));
  const cy = Math.max(5, Math.min(vp.height - 5, y));

  await page.mouse.move(
    cx + (Math.random() - 0.5) * 60,
    cy + (Math.random() - 0.5) * 30,
    { steps: 6 + Math.floor(Math.random() * 5) }
  );
  await sleep(60 + Math.random() * 150);
  await page.mouse.move(cx, cy, { steps: 4 + Math.floor(Math.random() * 3) });
  await sleep(40 + Math.random() * 100);

  await ensureRippleCSS(page);
  await showRipple(page, cx, cy);
  await sleep(80 + Math.random() * 120);
  await page.mouse.click(cx, cy);
}

async function simpleClickRed(page, x, y) {
  const vp = page.viewportSize() || { width: 1920, height: 1080 };
  const cx = Math.max(5, Math.min(vp.width - 5, x));
  const cy = Math.max(5, Math.min(vp.height - 5, y));

  await page.mouse.move(
    cx + (Math.random() - 0.5) * 60,
    cy + (Math.random() - 0.5) * 30,
    { steps: 6 + Math.floor(Math.random() * 5) }
  );
  await sleep(60 + Math.random() * 150);
  await page.mouse.move(cx, cy, { steps: 4 + Math.floor(Math.random() * 3) });
  await sleep(40 + Math.random() * 100);

  await ensureRippleCSS(page);
  await showRippleRed(page, cx, cy);
  await sleep(80 + Math.random() * 120);
  await page.mouse.click(cx, cy);
}

// ── 复用 frame-finder 中的 findButtonInFrames ──
const { findButtonInFrames } = require('./frame-finder');

module.exports = { detectInteraction, handleInteraction };

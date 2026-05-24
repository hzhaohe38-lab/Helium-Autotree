/**
 * ============================================
 *  导航模块
 *  视频播放完毕后自动进入下一节
 *  已学完自动跳过，遇到单元检测自动暂停
 *
 *  关键设计:
 *    - 所有点击使用 page.mouse.click(x, y) 配合 bounding box
 *      坐标点击，确保触发 React/Vue 事件处理器
 *    - 每次点击显示蓝色流星波纹（用户要求看到特效）
 *    - 每次点击后验证导航是否实际发生
 *    - 3 次重试，多种策略
 *    - 不搜索"知道了"等陷阱文字
 * ============================================
 */

const config = require('../config');
const { logger } = require('./logger');
const { sleep, randomDelay, captureScreenshot, showRipple, ensureRippleCSS } = require('./utils');
const { findButtonInFrames, findVideoFrame } = require('./frame-finder');

/**
 * 检测视频是否真正播放完毕
 */
function isVideoEnded(status) {
  if (status.ended) return true;
  if (status.duration > 0 && status.currentTime >= status.duration - 1) return true;
  return false;
}

/**
 * 检测页面是否为真正的单元检测/考试页面
 */
async function detectTestPage(page) {
  try {
    const hasVideo = await page.evaluate(() => {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (v.duration > 30 && v.offsetWidth > 100) return true;
      }
      return false;
    });
    if (hasVideo) return false;

    return await page.evaluate((keywords) => {
      const bodyText = document.body?.innerText || '';
      let totalMatches = 0;
      for (const kw of keywords) {
        let pos = 0;
        while ((pos = bodyText.indexOf(kw, pos)) !== -1) {
          totalMatches++;
          pos += kw.length;
        }
      }
      if (totalMatches < 3) return false;
      const radios = document.querySelectorAll('input[type="radio"]').length;
      const checkboxes = document.querySelectorAll('input[type="checkbox"]').length;
      const textInputs = document.querySelectorAll('textarea, input[type="text"], input[type="number"]').length;
      const totalQuestions = radios + checkboxes + textInputs;
      if (totalQuestions >= 2) return true;
      const hasSubmit = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .some(el => /提交|交卷|确定提交/.test(el.textContent || ''));
      return totalMatches >= 3 && hasSubmit;
    }, config.testPageKeywords);
  } catch {
    return false;
  }
}

/**
 * 检测并处理"继续学习"弹窗
 */
async function handleResumePopup(page) {
  const result = await findButtonInFrames(page, config.buttonTexts.resume);
  if (result) {
    logger.info('检测到"继续学习"弹窗');
    await randomDelay(500, 1500);
    await mouseClickLocator(page, result.locator);
    logger.success('已点击继续学习 ✅');
    await randomDelay(1000, 2000);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════
//  鼠标点击辅助（带波纹特效）
// ═══════════════════════════════════════════════

/**
 * 通过 bounding box 获取元素坐标，用 page.mouse.click 模拟真人点击
 * 每次点击显示蓝色流星波纹
 */
async function mouseClickLocator(page, locator) {
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click({ force: true });
    return;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 鼠标轨迹模拟
  await page.mouse.move(cx + (Math.random() - 0.5) * 40, cy + (Math.random() - 0.5) * 20, { steps: 5 + Math.floor(Math.random() * 4) });
  await sleep(80 + Math.random() * 200);
  await page.mouse.move(cx, cy, { steps: 3 + Math.floor(Math.random() * 3) });
  await sleep(50 + Math.random() * 100);

  // 蓝色流星波纹
  await ensureRippleCSS(page);
  await showRipple(page, cx, cy);
  await sleep(100 + Math.random() * 150);

  await page.mouse.click(cx, cy);
}

/**
 * 在指定坐标用 page.mouse.click 执行点击（带波纹）
 */
async function mouseClickAt(page, x, y) {
  await page.mouse.move(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 15, { steps: 5 });
  await sleep(80 + Math.random() * 150);
  await page.mouse.move(x, y, { steps: 3 });
  await sleep(40 + Math.random() * 80);

  // 蓝色流星波纹
  await ensureRippleCSS(page);
  await showRipple(page, x, y);
  await sleep(100 + Math.random() * 150);

  await page.mouse.click(x, y);
}

// ═══════════════════════════════════════════════
//  导航验证
// ═══════════════════════════════════════════════

/**
 * 获取当前视频状态的"签名"，用于点击前后对比
 */
async function getVideoSignature(page) {
  try {
    const url = page.url();
    const frame = await findVideoFrame(page);
    if (!frame) return { url, video: null };

    const video = await frame.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return {
        src: v.src || v.currentSrc || '',
        duration: v.duration,
        currentTime: v.currentTime,
      };
    });
    return { url, video };
  } catch {
    return null;
  }
}

/**
 * 点击后验证导航是否成功
 */
async function verifyNavigation(page, oldSig) {
  await randomDelay(3000, 5000);

  const newSig = await getVideoSignature(page);

  if (!oldSig && !newSig) return false;
  if (!oldSig && newSig && newSig.video) return true;
  if (oldSig && !newSig) {
    await randomDelay(3000, 5000);
    const retry = await getVideoSignature(page);
    if (retry && retry.video) return true;
    return false;
  }

  if (oldSig.video && newSig.video) {
    if (newSig.video.src && oldSig.video.src && newSig.video.src !== oldSig.video.src) {
      logger.info('导航验证成功：视频源已改变');
      return true;
    }
    if (Math.abs(newSig.video.duration - oldSig.video.duration) > 3) {
      logger.info('导航验证成功：视频时长已改变');
      return true;
    }
    if (oldSig.video.duration > 0 && oldSig.video.currentTime >= oldSig.video.duration - 2 && newSig.video.currentTime < 3) {
      logger.info('导航验证成功：已从视频末尾回到开头');
      return true;
    }
  }

  if (oldSig.url && newSig.url && oldSig.url !== newSig.url) {
    logger.info('导航验证成功：页面 URL 已改变');
    return true;
  }

  logger.debug('导航验证未通过：视频状态未改变');
  return false;
}

// ═══════════════════════════════════════════════
//  各策略函数（全部用 mouse 坐标点击 + 波纹）
// ═══════════════════════════════════════════════

/**
 * 策略1: 通过文本匹配查找"下一节"/"下一集"等按钮
 */
async function tryClickNextByText(page) {
  const result = await findButtonInFrames(page, config.buttonTexts.next);
  if (!result) return false;

  logger.info('策略1 — 找到文本匹配的下一节按钮: "%s"', result.pattern);
  await randomDelay(500, 1500);
  await mouseClickLocator(page, result.locator);
  return true;
}

/**
 * 策略2: 点击视频播放器底部的 → 箭头
 */
async function tryClickNextArrow(page) {
  const frames = page.frames();

  for (const frame of frames) {
    try {
      const info = await frame.evaluate(() => {
        const selectors = [
          '.nextBtn', '.next-btn', '.nextButton', '.next-button',
          '.skipBtn', '.skip-btn',
          'a.next', 'button.next',
          '[class*="next"]:not([class*="disable"]):not([class*="disabled"])',
          '[class*="skip"]',
          '.icon-next', '.icon-arrow-right', '.icon-right',
          'svg[class*="right"]',
          'i[class*="right"]',
          '.vjs-next', '.prism-next-btn',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
        }
        return null;
      });

      if (!info) continue;

      // 如果位于 iframe 内，需转换坐标为页面绝对坐标
      let pageX = info.x;
      let pageY = info.y;

      if (frame !== page.mainFrame()) {
        const frameEl = await frame.frameElement();
        const box = await frameEl.boundingBox();
        if (box) {
          pageX = box.x + info.x;
          pageY = box.y + info.y;
        }
      }

      logger.info('策略2 — 点击视频播放器下一节箭头');
      await mouseClickAt(page, pageX, pageY);
      return true;
    } catch (e) {
      logger.debug(`策略2 跳过 frame: ${e.message}`);
    }
  }

  return false;
}

/**
 * 策略3: 通过目录导航到下一节
 */
async function tryNavigateViaSidebar(page) {
  const info = await page.evaluate(() => {
    const catalogSelectors = [
      '.courseCatalog', '.catalog', '.catalog-list', '.catalogue',
      '.chapterList', '.chapter-list', '.chapterContent',
      '.sectionList', '.section-list',
      '.el-tabs', '.el-tab-pane', '.tab-pane', '.tab-content',
      '.menuContent', '.menu-list', '.menu',
      '.sidebar', '.side-bar',
      '.rightPanel', '.right-panel', '.rightContent',
      '[class*="courseCatalog"]', '[class*="catalog"]', '[class*="catalogue"]',
      '[class*="chapterList"]', '[class*="sectionList"]',
    ];

    function findCatalog() {
      for (const sel of catalogSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 30) return el;
      }
      const candidates = document.querySelectorAll('div, ul, ol, nav, section');
      for (const el of candidates) {
        const w = el.offsetWidth;
        if (w < 50 || w > 600) continue;
        const txt = el.textContent || '';
        const timeMatches = txt.match(/\d+:\d+/g);
        if (timeMatches && timeMatches.length >= 2 && el.querySelectorAll('a').length >= 2) {
          return el;
        }
      }
      return null;
    }

    const catalog = findCatalog();
    if (!catalog) return null;

    const items = catalog.querySelectorAll(
      'a, [role="button"], li, .el-tab-pane, ' +
      '[class*="section"], [class*="chapter"], [class*="lesson"], ' +
      '.item, [class*="item"], .tab, [class*="tab"]'
    );
    if (items.length < 2) return null;

    // 找当前高亮条目
    let activeIdx = -1;
    for (let i = 0; i < items.length; i++) {
      try {
        if (items[i].matches('.active, .current, .on, .playing, .selected, [class*="active"], [class*="current"], [class*="playing"], [class*="selected"]')) {
          activeIdx = i; break;
        }
      } catch { }
    }
    if (activeIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        const icon = items[i].querySelector('[class*="play"], [class*="volume"], [class*="sound"], .playing-icon, i.icon-play, i.icon-volume, svg[class*="play"], svg[class*="volume"]');
        if (icon) { activeIdx = i; break; }
      }
    }
    // C: 蓝色背景/边框检测（智慧树当前播放项有微蓝背景或蓝左边框）
    if (activeIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        // 检查元素背景
        const bg = window.getComputedStyle(el).backgroundColor;
        const isBlue = (bgStr) => {
          if (!bgStr || bgStr === 'transparent' || bgStr === 'rgba(0,0,0,0)') return false;
          const m = bgStr.match(/\d+/g);
          if (!m) return false;
          const [r, g, b] = m.map(Number);
          return b > r + 20 && b > g + 20;
        };
        if (isBlue(bg)) { activeIdx = i; break; }
        // 检查子元素背景
        const subs = el.querySelectorAll('*');
        for (const sub of subs) {
          if (isBlue(window.getComputedStyle(sub).backgroundColor)) { activeIdx = i; break; }
        }
        if (activeIdx !== -1) break;
        // 检查左边框
        if (isBlue(window.getComputedStyle(el).borderLeftColor)) { activeIdx = i; break; }
      }
    }
    if (activeIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        if (/current|active|playing|on|selected/i.test(items[i].outerHTML || '')) {
          if (items[i].scrollIntoView) { activeIdx = i; break; }
        }
      }
    }
    if (activeIdx === -1) return null;

    // 找下一个可点条目
    for (let j = activeIdx + 1; j < items.length; j++) {
      const text = items[j].textContent || '';
      // 跳过单元检测
      if (/单元检测|章节测验|章节测试|考试|测验|作业|课后作业/.test(text)) continue;
      // 跳过陷阱文字（"成绩分析"等非视频链接）
      if (/成绩|分析|统计|报告|设置|资料|通知|公告/.test(text)) continue;
      if (!items[j].hasAttribute('href') && !items[j].hasAttribute('onclick')) {
        if (items[j].tagName !== 'A' && items[j].tagName !== 'BUTTON' && !items[j].getAttribute('role')) {
          continue;
        }
      }
      if (!text.trim() || text.trim().length < 2) continue;

      const r = items[j].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: text.trim().substring(0, 40) };
    }
    return null;
  });

  if (!info) return false;

  logger.info('策略3 — 通过目录切换到: "%s"', info.text);
  await mouseClickAt(page, info.x, info.y);
  return true;
}

/**
 * 策略4: 找所有可点击的章节链接
 * ★ 过滤掉"成绩分析"等陷阱文字
 */
async function tryGenericLinks(page) {
  const info = await page.evaluate(() => {
    // 需要跳过的陷阱文字（页面中非视频链接的导航项）
    const traps = ['成绩分析', '学习记录', '课程成绩', '课程统计', '学习报告',
      '成绩', '统计', '分析', '报告', '设置', '资料', '通知', '公告',
      '我的', '个人', '账号', '帮助', '反馈'];

    const links = document.querySelectorAll(
      'a[href*="section"], a[href*="chapter"], a[href*="lesson"], ' +
      'a[href*="video"], a[href*="course"], ' +
      '.chapter-item, .section-item, .lesson-item, ' +
      'li[class*="chapter"] a, li[class*="section"] a'
    );
    for (let i = 0; i < links.length; i++) {
      const text = links[i].textContent || '';
      // 跳过单元检测/考试
      if (/单元检测|章节测验|章节测试|考试|测验|作业/.test(text)) continue;
      // 跳过陷阱文字
      if (traps.some(t => text.includes(t))) continue;
      // 跳过当前高亮
      if (!links[i].matches('.active, .current, .on, [class*="active"], [class*="current"]')) {
        const r = links[i].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: text.trim().substring(0, 40) };
      }
    }
    return null;
  });

  if (!info) return false;

  logger.info('策略4 — 点击章节链接: "%s"', info.text);
  await mouseClickAt(page, info.x, info.y);
  return true;
}

/**
 * 策略5: 基于视频播放器坐标 → 点击底部控制栏箭头区域
 * 首次点击后缓存坐标，后续复用固定位置
 */
let _nextBtnCoords = null;

async function tryClickVideoPlayerArea(page) {
  try {
    const frame = await findVideoFrame(page);
    if (!frame) return false;

    let box;
    if (frame === page.mainFrame()) {
      box = await frame.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        const r = v.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      if (!box) return false;
    } else {
      const frameEl = await frame.frameElement();
      box = await frameEl.boundingBox();
      if (!box) return false;
    }

    let cx, cy;
    if (_nextBtnCoords) {
      cx = _nextBtnCoords.x;
      cy = _nextBtnCoords.y;
      logger.info('策略5 — 复用缓存坐标 (%d,%d)', Math.round(cx), Math.round(cy));
    } else {
      // → 按钮在播放器底部控制栏左侧区域，固定位置
      cx = box.x + 60;
      cy = box.y + box.height - 29;
      _nextBtnCoords = { x: cx, y: cy };
      logger.info('策略5 — 首次定位并缓存 (%d,%d)', Math.round(cx), Math.round(cy));
    }

    await mouseClickAt(page, cx, cy);
    return true;
  } catch (e) {
    logger.debug('策略5 失败:', e.message);
    return false;
  }
}

/**
 * 策略6: 在视频播放器底部循环扫描多个可能位置
 */
async function tryClickBottomControls(page) {
  try {
    const frame = await findVideoFrame(page);
    if (!frame) return false;

    let box;
    if (frame === page.mainFrame()) {
      box = await frame.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        const r = v.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      if (!box) return false;
    } else {
      const frameEl = await frame.frameElement();
      box = await frameEl.boundingBox();
      if (!box) return false;
    }

    const positions = [];
    const controlBarY = box.y + box.height - 30;

    for (let offsetX = 20; offsetX < 200; offsetX += 30) {
      positions.push({ x: box.x + offsetX, y: controlBarY - 5 + Math.floor(Math.random() * 15) });
    }
    for (let offsetX = 20; offsetX < 200; offsetX += 30) {
      positions.push({ x: box.x + box.width - offsetX, y: controlBarY - 5 + Math.floor(Math.random() * 15) });
    }

    for (const pos of positions) {
      logger.info('策略6 — 尝试控制栏位置 (%d,%d)', Math.round(pos.x), Math.round(pos.y));
      await mouseClickAt(page, pos.x, pos.y);
      await sleep(800 + Math.random() * 500);
    }

    return true;
  } catch (e) {
    logger.debug('策略6 失败:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════
//  goToNextSection — 主入口
//  不搜索"知道了"等陷阱文字
// ═══════════════════════════════════════════════

/**
 * 导航到下一节
 *
 * 简化策略：视频结束后 → 点左下角 → 按钮 → 等10秒验证
 *           失败则再点一次，再等10秒
 */
async function goToNextSection(page) {
  logger.info('视频播放完毕，准备进入下一节...');
  await captureScreenshot(page, 'video_completed');
  await randomDelay(2000, 4000);
  await ensureRippleCSS(page);

  // 记录导航前的视频状态
  const beforeSig = await getVideoSignature(page);

  // 最多尝试 2 次：第一次 + 一次重试
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      logger.info('第一次点击未生效，重试第 2 次...');
      await randomDelay(2000, 4000);
    }

    // 点左下角 → 按钮
    const clicked = await tryClickVideoPlayerArea(page);
    if (!clicked) {
      logger.warn('未能定位视频播放器');
      // 兜底：试试文本匹配
      if (await tryClickNextByText(page)) {
        logger.success('文本匹配方式点击完成');
      } else {
        continue;
      }
    }

    // 等 10 秒加载
    logger.info('等待 10 秒验证导航...');
    await sleep(10000);

    if (await verifyNavigation(page, beforeSig)) {
      logger.success('导航成功 ✅');
      return true;
    }

    logger.info('导航未生效，准备重试');
  }

  // 最终检查
  const isTestPage = await detectTestPage(page);
  if (isTestPage) {
    logger.info('检测到单元检测/测试页面 — 跳过自动化处理');
    return false;
  }

  if (await verifyNavigation(page, beforeSig)) {
    logger.success('延迟验证：导航已成功 ✅');
    return true;
  }

  logger.warn('两次点击均未触发导航，可能已完成所有章节');
  return false;
}

/**
 * 处理"已学完"的章节
 */
async function skipCompletedSection(page) {
  const result = await findButtonInFrames(page, config.buttonTexts.next);
  if (result) {
    logger.info('当前章节已学完，进入下一节');
    await randomDelay(800, 1500);
    await mouseClickLocator(page, result.locator);
    await randomDelay(2000, 3000);
    return true;
  }
  return false;
}

const navigateViaSidebar = tryNavigateViaSidebar;

module.exports = {
  isVideoEnded,
  detectTestPage,
  handleResumePopup,
  goToNextSection,
  skipCompletedSection,
  navigateViaSidebar,
};

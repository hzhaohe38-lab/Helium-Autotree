/**
 * ============================================
 *  iframe 遍历器
 *  智慧树的播放器嵌在多层 iframe 中
 *  此模块负责递归查找所有 frame 内的元素
 * ============================================
 */

const { logger } = require('./logger');

/**
 * 在所有 frame 中查找第一个包含有效视频元素的 frame
 * "有效" = duration > 30 秒（排除广告/缩略图视频）
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame|null>}
 */
async function findVideoFrame(page) {
  const frames = page.frames();
  logger.debug(`当前页面共有 ${frames.length} 个 frame`);

  for (const frame of frames) {
    try {
      // 快速检查是否有 <video> 元素
      const videoCount = await frame.locator('video').count();
      if (videoCount === 0) continue;

      // 确认是真实的课程视频（duration > 30s）
      const isValid = await frame.evaluate(() => {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          // 有真实时长且可见
          if (v.duration > 30 && v.offsetWidth > 100) {
            return true;
          }
        }
        return false;
      });

      if (isValid) {
        logger.debug(`在第 ${frames.indexOf(frame)} 号 frame 中找到视频`);
        return frame;
      }
    } catch (e) {
      // 跨域 frame 可能无法访问，跳过
      logger.debug(`跳过 frame（可能跨域）: ${e.message}`);
    }
  }

  return null;
}

/**
 * 在所有 frame 中查找匹配任意文本模式的可点击元素
 *
 * ★ 关键设计：只查找真正的交互元素（button, a, [role="button"]）
 *   避免匹配页面正文中的普通文字（防脚本陷阱）
 *
 * @param {import('playwright').Page} page
 * @param {string[]} patterns 文本匹配模式列表
 * @returns {Promise<{ frame: import('playwright').Frame, locator: import('playwright').Locator, pattern: string } | null>}
 */
async function findButtonInFrames(page, patterns) {
  const frames = page.frames();

  for (const frame of frames) {
    for (const text of patterns) {
      try {
        // 策略1: getByRole — 只匹配 HTML button / [role="button"]
        const btn = frame.getByRole('button', { name: text, exact: false });
        if ((await btn.count()) > 0) {
          logger.debug(`在 frame 中找到按钮(role): "${text}"`);
          return { frame, locator: btn.first(), pattern: text };
        }
      } catch { /* 跨域或超时 */ }

      try {
        // 策略2: 限定交互元素 + hasText 过滤
        // 只找 button, a, [role="button"] 中包含目标文字的
        const btn = frame.locator('button, a, [role="button"], input[type="button"], input[type="submit"]')
          .filter({ hasText: text }).first();
        if ((await btn.count()) > 0) {
          logger.debug(`在 frame 中找到按钮(filter+hasText): "${text}"`);
          return { frame, locator: btn, pattern: text };
        }
      } catch { /* ignore */ }

      try {
        // 策略3: XPath — 限制为 button 和 a 标签
        const btn = frame.locator(
          `//button[contains(text(), '${text}')] | ` +
          `//a[contains(text(), '${text}')] | ` +
          `//*[@role='button'][contains(text(), '${text}')]`
        ).first();
        if ((await btn.count()) > 0) {
          logger.debug(`在 frame 中找到按钮(xpath): "${text}"`);
          return { frame, locator: btn, pattern: text };
        }
      } catch { /* ignore */ }

      try {
        // 策略4: 广谱查找 — 任何可见元素包含目标文字（兼容 Element UI 的 div 按钮）
        // 使用 Playwright getByText 查找文本，再验证元素可见且可点
        const anyEl = frame.getByText(text, { exact: false }).first();
        if ((await anyEl.count()) > 0) {
          const box = await anyEl.boundingBox();
          if (box && box.width > 10 && box.height > 10) {
            logger.debug(`在 frame 中找到广谱匹配: "${text}"`);
            return { frame, locator: anyEl, pattern: text };
          }
        }
      } catch { /* ignore */ }

      try {
        // 策略5: 所有元素 + hasText 过滤（最广谱）
        const anyEl = frame.locator('*').filter({ hasText: text }).first();
        if ((await anyEl.count()) > 0) {
          const box = await anyEl.boundingBox();
          if (box && box.width > 10 && box.height > 10) {
            logger.debug(`在 frame 中找到超广谱匹配: "${text}"`);
            return { frame, locator: anyEl, pattern: text };
          }
        }
      } catch { /* ignore */ }
    }
  }

  return null;
}

/**
 * 在指定 frame 中查找视频元素
 * @param {import('playwright').Frame} frame
 * @returns {Promise<{ valid: boolean, duration: number, currentTime: number, paused: boolean, ended: boolean }>}
 */
async function getVideoStatus(frame) {
  const defaultStatus = { valid: false, duration: 0, currentTime: 0, paused: true, ended: false };

  try {
    return await frame.evaluate(() => {
      const videos = document.querySelectorAll('video');
      // 选最长的那个（主视频）
      let best = null;
      for (const v of videos) {
        if (!best || v.duration > best.duration) best = v;
      }
      if (!best || best.duration <= 30) return { valid: false, duration: 0, currentTime: 0, paused: true, ended: false };

      return {
        valid: true,
        duration: best.duration,
        currentTime: best.currentTime,
        paused: best.paused,
        ended: best.ended,
        readyState: best.readyState,
      };
    });
  } catch {
    return defaultStatus;
  }
}

/**
 * 在视频 frame 中控制播放
 */
async function playVideo(frame) {
  try {
    const result = await frame.evaluate(async () => {
      const v = document.querySelector('video');
      if (v && v.paused) {
        try {
          await v.play();
          return 'played';
        } catch (e) {
          return 'blocked: ' + e.message;
        }
      }
      return 'already_playing';
    });
    if (result === 'played' || result === 'already_playing') {
      return true;
    }
    logger.warn('playVideo 被浏览器阻止:', result);
    return false;
  } catch {
    return false;
  }
}

/**
 * 在视频 frame 中设置播放速度
 */
async function setPlaybackRate(frame, rate) {
  try {
    await frame.evaluate((r) => {
      const v = document.querySelector('video');
      if (v) {
        v.playbackRate = r;
        // 如果默认速率属性也设上，防止被重置
        v.defaultPlaybackRate = r;
      }
    }, rate);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前视频的实际播放速率
 */
async function getPlaybackRate(frame) {
  try {
    return await frame.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.playbackRate : 1;
    });
  } catch {
    return 1;
  }
}

module.exports = {
  findVideoFrame,
  findButtonInFrames,
  getVideoStatus,
  playVideo,
  setPlaybackRate,
  getPlaybackRate,
};

/**
 * ============================================
 *  视频播放控制器
 *  负责播放、暂停检测、卡顿恢复、速度控制
 * ============================================
 */

const config = require('../config');
const { logger } = require('./logger');
const { sleep, captureScreenshot, randomMouseMove } = require('./utils');
const {
  findVideoFrame,
  getVideoStatus,
  playVideo,
  setPlaybackRate,
  getPlaybackRate,
  findButtonInFrames,
} = require('./frame-finder');

/**
 * 确保视频正在播放，并设置倍速
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame 视频所在的 frame
 */
async function ensureVideoPlaying(page, frame) {
  const status = await getVideoStatus(frame);

  if (!status.valid) {
    logger.warn('视频帧无效或未找到有效视频');
    return false;
  }

  // 设置/维持播放速度
  const currentRate = await getPlaybackRate(frame);
  if (Math.abs(currentRate - config.playbackRate) > 0.1) {
    await setPlaybackRate(frame, config.playbackRate);
    logger.info(`已将播放速度设为 ${config.playbackRate}x`);
  }

  // 如果视频暂停了，恢复播放
  if (status.paused && !status.ended) {
    logger.warn(`检测到视频暂停于 ${formatTime(status.currentTime)}，尝试恢复`);
    await randomMouseMove(page);

    // 先试试 JS 直接播放
    let resumed = await playVideo(frame);

    if (!resumed) {
      // JS 播放被阻止 → 点击 UI 播放按钮
      logger.info('JS 播放被阻止，尝试点击 UI 播放按钮');
      await sleep(500);
      const playBtn = await findButtonInFrames(page, config.buttonTexts.play);
      if (playBtn) {
        logger.info('点击播放按钮');
        const box = await playBtn.locator.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await sleep(1000);
        } else {
          await playBtn.locator.click({ force: true });
        }
        // 再试一次 JS 播放
        resumed = await playVideo(frame);
      }
    }

    if (resumed) {
      logger.success('已恢复播放 ✅');
    } else {
      logger.warn('未能恢复播放，等待下次循环重试');
    }
    return true;
  }

  return status.ended;
}

/**
 * 检查视频是否卡住（currentTime 长时间不变）
 * @param {number} currentTime 当前时间
 * @param {number} lastTime 上次记录的时间
 * @param {number} stallCount 连续卡住计数
 * @returns {{ stalled: boolean, newCount: number }}
 */
function checkStall(currentTime, lastTime, stallCount) {
  if (currentTime <= 0) return { stalled: false, newCount: 0 };

  if (currentTime === lastTime) {
    const newCount = stallCount + 1;
    const threshold = config.stallThreshold / (config.checkInterval / 1000);
    return { stalled: newCount > threshold, newCount };
  }

  return { stalled: false, newCount: 0 };
}

/** 友好格式化秒数 */
function formatTime(s) {
  if (!s || isNaN(s)) return '--:--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * 处理视频卡住：尝试恢复 -> 刷新页面
 */
async function handleStall(page, videoFrame) {
  logger.warn('视频可能卡住，尝试恢复...');
  await captureScreenshot(page, 'stall');

  // 先尝试播放
  const ok = await playVideo(videoFrame);
  if (ok) {
    logger.success('已尝试恢复播放');
    return true;
  }

  // 再尝试点击播放按钮
  const playBtn = await findButtonInFrames(page, config.buttonTexts.play);
  if (playBtn) {
    await playBtn.locator.click();
    logger.success('通过 UI 按钮恢复');
    return true;
  }

  // 最后手段：刷新页面
  logger.warn('恢复失败，准备刷新页面...');
  return false;
}

module.exports = {
  ensureVideoPlaying,
  checkStall,
  formatTime,
  handleStall,
  findVideoFrame,
  getVideoStatus,
};

/**
 * ============================================
 *  日志系统
 *  带时间戳、颜色分级、写入文件等
 * ============================================
 */

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

// 获取当前时间字符串
function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', { hour12: false });
}

// 格式化秒数为可读时间
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '--:--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const logger = {
  /** 普通日志（绿色） */
  info(...args) {
    console.log(
      `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ${COLORS.green}${COLORS.bold}[INFO]${COLORS.reset}`,
      ...args
    );
  },

  /** 警告（黄色） */
  warn(...args) {
    console.log(
      `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ${COLORS.yellow}${COLORS.bold}[WARN]${COLORS.reset}`,
      ...args
    );
  },

  /** 错误（红色） */
  error(...args) {
    console.error(
      `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ${COLORS.red}${COLORS.bold}[ERROR]${COLORS.reset}`,
      ...args
    );
  },

  /** 成功/完成（青色） */
  success(...args) {
    console.log(
      `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ${COLORS.cyan}${COLORS.bold}[OK]${COLORS.reset}`,
      ...args
    );
  },

  /** 调试（紫色），仅 --debug 模式输出 */
  debug(...args) {
    if (logger.debugMode) {
      console.log(
        `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ${COLORS.magenta}[DEBUG]${COLORS.reset}`,
        ...args
      );
    }
  },

  /** 播放进度专用（单行覆盖显示） */
  progress(currentTime, duration) {
    const progress = duration > 0 ? ((currentTime / duration) * 100).toFixed(1) : '?';
    process.stdout.write(
      `\r${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ` +
      `${COLORS.cyan}[PROGRESS]${COLORS.reset} ` +
      `${formatTime(currentTime)} / ${formatTime(duration)} ` +
      `(${progress}%)${' '.repeat(10)}`
    );
  },

  /** 分隔线 */
  divider() {
    console.log(COLORS.gray + '─'.repeat(60) + COLORS.reset);
  },
};

module.exports = { logger, formatTime };

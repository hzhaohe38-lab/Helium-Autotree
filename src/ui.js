/**
 * ============================================
 *  浮窗控制面板 UI
 *  注入到智慧树页面内的浮动面板
 *  计时器在浏览器端独立运行
 *  可拖拽、可折叠
 * ============================================
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { sleep } = require('./utils');

function overlayHTML(logoUrl) { return `
<style id="zhs-ui-style">
  #zhs-overlay {
    position:fixed; bottom:24px; right:24px; z-index:999999;
    width:300px;
    background:rgba(11,18,20,0.93);
    backdrop-filter:blur(12px) saturate(1.2);
    -webkit-backdrop-filter:blur(12px) saturate(1.2);
    border-radius:16px;
    border:2px solid rgba(9,54,61,0.65);
    box-shadow:0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.15);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif;
    color:#9ae8f1;
    font-size:13px; line-height:1.5; user-select:none;
    transition:opacity 0.35s ease, transform 0.35s ease;
    opacity:0; transform:translateY(10px);
    cursor:grab;
  }
  #zhs-toggle-btn {
    width:100%; padding:10px 0;
    border:2px solid rgba(9,54,61,0.65); border-radius:12px;
    font-size:13px; font-weight:600; cursor:pointer;
    color:#9ae8f1;
    transition:all 400ms cubic-bezier(0.34,1.56,0.64,1);
    background:rgba(10,35,40,0.85);
    position:relative; overflow:hidden;
  }
  #zhs-toggle-btn:hover {
    background:rgba(13,47,56,0.85);
    border-color:rgba(14,77,87,0.8);
    transform:translateY(-1px);
    box-shadow:0 4px 16px rgba(9,54,61,0.3);
  }
  #zhs-toggle-btn:active {
    transform:scale(0.94);
    transition:transform 80ms;
  }
  #zhs-dot {
    transition:all 0.5s ease;
  }
</style>
<div id="zhs-overlay">
  <div id="zhs-main-content">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 0;">
    <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px;letter-spacing:0.02em;color:#9ae8f1;">
      ${logoUrl ? `<img src="${logoUrl}" style="width:22px;height:22px;border-radius:4px;opacity:0.85;">` : ''} 氢氦树
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <span id="zhs-dot" style="width:6px;height:6px;border-radius:50%;display:inline-block;background:rgba(154,232,241,0.45);box-shadow:0 0 6px rgba(154,232,241,0.2);"></span>
      <span id="zhs-status" style="font-size:11px;font-weight:500;color:rgba(154,232,241,0.65);min-width:3em;">初始中</span>
      <span id="zhs-collapse-btn" style="cursor:pointer;font-size:14px;line-height:1;padding:0 3px;color:rgba(255,255,255,0.2);transition:color 0.25s;" title="折叠" onmouseover="this.style.color='rgba(255,255,255,0.6)'" onmouseout="this.style.color='rgba(255,255,255,0.2)'">─</span>
    </div>
  </div>

  <div style="padding:10px 16px;">
    <button id="zhs-toggle-btn">
      <span id="zhs-btn-icon">⏸</span> <span id="zhs-btn-label">暂停</span>
    </button>
  </div>

  <div style="margin:0 14px;border-top:1px dashed rgba(9,54,61,0.5);"></div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;padding:10px 16px 6px;">
    <div style="text-align:center;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(154,232,241,0.45);margin-bottom:2px;">时长</div>
      <div id="zhs-timer" style="font-size:14px;font-weight:600;color:#9ae8f1;font-variant-numeric:tabular-nums;">00:00</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(154,232,241,0.45);margin-bottom:2px;">答题</div>
      <div style="font-size:14px;font-weight:600;color:#9ae8f1;"><span id="zhs-interactions">0</span></div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(154,232,241,0.45);margin-bottom:2px;">倍速</div>
      <div style="font-size:14px;font-weight:600;color:#9ae8f1;"><span id="zhs-speed">1.5</span><span style="font-size:10px;color:rgba(154,232,241,0.45);">x</span></div>
    </div>
  </div>

  <div style="padding:4px 16px 8px;">
    <div style="display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(154,232,241,0.45);margin-bottom:3px;">
      <span id="zhs-video-current">0:00</span>
      <span id="zhs-video-pct">0%</span>
      <span id="zhs-video-duration">0:00</span>
    </div>
    <div style="width:100%;height:2px;background:rgba(255,255,255,0.08);border-radius:1px;overflow:hidden;">
      <div id="zhs-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,rgba(154,232,241,0.35),rgba(154,232,241,0.5));border-radius:1px;transition:width 0.6s cubic-bezier(0.22,1,0.36,1);"></div>
    </div>
  </div>

  <div style="margin:0 14px;border-top:1px dashed rgba(9,54,61,0.5);"></div>

  <div style="padding:6px 16px 12px;">
    <div id="zhs-log-text" style="font-size:10px;color:rgba(154,232,241,0.45);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">⏳ 等待启动...</div>
  </div>
  </div>

  <!-- 折叠模式 -->
  <div id="zhs-minibar" style="display:none;padding:10px 16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:5px;">
        ${logoUrl ? `<img src="${logoUrl}" style="width:18px;height:18px;border-radius:4px;opacity:0.85;">` : ''}
        <span id="zhs-mini-dot" style="width:5px;height:5px;border-radius:50%;display:inline-block;background:rgba(154,232,241,0.45);"></span>
        <span id="zhs-mini-status" style="font-size:11px;color:rgba(154,232,241,0.65);">运行中</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="zhs-mini-timer" style="font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:#9ae8f1;">00:00</span>
        <span id="zhs-expand-btn" style="cursor:pointer;font-size:13px;color:rgba(255,255,255,0.2);transition:color 0.25s;" title="展开" onmouseover="this.style.color='rgba(255,255,255,0.6)'" onmouseout="this.style.color='rgba(255,255,255,0.2)'">□</span>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  var panel = document.getElementById('zhs-overlay');

  // 计时器（累积时间，暂停/停止时不计时）
  var accumulated = 0;
  var lastTick = Date.now();
  window.__zhsPaused = false;
  window.__zhsStopped = false;
  function updateTimer(){
    // 如果已停止或面板已从 DOM 移除，停止递归
    if (window.__zhsStopped) return;
    if (!document.getElementById('zhs-overlay')) { window.__zhsStopped = true; return; }

    if (!window.__zhsPaused) {
      accumulated += Date.now() - lastTick;
    }
    lastTick = Date.now();
    var e = accumulated;
    var h = Math.floor(e/3600000), m = Math.floor((e%3600000)/60000), s = Math.floor((e%60000)/1000);
    var t = h > 0 ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0');
    document.getElementById('zhs-timer').textContent = t;
    document.getElementById('zhs-mini-timer').textContent = t;
    setTimeout(updateTimer, 500);
  }
  setTimeout(updateTimer, 500);

  // 折叠
  document.getElementById('zhs-collapse-btn').onclick = function(e){
    e.stopPropagation();
    document.getElementById('zhs-main-content').style.display = 'none';
    document.getElementById('zhs-minibar').style.display = '';
    document.getElementById('zhs-mini-dot').style.background = document.getElementById('zhs-dot').style.background || '#94a3b8';
    document.getElementById('zhs-mini-status').textContent = document.getElementById('zhs-status').textContent;
  };
  document.getElementById('zhs-expand-btn').onclick = function(e){
    e.stopPropagation();
    document.getElementById('zhs-main-content').style.display = '';
    document.getElementById('zhs-minibar').style.display = 'none';
  };

  // 主按钮点击：立即更新本地 UI，再异步通知 Node.js
  document.getElementById('zhs-toggle-btn').onclick = function(e){
    e.stopPropagation();

    // 先加一个小 scale 弹跳反馈
    var btn = document.getElementById('zhs-toggle-btn');
    btn.style.transform = 'scale(0.92)';
    setTimeout(function(){ btn.style.transform = ''; }, 150);

    window.__zhsPaused = !window.__zhsPaused;

    // ★ 立即更新 UI（毫秒级响应，不等 Node.js 往返）
    var dot = document.getElementById('zhs-dot');
    var text = document.getElementById('zhs-status');
    var bl = document.getElementById('zhs-btn-label');
    var bi = document.getElementById('zhs-btn-icon');
    var paused = window.__zhsPaused;
    if (dot) {
      dot.style.background = paused ? 'rgba(154,232,241,0.2)' : 'rgba(154,232,241,0.45)';
      dot.style.boxShadow = paused ? '0 0 8px rgba(154,232,241,0.12)' : '0 0 8px rgba(154,232,241,0.2)';
    }
    if (text) text.textContent = paused ? '已暂停' : '运行中';
    if (bl) bl.textContent = paused ? '恢复' : '暂停';
    if (bi) bi.textContent = paused ? '▶' : '⏸';
    if (btn) {
      if (paused) {
        btn.style.background = 'rgba(10,35,40,0.65)';
        btn.style.borderColor = 'rgba(9,54,61,0.5)';
        btn.style.color = "rgba(154,232,241,0.45)";
      } else {
        btn.style.background = 'rgba(10,35,40,0.85)';
        btn.style.borderColor = 'rgba(9,54,61,0.65)';
        btn.style.color = '#9ae8f1';
      }
    }

    // 异步通知 Node.js
    if(window.__zhsToggle) window.__zhsToggle();
  };

  // 拖拽
  var dragging=false, dx, dy, sx, sy;
  panel.onmousedown = function(e){
    if(e.target.tagName==='BUTTON'||e.target.closest('button')) return;
    if(e.target.id==='zhs-collapse-btn'||e.target.id==='zhs-expand-btn') return;
    dragging=true; panel.style.cursor='grabbing';
    dx=panel.offsetLeft; dy=panel.offsetTop; sx=e.clientX; sy=e.clientY;
  };
  document.onmousemove = function(e){
    if(!dragging) return;
    panel.style.left=(dx+e.clientX-sx)+'px'; panel.style.top=(dy+e.clientY-sy)+'px';
    panel.style.bottom='auto'; panel.style.right='auto';
  };
  document.onmouseup = function(){ if(dragging){ dragging=false; panel.style.cursor='grab'; } };

  // 淡入
  requestAnimationFrame(function(){ panel.style.opacity='1'; panel.style.transform='translateY(0)'; });
})();
</script>`; }

class ControlPanel {
  constructor(page) {
    this.page = page;
    this.paused = false;
    this.running = true;
    this.statusText = '运行中';
    this.onToggle = null;
    this.startTime = Date.now();
    this._exposed = false; // 标记 exposeFunction 是否已注册

    this.stats = {
      interactionCount: 0,
      playbackRate: 1.5,
      videoCurrent: '0:00',
      videoDuration: '0:00',
      videoPercent: 0,
    };
    this.lastLog = { level: 'info', text: '等待启动...' };
  }

  /**
   * 注册 exposeFunction（全局只做一次）
   */
  async _ensureExposed() {
    if (this._exposed || !this.page) return;
    try {
      await this.page.exposeFunction('__zhsToggle', () => {
        this.paused = !this.paused;
        if (this.onToggle) this.onToggle(this.paused);
        // 同步更新页面内的暂停状态（计时器用）
        this.page.evaluate(function(p) { window.__zhsPaused = p; }, this.paused).catch(function(){});
      });
      this._exposed = true;
    } catch (err) {
      // 可能已在导航后失效，标记为未暴露以便重试
      this._exposed = false;
      logger.debug('exposeFunction 注册失败:', err.message);
    }
  }

  /**
   * 注入浮窗到页面
   */
  async inject() {
    if (!this.page) return;

    try {
      // 注册暴露函数（只一次）
      await this._ensureExposed();

      // 浮窗是否已存在（上次运行的残留）
      const exists = await this.page.evaluate(() => !!document.getElementById('zhs-overlay'));
      if (exists) {
        // 移除旧浮窗和旧样式，确保计时器重置
        await this.page.evaluate(() => {
          window.__zhsStopped = true;
          var el = document.getElementById('zhs-overlay');
          if (el) el.remove();
          var st = document.getElementById('zhs-ui-style');
          if (st) st.remove();
        });
        await sleep(200);
      }

      // 读取 logo
      const logoPath = path.resolve(__dirname, '..', 'img', 'logo.png');
      let logoDataUri = '';
      try {
        const buf = fs.readFileSync(logoPath);
        logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (e) {}

      // 注入 HTML
      const html = overlayHTML(logoDataUri);
      await this.page.evaluate((h) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = h;
        // 将 script 单独取出执行（innerHTML 的 script 不会自动执行）
        const script = wrapper.querySelector('script');
        const frag = document.createDocumentFragment();
        while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
        document.body.appendChild(frag);
        if (script) {
          const newScript = document.createElement('script');
          newScript.textContent = script.textContent;
          document.body.appendChild(newScript);
        }
      }, html);

      // 验证注入
      const verified = await this.page.evaluate(() => !!document.getElementById('zhs-overlay'));
      if (verified) {
        logger.info('浮窗已注入页面 ✅');
        await this._pushStats();
        await this._pushLog();
      } else {
        logger.warn('浮窗注入后未找到，可能被页面拦截');
      }
    } catch (err) {
      logger.debug('注入浮窗失败:', err.message);
    }
  }

  /**
   * 确保浮窗存在
   */
  async ensureInjected() {
    if (!this.page) return false;
    try {
      const exists = await this.page.evaluate(() => !!document.getElementById('zhs-overlay'));
      if (!exists) {
        logger.debug('浮窗已丢失，重新注入');
        await this.inject();
        return false;
      }
      return true;
    } catch { return false; }
  }

  /**
   * 推送统计数据到浮窗
   */
  async _pushStats() {
    if (!this.page) return;
    try {
      await this.page.evaluate(function(s) {
        window.__zhsPaused = !!s.paused;

        var dot = document.getElementById('zhs-dot');
        var text = document.getElementById('zhs-status');
        if (dot) {
          if (s.paused) { dot.style.background='rgba(154,232,241,0.2)'; dot.style.boxShadow='0 0 8px rgba(154,232,241,0.12)'; text.textContent='已暂停'; }
          else if (s.running) { dot.style.background='rgba(154,232,241,0.45)'; dot.style.boxShadow='0 0 8px rgba(154,232,241,0.2)'; text.textContent='运行中'; }
          else { dot.style.background='#94a3b8'; dot.style.boxShadow='none'; text.textContent=s.statusText||'等待'; }
        }
        var bl = document.getElementById('zhs-btn-label'), bi = document.getElementById('zhs-btn-icon'), btn = document.getElementById('zhs-toggle-btn');
        if (bl && bi && btn) {
          if (s.paused) {
            btn.style.background = 'rgba(10,35,40,0.65)';
            btn.style.borderColor = 'rgba(9,54,61,0.5)';
            btn.style.color = "rgba(154,232,241,0.45)";
            bl.textContent='恢复'; bi.textContent='▶';
          } else {
            btn.style.background = 'rgba(10,35,40,0.85)';
            btn.style.borderColor = 'rgba(9,54,61,0.65)';
            btn.style.color = '#9ae8f1';
            bl.textContent='暂停'; bi.textContent='⏸';
          }
        }
        var ic = document.getElementById('zhs-interactions');
        if (ic) ic.textContent = s.interactionCount||0;
        var sp = document.getElementById('zhs-speed');
        if (sp) sp.textContent = (s.playbackRate||1.5).toFixed(1);

        var vc = document.getElementById('zhs-video-current');
        var vd = document.getElementById('zhs-video-duration');
        var vp = document.getElementById('zhs-video-pct');
        var pf = document.getElementById('zhs-progress-fill');
        if (vc) vc.textContent = s.videoCurrent||'0:00';
        if (vd) vd.textContent = s.videoDuration||'0:00';
        if (vp) vp.textContent = (s.videoPercent||0).toFixed(1)+'%';
        if (pf) pf.style.width = Math.min(s.videoPercent||0, 100)+'%';
      }, {
        paused: this.paused, running: this.running, statusText: this.statusText,
        interactionCount: this.stats.interactionCount,
        playbackRate: this.stats.playbackRate,
        videoCurrent: this.stats.videoCurrent,
        videoDuration: this.stats.videoDuration,
        videoPercent: this.stats.videoPercent,
      });
    } catch {}
  }

  /** 刷新浮窗 */
  async refresh() {
    await this.ensureInjected();
    await this._ensureExposed();
    await this._pushStats();
    await this._pushLog();
  }

  /** 添加日志 */
  addLog(level, text) {
    this.lastLog = { level, text };
    this._pushLog();
  }

  async _pushLog() {
    if (!this.page) return;
    try {
      await this.page.evaluate(function(data) {
        var el = document.getElementById('zhs-log-text');
        if (!el) return;
        var icons = { info:'ℹ', warn:'⚠', error:'✖', ok:'✔', progress:'▶' };
        var colors = { info:'rgba(154,232,241,0.45)', warn:'#f59e0b', error:'#f43f5e', ok:'#10b981', progress:'#6366f1' };
        el.textContent = (icons[data.level]||'•')+' '+data.text;
        el.style.color = colors[data.level]||'rgba(154,232,241,0.45)';
      }, this.lastLog);
    } catch {}
  }

  /** 更新视频进度 */
  updateProgress(current, duration, percent) {
    var fmt = function(s){ if(!s||isNaN(s)) return '0:00'; return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'); };
    this.stats.videoCurrent = fmt(current);
    this.stats.videoDuration = fmt(duration);
    this.stats.videoPercent = percent;
  }

  setStatus(text) {
    this.statusText = text;
    if (text === '已暂停') { this.running = false; }
    else if (text === '已停止') { this.running = false; }
    else { this.running = true; }
  }

  incrementInteraction() { this.stats.interactionCount++; }

  async close() {
    if (this.page) {
      try {
        await this.page.evaluate(function(){
          window.__zhsStopped = true; // 先停止计时器
          var el = document.getElementById('zhs-overlay');
          if (el) el.remove();
        });
      } catch {}
    }
  }
}

module.exports = { ControlPanel };

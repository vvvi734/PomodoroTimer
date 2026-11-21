/**
 * ============================================================
 *  renderer.js —— 渲染进程：界面交互 + 倒计时展示 + 主题/语言
 * ------------------------------------------------------------
 *  说明：计时逻辑在主进程（main.js），这里只负责
 *        “显示状态 + 转发用户操作 + 播放提示音”。
 * ============================================================
 */
const $ = (id) => document.getElementById(id);

let currentState = null;   // 最近一次收到的状态快照
let currentLocale = 'zh';  // 当前界面语言

/* ---------------- 提示音（Web Audio，需用户交互后解锁） ---------------- */
let audioCtx = null;

// 解锁音频上下文：浏览器/Electron 的自动播放策略要求先有用户手势
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// 阶段结束提示音：三连音上行（A5 → D6 → G6）
function playChime() {
  unlockAudio();
  if (!audioCtx) return;
  const notes = [880, 1174.66, 1567.98];
  notes.forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.2;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

/* ---------------- 工具函数 ---------------- */
// 秒 → MM:SS
function formatTime(sec) {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 分钟/个数输入裁剪：非法回退到 fallback
function clampNum(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 取译文
function tr(key, vars) {
  return window.I18N.t(currentLocale, key, vars);
}

/* ---------------- 语言切换 ---------------- */
// 把 HTML 里带 data-i18n / data-i18n-title 的静态文案统一翻译
function applyLocale(locale) {
  currentLocale = locale;
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = tr(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = tr(el.dataset.i18nTitle);
  });

  // 语言按钮显示“可切换到的目标语言”
  $('langBtn').textContent = tr('langButton');
}

/* ---------------- 界面渲染 ---------------- */
function render(state) {
  const prev = currentState;
  currentState = state;

  // 主题：由主进程给出“实际生效”的主题（跟随系统时随系统变化）
  document.documentElement.dataset.theme = state.effectiveTheme;
  // 模式配色：工作/休息/长休息（CSS 通过 body[data-mode] 切换 --accent）
  document.body.dataset.mode = state.mode;

  // 语言变化 → 重新翻译静态文案
  if (!prev || prev.locale !== state.locale) applyLocale(state.locale);

  // 倒计时大数字
  $('countdown').textContent = formatTime(state.remainingSec);

  // 状态文字：模式 + 空闲/进行中/已暂停
  const modeLabel = window.I18N.modeLabel(state.locale, state.mode);
  const statusLabel = window.I18N.statusLabel(state.locale, state.status);
  $('modeText').textContent = `${modeLabel} · ${statusLabel}`;

  // 窗口标题跟随语言与倒计时（空闲显示应用名，运行/暂停显示剩余时间 + 阶段）
  document.title = state.status === 'idle'
    ? tr('appTitle')
    : `${formatTime(state.remainingSec)} · ${modeLabel}`;

  // 阶段进度条：空闲时不显示进度
  const total = state.totalSec > 0 ? state.totalSec : 1;
  const doneRatio = state.status === 'idle'
    ? 0
    : Math.min(1, Math.max(0, 1 - state.remainingSec / total));
  $('progressBar').style.width = `${(doneRatio * 100).toFixed(1)}%`;

  // 按钮可用态与文案（暂停后“开始”变“继续”）
  $('startBtn').disabled = state.status === 'running';
  $('startBtn').textContent = state.status === 'paused' ? tr('btnResume') : tr('btnStart');
  $('pauseBtn').disabled = state.status !== 'running';
  $('skipBtn').disabled = state.status === 'idle';
  $('resetBtn').disabled = false;

  // 主题按钮文案：跟随系统 / 亮色 / 深色
  const themeKey = state.theme === 'light' ? 'themeLight'
    : state.theme === 'dark' ? 'themeDark' : 'themeSystem';
  $('themeBtn').textContent = tr(themeKey);
  $('themeBtn').classList.toggle('active', state.theme !== 'system');

  // 置顶按钮高亮
  $('pinBtn').classList.toggle('active', state.alwaysOnTop);

  // 时长输入框同步（仅当输入框未聚焦时刷新，避免打断用户正在输入的内容）
  setInputValue('workInput', state.workMinutes);
  setInputValue('restInput', state.restMinutes);
  setInputValue('longBreakInput', state.longBreakMinutes);
  setInputValue('intervalInput', state.longBreakInterval);

  // 行为开关
  setToggleVisual('autoHideBtn', state.autoHideOnStart);
  setToggleVisual('soundBtn', state.soundEnabled);
  setToggleVisual('autoNextBtn', state.autoStartNext);

  // 今日 / 累计完成数
  $('statToday').textContent = state.completedToday;
  $('statTotal').textContent = state.completedCount;

  // 长休周期圆点
  renderDots(state);
}

function setInputValue(id, value) {
  const el = $(id);
  if (document.activeElement !== el) el.value = value;
}

function setToggleVisual(id, on) {
  const el = $(id);
  el.classList.toggle('on', Boolean(on));
  el.setAttribute('aria-pressed', Boolean(on) ? 'true' : 'false');
}

// 长休进度圆点：本轮已完成几个番茄 / 还差几个
function renderDots(state) {
  const wrap = $('dots');
  const count = state.longBreakInterval;

  if (wrap.childElementCount !== count) {
    wrap.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'cycle-dot';
      wrap.appendChild(dot);
    }
  }
  [...wrap.children].forEach((el, i) => {
    el.classList.toggle('on', i < state.inCycle);
  });
  wrap.title = tr('cycleLabel');
}

/* ---------------- 交互动作 ---------------- */
function toggleRun() {
  if (!currentState) return;
  if (currentState.status === 'running') window.pomodoro.pause();
  else {
    unlockAudio();
    window.pomodoro.start();
  }
}

// 主题循环：跟随系统 → 亮色 → 深色 → 跟随系统
function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const idx = order.indexOf(currentState ? currentState.theme : 'system');
  window.pomodoro.setTheme(order[(idx + 1) % order.length]);
}

function toggleLanguage() {
  window.pomodoro.setLocale(currentLocale === 'zh' ? 'en' : 'zh');
}

/* ---------------- 初始化 ---------------- */
async function init() {
  // 1. 拉取主进程当前状态，首次渲染（含主题/语言）
  render(await window.pomodoro.getInitialState());

  // 2. 主进程状态广播 → 刷新界面（每秒一次或任意设置变更）
  window.pomodoro.onState(render);

  // 3. 阶段结束 → 播放提示音 + 刷新
  window.pomodoro.onDone((s) => {
    if (s.soundEnabled) playChime();
    render(s);
  });

  // 4. 按钮绑定
  $('startBtn').addEventListener('click', toggleRun);
  $('pauseBtn').addEventListener('click', () => window.pomodoro.pause());
  $('skipBtn').addEventListener('click', () => window.pomodoro.skip());
  $('resetBtn').addEventListener('click', () => window.pomodoro.reset());
  $('hideBtn').addEventListener('click', () => window.pomodoro.hideWindow());
  $('pinBtn').addEventListener('click', () => window.pomodoro.toggleAlwaysOnTop());
  $('themeBtn').addEventListener('click', cycleTheme);
  $('langBtn').addEventListener('click', toggleLanguage);

  // 5. 行为开关：点击即切换并立即持久化
  $('autoHideBtn').addEventListener('click', () =>
    window.pomodoro.setToggle('autoHideOnStart', !currentState.autoHideOnStart));
  $('soundBtn').addEventListener('click', () =>
    window.pomodoro.setToggle('soundEnabled', !currentState.soundEnabled));
  $('autoNextBtn').addEventListener('click', () =>
    window.pomodoro.setToggle('autoStartNext', !currentState.autoStartNext));

  // 6. 时长输入：失焦/回车立即生效（change 事件），四个值一起提交
  const applyDurations = () => {
    const s = currentState || {};
    const work = clampNum($('workInput').value, 1, 120, s.workMinutes || 25);
    const rest = clampNum($('restInput').value, 1, 120, s.restMinutes || 5);
    const longBreak = clampNum($('longBreakInput').value, 1, 60, s.longBreakMinutes || 15);
    const interval = clampNum($('intervalInput').value, 2, 8, s.longBreakInterval || 4);
    window.pomodoro.setDurations(work, rest, longBreak, interval);
  };
  ['workInput', 'restInput', 'longBreakInput', 'intervalInput'].forEach((id) => {
    $(id).addEventListener('change', applyDurations);
  });

  // 7. 键盘快捷键：空格 开始/暂停、S 跳过、R 重置（输入框内不触发）
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleRun();
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (currentState && currentState.status !== 'idle') window.pomodoro.skip();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      window.pomodoro.reset();
    }
  });

  // 8. 任意一次真实用户手势都顺手解锁音频（保证阶段结束能出声）
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
}

document.addEventListener('DOMContentLoaded', init);

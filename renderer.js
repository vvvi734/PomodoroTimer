/**
 * ============================================================
 *  renderer.js —— 渲染进程：界面交互 + 倒计时展示
 * ------------------------------------------------------------
 *  说明：计时逻辑在主进程（main.js），这里只负责“显示状态 + 转发用户操作”。
 * ============================================================
 */
const $ = (id) => document.getElementById(id);

let currentState = null; // 最近一次收到的状态快照（用于输入框校验兜底）

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

// 倒计时结束提示音：三连音上行（A5 → D6 → G6）
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
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 分钟输入裁剪：1~120，非法回退到 fallback
function clampNum(v, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(120, Math.max(1, n));
}

/* ---------------- 界面渲染 ---------------- */
function render(state) {
  currentState = state;

  // 倒计时大数字
  $('countdown').textContent = formatTime(state.remainingSec);

  // 状态文字：工作/休息 + 空闲/进行中/已暂停
  const modeName = state.mode === 'work' ? '工作' : '休息';
  const stateName = { idle: '空闲', running: '进行中', paused: '已暂停' }[state.state] || '';
  $('modeText').textContent = `${modeName} · ${stateName}`;

  // 主题色：工作橘红 / 休息薄荷绿（CSS 通过 body[data-mode] 切换 --accent）
  document.body.dataset.mode = state.mode;

  // 时长输入框同步（仅当输入框未聚焦时刷新，避免打断用户正在输入的内容）
  if (document.activeElement !== $('workInput')) $('workInput').value = state.workMinutes;
  if (document.activeElement !== $('restInput')) $('restInput').value = state.restMinutes;

  // 完成番茄数
  $('count').textContent = state.completedCount;

  // 按钮可用态
  $('startBtn').disabled = state.state === 'running';
  $('pauseBtn').disabled = state.state === 'idle';

  // 置顶按钮高亮
  $('pinBtn').classList.toggle('active', state.alwaysOnTop);
}

/* ---------------- 初始化 ---------------- */
async function init() {
  // 1. 拉取主进程当前状态，首次渲染
  render(await window.pomodoro.getInitialState());

  // 2. 主进程每秒广播 tick → 刷新界面
  window.pomodoro.onTick(render);

  // 3. 倒计时结束 → 播放提示音 + 刷新
  window.pomodoro.onDone((s) => {
    playChime();
    render(s);
  });

  // 4. 按钮绑定
  $('startBtn').addEventListener('click', () => {
    unlockAudio();              // 借开始点击解锁音频
    window.pomodoro.start();    // 主进程会启动计时并自动隐藏窗口
  });
  $('pauseBtn').addEventListener('click', () => window.pomodoro.pause());
  $('resetBtn').addEventListener('click', () => window.pomodoro.reset());
  $('hideBtn').addEventListener('click', () => window.pomodoro.hideWindow());
  $('pinBtn').addEventListener('click', () => window.pomodoro.toggleAlwaysOnTop());

  // 5. 时长输入：失焦/回车立即生效（change 事件），同时提交两个值
  const applyDurations = () => {
    const work = clampNum($('workInput').value, currentState ? currentState.workMinutes : 25);
    const rest = clampNum($('restInput').value, currentState ? currentState.restMinutes : 5);
    window.pomodoro.setDurations(work, rest);
  };
  $('workInput').addEventListener('change', applyDurations);
  $('restInput').addEventListener('change', applyDurations);
}

document.addEventListener('DOMContentLoaded', init);

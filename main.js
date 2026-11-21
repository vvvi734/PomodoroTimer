/**
 * ============================================================
 *  番茄钟 —— Electron 主进程入口（main.js）
 * ------------------------------------------------------------
 *  职责：
 *    1. 创建固定尺寸(380x560)、不可拉伸、可置顶的主窗口
 *    2. 计时逻辑放在【主进程】，保证窗口隐藏/最小化到托盘后计时照常运行
 *    3. Windows 系统通知（原生 toast，非 alert）+ 提示音（渲染进程发声）
 *    4. 系统托盘：关闭窗口最小化到托盘而非退出；托盘菜单可显示/隐藏窗口、控制计时
 *    5. 配置持久化到 userData/config.json
 *    6. 主题：自动跟随系统 / 亮色 / 深色（nativeTheme）
 *    7. 界面语言：中文 / English（默认跟随系统语言）
 *    8. 计时引擎基于“截止时间戳”，系统休眠、卡顿、事件循环延迟都不会让计时漂移
 *    9. 阶段自动推进：工作 → 休息 → 工作…，每满 N 个番茄进入长休息
 * ------------------------------------------------------------
 *  ★ 标记 = Windows 平台特有配置/注意事项
 * ============================================================
 */
const {
  app, BrowserWindow, Tray, Menu, Notification,
  ipcMain, nativeImage, nativeTheme, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const I18N = require('./i18n');

/* ================= 常量 ================= */
const WIN_W = 380;                     // 窗口固定宽度
const WIN_H = 480;                     // 窗口固定高度
const BG_DARK = '#0d0f14';             // 深色主题窗口底色（防白屏闪烁）
const BG_LIGHT = '#f4f6fa';            // 亮色主题窗口底色
const TICK_MS = 200;                   // 计时轮询间隔（内部精度，广播仍按秒）
// ★ Windows：设置 AppUserModelID，否则系统通知不会正确显示应用名/图标
const APP_ID = 'com.example.pomodoro';

/* ================= 配置（默认值 + 本地持久化） ================= */
const DEFAULT_CONFIG = {
  workMinutes: 25,        // 工作时长（分钟）
  restMinutes: 5,         // 短休息时长（分钟）
  longBreakMinutes: 15,   // 长休息时长（分钟）
  longBreakInterval: 4,   // 每完成几个番茄进入一次长休息
  completedCount: 0,      // 累计完成番茄个数
  completedToday: 0,      // 今日完成番茄个数（跨天自动清零）
  countDate: '',          // 今日计数所属日期（YYYY-MM-DD）
  alwaysOnTop: false,     // 窗口是否置顶
  autoHideOnStart: true,  // 开始计时后是否自动隐藏窗口
  soundEnabled: true,     // 是否播放提示音
  autoStartNext: true,    // 阶段结束后是否自动开始下一阶段
  theme: 'system',        // 'system' 跟随系统 / 'light' 亮色 / 'dark' 深色
  locale: null,           // 'zh' / 'en' / null 跟随系统语言
};
let config = { ...DEFAULT_CONFIG };

// 配置文件绝对路径（userData = C:\Users\<用户名>\AppData\Roaming\番茄钟）
function configFilePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// 整数范围裁剪：非法输入回退到 fallback
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 今天的日期键（本地时区）
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 校验并修正配置（防止手改配置文件写入非法值）
function sanitizeConfig() {
  config.workMinutes = clampInt(config.workMinutes, 1, 120, 25);
  config.restMinutes = clampInt(config.restMinutes, 1, 120, 5);
  config.longBreakMinutes = clampInt(config.longBreakMinutes, 1, 60, 15);
  config.longBreakInterval = clampInt(config.longBreakInterval, 2, 8, 4);
  config.completedCount = clampInt(config.completedCount, 0, 999999, 0);
  config.completedToday = clampInt(config.completedToday, 0, 9999, 0);
  config.countDate = typeof config.countDate === 'string' ? config.countDate : '';
  config.alwaysOnTop = Boolean(config.alwaysOnTop);
  // 以下三项默认开启：只有显式写入 false 才关闭
  config.autoHideOnStart = config.autoHideOnStart !== false;
  config.soundEnabled = config.soundEnabled !== false;
  config.autoStartNext = config.autoStartNext !== false;
  config.theme = ['system', 'light', 'dark'].includes(config.theme) ? config.theme : 'system';
  config.locale = (config.locale === 'zh' || config.locale === 'en') ? config.locale : null;
  // 跨天：今日计数清零
  if (config.countDate !== todayKey()) {
    config.countDate = todayKey();
    config.completedToday = 0;
  }
}

// 启动时读取本地配置（重启程序后保留设置）
function loadConfig() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    Object.assign(config, JSON.parse(raw));
  } catch (_) {
    // 首次运行（文件不存在）或解析失败 → 保持默认值
  }
  sanitizeConfig();
}

// 保存配置到本地
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

/* ================= 主题 / 语言 ================= */
// 当前真正生效的主题（跟随系统时由系统决定）
function effectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// 系统语言 → 支持的语言
function systemLocale() {
  return /^zh/i.test(app.getLocale() || '') ? 'zh' : 'en';
}

// 当前界面语言（config.locale 为空表示跟随系统）
function currentLocale() {
  return config.locale === 'zh' || config.locale === 'en' ? config.locale : systemLocale();
}

// 翻译快捷方式
function t(key, vars) {
  return I18N.t(currentLocale(), key, vars);
}

function windowBgColor() {
  return effectiveTheme() === 'dark' ? BG_DARK : BG_LIGHT;
}

/* ================= 计时器（主进程运行，窗口隐藏也不停） ================= */
/**
 * status： 'idle' 空闲 / 'running' 运行中 / 'paused' 已暂停
 * mode：   'work' 工作 / 'rest' 短休息 / 'longRest' 长休息
 * 运行中用 endAt（截止时间戳）计算剩余秒数，避免睡眠/卡顿造成累计漂移。
 */
const timer = {
  mode: 'work',
  status: 'idle',
  totalSec: config.workMinutes * 60,
  remainingSec: config.workMinutes * 60,
  endAt: null,
  inCycle: 0,            // 本轮长休息周期内已完成的番茄数
  handle: null,
};

// 某个阶段对应的总时长（秒），跟随配置变化
function phaseTotalSec(mode) {
  const minutes = mode === 'work'
    ? config.workMinutes
    : mode === 'rest'
      ? config.restMinutes
      : config.longBreakMinutes;
  return Math.max(1, minutes * 60);
}

// 切换阶段并回到空闲（不改动完成计数）
function setPhase(mode) {
  timer.mode = mode;
  timer.totalSec = phaseTotalSec(mode);
  timer.remainingSec = timer.totalSec;
  timer.endAt = null;
  timer.status = 'idle';
}

// 运行态下的实时剩余秒数
function computeRemaining() {
  if (timer.status !== 'running' || timer.endAt === null) {
    return Math.max(0, timer.remainingSec);
  }
  return Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
}

function stopLoop() {
  if (timer.handle) {
    clearInterval(timer.handle);
    timer.handle = null;
  }
}

function startLoop() {
  stopLoop();
  timer.handle = setInterval(loop, TICK_MS);
}

// 每 TICK_MS 校准一次，只有“秒数变化”才广播，减少 IPC 与重绘
function loop() {
  const rem = computeRemaining();
  if (rem <= 0) {
    timer.remainingSec = 0;
    completePhase();
    return;
  }
  if (rem !== timer.remainingSec) {
    timer.remainingSec = rem;
    broadcast();
  }
}

// 组装发给渲染进程的状态快照
function getState() {
  return {
    mode: timer.mode,
    status: timer.status,
    remainingSec: computeRemaining(),
    totalSec: timer.totalSec,
    inCycle: timer.inCycle,

    workMinutes: config.workMinutes,
    restMinutes: config.restMinutes,
    longBreakMinutes: config.longBreakMinutes,
    longBreakInterval: config.longBreakInterval,

    completedCount: config.completedCount,
    completedToday: config.completedToday,

    alwaysOnTop: config.alwaysOnTop,
    autoHideOnStart: config.autoHideOnStart,
    soundEnabled: config.soundEnabled,
    autoStartNext: config.autoStartNext,

    theme: config.theme,
    effectiveTheme: effectiveTheme(),
    locale: currentLocale(),
  };
}

// 跨天检查：今日计数自动清零（每小时/每秒都会调用，成本极低）
function checkDayRollover() {
  const today = todayKey();
  if (config.countDate !== today) {
    config.countDate = today;
    config.completedToday = 0;
    saveConfig();
  }
}

// 完成数 +1（区分累计 / 今日）
function bumpCompleted() {
  checkDayRollover();
  config.completedCount += 1;
  config.completedToday += 1;
  saveConfig();
}

/* ================= 计时控制（渲染进程 / 托盘共用） ================= */
function startTimer() {
  if (timer.status === 'running') return;
  // 空闲或已归零 → 从整段开始；暂停 → 从暂停点继续
  if (timer.status === 'idle' || timer.remainingSec <= 0) {
    timer.remainingSec = timer.totalSec;
  }
  timer.status = 'running';
  timer.endAt = Date.now() + timer.remainingSec * 1000;
  startLoop();
  // ★ 核心需求：开始计时后窗口自动隐藏到托盘（可在设置里关闭）
  if (config.autoHideOnStart) hideMainWindow();
  broadcast();
}

function pauseTimer() {
  if (timer.status !== 'running') return;
  const rem = computeRemaining();
  if (rem <= 0) {
    // 归零瞬间按下暂停 → 直接按完成处理，避免卡在 00:00
    timer.remainingSec = 0;
    completePhase();
    return;
  }
  timer.status = 'paused';
  timer.remainingSec = rem;
  timer.endAt = null;
  stopLoop();
  broadcast();
}

function resetTimer() {
  stopLoop();
  timer.inCycle = 0;
  setPhase('work');
  broadcast();
}

// 跳过当前阶段：不计入完成数，直接进入下一阶段（空闲待启动）
function skipPhase() {
  if (timer.status === 'idle') return;
  stopLoop();
  if (timer.mode === 'work') {
    // 本轮已满则下一个是长休息，否则短休息
    const next = timer.inCycle >= config.longBreakInterval ? 'longRest' : 'rest';
    setPhase(next);
  } else {
    if (timer.mode === 'longRest') timer.inCycle = 0;
    setPhase('work');
  }
  broadcast();
}

// 阶段结束：计数 + 系统通知 + 唤起窗口 + 自动进入下一阶段
function completePhase() {
  stopLoop();
  timer.remainingSec = 0;

  const finished = timer.mode;
  let nextMode;
  let title;
  let body;

  if (finished === 'work') {
    bumpCompleted();
    timer.inCycle += 1;
    const needLongRest = timer.inCycle >= config.longBreakInterval;
    nextMode = needLongRest ? 'longRest' : 'rest';
    const nextMinutes = needLongRest ? config.longBreakMinutes : config.restMinutes;
    title = t(needLongRest ? 'notifyLongRestTitle' : 'notifyWorkDoneTitle');
    body = t(needLongRest ? 'notifyLongRestBody' : 'notifyWorkDoneBody',
      { n: config.completedCount, m: nextMinutes });
  } else {
    if (finished === 'longRest') timer.inCycle = 0;  // 长休息结束 → 新一轮
    nextMode = 'work';
    title = t('notifyRestDoneTitle');
    body = t('notifyRestDoneBody');
  }

  setPhase(nextMode);
  saveConfig();
  showNotification(title, body);

  // ★ 倒计时结束：唤起窗口（渲染进程同时播放提示音）
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:done', getState());
  }

  // 自动开始下一阶段（到此为止窗口保持显示，让用户看到结果）
  if (config.autoStartNext) {
    timer.status = 'running';
    timer.endAt = Date.now() + timer.remainingSec * 1000;
    startLoop();
  }
  broadcast();
}

// ★ Windows 系统通知（原生 toast，绝不使用 alert 弹窗）
function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: !config.soundEnabled,  // 关闭提示音时，系统通知也不发声
    urgency: 'critical',           // 提升优先级，确保有声音/正常弹出
  });
  n.show();
  n.on('click', showMainWindow);   // 点击通知唤起窗口
}

/* ================= 主窗口 ================= */
let mainWindow = null;
let isQuitting = false;   // 用户从托盘选“退出”时为 true，允许真正关闭
const smokeTest = process.argv.includes('--smoke-test'); // 冒烟测试模式（自动化验证）

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    resizable: false,             // ★ 固定尺寸，禁止拉伸
    maximizable: false,           // 禁止最大化
    fullscreenable: false,
    show: false,                  // 先隐藏，渲染完成再显示，避免白屏闪烁
    alwaysOnTop: config.alwaysOnTop,
    autoHideMenuBar: true,        // 隐藏默认菜单栏，保持极简
    backgroundColor: windowBgColor(), // 与当前主题同色，防闪白
    title: t('appTitle'),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,       // 安全：渲染进程与 Node 隔离
      nodeIntegration: false,
      backgroundThrottling: false,  // 隐藏窗口时也不限制渲染进程（提示音照常播放）
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!smokeTest) {
      mainWindow.show();
      broadcast();  // 首帧后同步一次状态（标题/托盘提示/进度条）
    }
  });

  // ★ 点窗口右上角 X → 最小化到托盘，而不是退出程序
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 冒烟测试：检查 preload 桥接、i18n、主题与首帧渲染，再跑一遍状态机自检
  if (smokeTest) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = (code) => mainWindow.webContents.executeJavaScript(code);
      let ok = false;
      try {
        const info = await run(`(() => ({
          api: typeof window.pomodoro,
          i18n: typeof window.I18N,
          theme: document.documentElement.dataset.theme || '',
          lang: document.documentElement.lang || '',
          mode: document.body.dataset.mode || '',
          countdown: (document.getElementById('countdown') || {}).textContent || '',
          title: (document.querySelector('.title') || {}).textContent || '',
        }))()`);
        console.log('SMOKE_INFO:', JSON.stringify(info));

        // ---- 主题：亮色 / 深色 ----
        await run(`window.pomodoro.setTheme('light')`); await sleep(200);
        const lightTheme = await run(`document.documentElement.dataset.theme`);
        await run(`window.pomodoro.setTheme('dark')`); await sleep(200);
        const darkTheme = await run(`document.documentElement.dataset.theme`);

        // ---- 语言：切英文后静态文案 + 动态按钮文案都要变 ----
        await run(`window.pomodoro.setLocale('en')`); await sleep(250);
        const enUI = await run(`(() => ({
          title: document.querySelector('.title').textContent,
          start: document.getElementById('startBtn').textContent,
          lang: document.getElementById('langBtn').textContent,
          mode: document.getElementById('modeText').textContent,
          stats: document.querySelector('[data-i18n="statsToday"]').textContent,
        }))()`);

        // ---- 时长设置：空闲时立即刷新倒计时 ----
        await run(`window.pomodoro.setDurations(1, 2, 3, 2)`); await sleep(250);
        const durationState = await run(`window.pomodoro.getInitialState()`);
        const countdownAfter = await run(`document.getElementById('countdown').textContent`);

        // ---- 状态机：开始 → 暂停 → 跳过 → 重置 ----
        await run(`window.pomodoro.start()`); await sleep(400);
        const running = await run(`window.pomodoro.getInitialState()`);
        await run(`window.pomodoro.pause()`); await sleep(250);
        const paused = await run(`window.pomodoro.getInitialState()`);
        await run(`window.pomodoro.skip()`); await sleep(250);
        const skipped = await run(`window.pomodoro.getInitialState()`);
        await run(`window.pomodoro.reset()`); await sleep(250);
        const reset = await run(`window.pomodoro.getInitialState()`);

        ok = info.api === 'object'
          && info.i18n === 'object'
          && info.theme !== ''
          && /^\d{2}:\d{2}$/.test(info.countdown.trim())
          && lightTheme === 'light'
          && darkTheme === 'dark'
          && enUI.title === 'Pomodoro'
          && enUI.start === 'Start'
          && enUI.lang === '中文'
          && durationState.workMinutes === 1
          && countdownAfter.trim() === '01:00'
          && running.status === 'running'
          && paused.status === 'paused'
          && skipped.mode === 'rest' && skipped.status === 'idle'
          && reset.mode === 'work' && reset.status === 'idle';

        console.log('SMOKE_STEPS:', JSON.stringify({
          lightTheme, darkTheme, enUI, countdownAfter,
          durationState: durationState.workMinutes, running: running.status,
          paused: paused.status, skipped: `${skipped.mode}/${skipped.status}`,
          reset: `${reset.mode}/${reset.status}`,
        }));
        console.log(ok ? 'SMOKE_OK: preload + i18n + theme + timer state machine' : 'SMOKE_FAIL: check SMOKE_STEPS');
      } catch (e) {
        console.log('SMOKE_FAIL:', e.message);
      }
      setTimeout(() => app.exit(ok ? 0 : 1), 300);
    });
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

function toggleMainWindow() {
  if (mainWindow && mainWindow.isVisible()) hideMainWindow();
  else showMainWindow();
}

function setAlwaysOnTop(on) {
  config.alwaysOnTop = Boolean(on);
  saveConfig();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(config.alwaysOnTop);
  broadcast();
}

// 切换主题（'system' / 'light' / 'dark'）
function setTheme(theme) {
  if (!['system', 'light', 'dark'].includes(theme)) return;
  config.theme = theme;
  saveConfig();
  nativeTheme.themeSource = theme;          // 让 Chromium 同步明暗配色
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBgColor());
  }
  traySignature = '';                        // 托盘单选项需要重建
  broadcast();
}

// 切换界面语言（'zh' / 'en'）
function setLocale(locale) {
  if (locale !== 'zh' && locale !== 'en') return;
  config.locale = locale;
  saveConfig();
  traySignature = '';                        // 托盘菜单文案需要重建
  broadcast();
}

// 设置开关项
const TOGGLE_KEYS = ['autoHideOnStart', 'soundEnabled', 'autoStartNext'];
function setToggle(key, value) {
  if (!TOGGLE_KEYS.includes(key)) return;
  config[key] = Boolean(value);
  saveConfig();
  broadcast();
}

// 修改时长：立即保存；空闲时立刻刷新剩余时间，运行/暂停中不打断当前倒计时
function setDurations(work, rest, longBreak, interval) {
  config.workMinutes = clampInt(work, 1, 120, 25);
  config.restMinutes = clampInt(rest, 1, 120, 5);
  config.longBreakMinutes = clampInt(longBreak, 1, 60, 15);
  config.longBreakInterval = clampInt(interval, 2, 8, 4);
  if (timer.status === 'idle') {
    timer.totalSec = phaseTotalSec(timer.mode);
    timer.remainingSec = timer.totalSec;
  }
  saveConfig();
  broadcast();
}

/* ================= 窗口外观 / 托盘提示同步 ================= */
function formatTime(sec) {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 窗口标题 + 任务栏进度条 + 托盘悬浮提示
function updateWindowChrome(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const active = state.status !== 'idle';
  const modeLabel = I18N.modeLabel(state.locale, state.mode);

  mainWindow.setTitle(active
    ? `${formatTime(state.remainingSec)} · ${modeLabel}`
    : t('appTitle'));

  if (active && state.totalSec > 0) {
    mainWindow.setProgressBar(Math.min(1, Math.max(0, 1 - state.remainingSec / state.totalSec)));
  } else {
    mainWindow.setProgressBar(-1);   // -1 = 清除任务栏进度
  }

  if (tray) {
    tray.setToolTip(`${t('appTitle')} · ${modeLabel} ${formatTime(state.remainingSec)}`);
  }
}

// 广播状态给渲染进程 + 同步窗口外观
function broadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  checkDayRollover();
  const state = getState();
  mainWindow.webContents.send('state:update', state);
  updateWindowChrome(state);
  refreshTrayMenu(state);
}

/* ================= 系统托盘 ================= */
let tray = null;
let trayIcon = null;
let traySignature = '';   // 菜单内容签名，只有状态变化时才重建

function createTrayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  if (!img.isEmpty()) {
    trayIcon = img.resize({ width: 16, height: 16 }); // Windows 托盘标准尺寸
  } else {
    // 兜底：内嵌 16x16 红色圆点图标，保证程序缺文件时也能运行
    trayIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAX4n236HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAl1eYWMDm9AAAAAAASUVORK5CYII='
    );
  }
}

function createTray() {
  tray = new Tray(trayIcon);
  tray.setToolTip(t('appTitle'));
  // ★ Windows：左键单击显示/隐藏窗口；右键单击弹出菜单
  tray.on('click', toggleMainWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  tray.setContextMenu(buildTrayMenu());
  traySignature = traySignatureOf(getState());
}

// 托盘菜单：显示/隐藏、开始/暂停/跳过/重置、主题、语言、置顶、退出
function buildTrayMenu() {
  const running = timer.status === 'running';
  const paused = timer.status === 'paused';
  const idle = timer.status === 'idle';
  return Menu.buildFromTemplate([
    { label: t('trayShow'), click: showMainWindow },
    { label: t('trayHide'), click: hideMainWindow },
    { type: 'separator' },
    {
      label: running ? t('trayPause') : paused ? t('trayResume') : t('trayStart'),
      click: running ? pauseTimer : startTimer,
    },
    { label: t('traySkip'), enabled: !idle, click: skipPhase },
    { label: t('trayReset'), click: resetTimer },
    { type: 'separator' },
    {
      label: t('trayTheme'),
      submenu: [
        { label: t('themeSystemItem'), type: 'radio', checked: config.theme === 'system', click: () => setTheme('system') },
        { label: t('themeLightItem'), type: 'radio', checked: config.theme === 'light', click: () => setTheme('light') },
        { label: t('themeDarkItem'), type: 'radio', checked: config.theme === 'dark', click: () => setTheme('dark') },
      ],
    },
    {
      label: t('trayLanguage'),
      submenu: [
        { label: t('langZhItem'), type: 'radio', checked: currentLocale() === 'zh', click: () => setLocale('zh') },
        { label: t('langEnItem'), type: 'radio', checked: currentLocale() === 'en', click: () => setLocale('en') },
      ],
    },
    { label: t('trayAlwaysOnTop'), type: 'checkbox', checked: config.alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
    { type: 'separator' },
    { label: t('trayQuit'), click: quitApp },
  ]);
}

function traySignatureOf(state) {
  return [state.mode, state.status, state.alwaysOnTop, state.theme, state.locale].join('|');
}

// 状态签名变化时才重建菜单（避免每秒重建）
function refreshTrayMenu(state) {
  if (!tray) return;
  const sig = traySignatureOf(state);
  if (sig === traySignature) return;
  traySignature = sig;
  tray.setContextMenu(buildTrayMenu());
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

/* ================= IPC（渲染进程 <-> 主进程） ================= */
function registerIpc() {
  // 渲染进程加载完成后拉取一次初始状态
  ipcMain.handle('state:get', () => getState());

  // 计时控制
  ipcMain.on('timer:start', startTimer);
  ipcMain.on('timer:pause', pauseTimer);
  ipcMain.on('timer:reset', resetTimer);
  ipcMain.on('timer:skip', skipPhase);

  // 时长设置（四个输入框一起提交）
  ipcMain.on('config:set-durations', (_e, payload = {}) => {
    setDurations(payload.work, payload.rest, payload.longBreak, payload.interval);
  });

  // 开关项
  ipcMain.on('config:set-toggle', (_e, { key, value } = {}) => setToggle(key, value));

  // 主题 / 语言
  ipcMain.on('config:set-theme', (_e, theme) => setTheme(theme));
  ipcMain.on('config:set-locale', (_e, locale) => setLocale(locale));

  // 窗口控制
  ipcMain.on('window:hide', hideMainWindow);
  ipcMain.on('window:toggle-always-on-top', () => setAlwaysOnTop(!config.alwaysOnTop));
}

/* ================= 应用生命周期 ================= */
// ★ Windows：必须在创建任何窗口/通知之前设置，否则 toast 显示异常
app.setAppUserModelId(APP_ID);

// 单实例：避免托盘出现多个图标、多个计时器同时跑
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 二次启动 → 直接唤起已有窗口
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    showMainWindow();
  });

  app.whenReady().then(() => {
    loadConfig();             // 1. 读取本地配置
    setPhase('work');         //    用配置里的工作时长初始化计时器
    nativeTheme.themeSource = config.theme; // 2. 应用主题来源（跟随系统/亮/暗）
    createTrayIcon();         // 3. 准备托盘图标
    createWindow();           // 4. 创建主窗口
    registerIpc();            // 5. 注册 IPC
    if (!smokeTest) createTray(); // 6. 创建托盘（冒烟测试不建托盘，避免残留图标）

    // 系统主题变化（只在“跟随系统”时真正影响界面，但仍需同步窗口底色）
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(windowBgColor());
      }
      broadcastIfReady();
    });

    // 系统从睡眠恢复：立即校准一次，避免睡眠期间“白等”
    powerMonitor.on('resume', () => {
      if (timer.status === 'running') loop();
    });
    powerMonitor.on('unlock-screen', () => {
      if (timer.status === 'running') loop();
    });

    // macOS 点击 Dock 图标重新显示窗口（保留跨平台兼容）
    app.on('activate', () => showMainWindow());
  });

  // ★ Windows：所有窗口关闭后不退出，托盘常驻
  app.on('window-all-closed', () => {
    // 保持进程存活，仅通过托盘“退出”结束
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });
}

// 广播兜底：窗口尚未就绪时不报错
function broadcastIfReady() {
  if (mainWindow && !mainWindow.isDestroyed()) broadcast();
}

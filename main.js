/**
 * ============================================================
 *  番茄钟 —— Electron 主进程入口（main.js）
 * ------------------------------------------------------------
 *  职责：
 *    1. 创建固定尺寸(380x480)、不可拉伸、可置顶的主窗口
 *    2. 计时逻辑放在【主进程】，保证窗口隐藏/最小化到托盘后计时照常运行
 *    3. Windows 系统通知（原生 toast，非 alert）+ 提示音
 *    4. 系统托盘：关闭窗口最小化到托盘而非退出；托盘菜单可显示/隐藏窗口、控制计时
 *    5. 配置（工作时长/休息时长/完成数/置顶状态）持久化到 userData/config.json
 * ------------------------------------------------------------
 *  ★ 标记 = Windows 平台特有配置/注意事项
 * ============================================================
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

/* ================= 常量 ================= */
const WIN_W = 380;                     // 窗口固定宽度
const WIN_H = 480;                     // 窗口固定高度
// ★ Windows：设置 AppUserModelID，否则系统通知不会正确显示应用名/图标
const APP_ID = 'com.example.pomodoro';

/* ================= 配置（默认值 + 本地持久化） ================= */
const DEFAULT_CONFIG = {
  workMinutes: 25,     // 工作时长（分钟）
  restMinutes: 5,      // 休息时长（分钟）
  completedCount: 0,   // 已完成番茄个数
  alwaysOnTop: false,  // 窗口是否置顶
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

// 启动时读取本地配置（重启程序后保留设置）
function loadConfig() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    Object.assign(config, JSON.parse(raw));
  } catch (_) {
    // 首次运行（文件不存在）或解析失败 → 保持默认值
  }
  config.workMinutes = clampInt(config.workMinutes, 1, 120, 25);
  config.restMinutes = clampInt(config.restMinutes, 1, 120, 5);
  config.completedCount = clampInt(config.completedCount, 0, 99999, 0);
  config.alwaysOnTop = Boolean(config.alwaysOnTop);
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

/* ================= 计时器（主进程运行，窗口隐藏也不停） ================= */
const timer = {
  mode: 'work',          // 'work' 工作 / 'rest' 休息
  state: 'idle',         // 'idle' 空闲 / 'running' 运行中 / 'paused' 已暂停
  remainingSec: 25 * 60, // 剩余秒数
  interval: null,        // setInterval 句柄
};

// 当前模式的总时长（秒）
function currentTotalSec() {
  const minutes = timer.mode === 'work' ? config.workMinutes : config.restMinutes;
  return minutes * 60;
}

// 组装发给渲染进程的状态快照
function getState() {
  return {
    mode: timer.mode,
    state: timer.state,
    remainingSec: Math.max(0, timer.remainingSec),
    workMinutes: config.workMinutes,
    restMinutes: config.restMinutes,
    completedCount: config.completedCount,
    alwaysOnTop: config.alwaysOnTop,
  };
}

// 广播状态给渲染进程（每秒）
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:tick', getState());
  }
}

function startTimer() {
  if (timer.state === 'running') return;
  if (timer.state === 'idle') timer.remainingSec = currentTotalSec(); // 从整段开始
  timer.state = 'running';
  clearInterval(timer.interval);
  timer.interval = setInterval(tick, 1000);
  // ★ 核心需求：开始计时后窗口自动隐藏到托盘，不占用屏幕
  hideMainWindow();
  broadcast();
}

function pauseTimer() {
  if (timer.state !== 'running') return;
  timer.state = 'paused';
  clearInterval(timer.interval);
  broadcast();
}

function resetTimer() {
  clearInterval(timer.interval);
  timer.state = 'idle';
  timer.mode = 'work';
  timer.remainingSec = currentTotalSec();
  broadcast();
}

// 每秒回调
function tick() {
  timer.remainingSec -= 1;
  if (timer.remainingSec <= 0) {
    onCountdownComplete();
  } else {
    broadcast();
  }
}

// 倒计时归零：发系统通知 + 唤起窗口 + 自动切换工作/休息
function onCountdownComplete() {
  clearInterval(timer.interval);

  if (timer.mode === 'work') {
    // 工作结束 → 完成数 +1 → 自动进入休息并继续倒计时
    config.completedCount += 1;
    saveConfig();
    showNotification('番茄完成', `已完成 ${config.completedCount} 个番茄，休息 ${config.restMinutes} 分钟吧`);
    timer.mode = 'rest';
    timer.remainingSec = config.restMinutes * 60;
    timer.state = 'running';
    timer.interval = setInterval(tick, 1000);
  } else {
    // 休息结束 → 回到工作待机状态（等待手动开始）
    showNotification('休息结束', '休息结束，开始新的番茄吧');
    timer.mode = 'work';
    timer.remainingSec = config.workMinutes * 60;
    timer.state = 'idle';
  }

  // ★ 倒计时结束：唤起显示窗口（渲染进程同时播放提示音）
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:done', getState());
  }
  broadcast();
}

// ★ Windows 系统通知（原生 toast，绝不使用 alert 弹窗）
function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: false,          // false = 播放 Windows 系统提示音
    urgency: 'critical',    // 提升优先级，确保有声音/正常弹出
  });
  n.show();
  n.on('click', showMainWindow); // 点击通知唤起窗口
}

/* ================= 主窗口 ================= */
let mainWindow = null;
let isQuitting = false;   // 用户从托盘选“退出”时为 true，允许真正关闭
const smokeTest = process.argv.includes('--smoke-test'); // 冒烟测试模式（自动化验证）

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    resizable: false,          // ★ 固定尺寸，禁止拉伸
    maximizable: false,        // 禁止最大化
    fullscreenable: false,
    show: false,               // 先隐藏，渲染完成再显示，避免白屏闪烁
    alwaysOnTop: config.alwaysOnTop, // 支持置顶（默认关，可托盘/按钮切换）
    autoHideMenuBar: true,     // 隐藏默认菜单栏，保持极简
    title: '番茄钟',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,       // 安全：渲染进程与 Node 隔离
      nodeIntegration: false,
      backgroundThrottling: false,  // 隐藏窗口时也不限制渲染进程
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!smokeTest) mainWindow.show();
  });

  // ★ 点窗口右上角 X → 最小化到托盘，而不是退出程序
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 冒烟测试：页面加载完成后检查 preload 桥接是否生效，然后自动退出
  if (smokeTest) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let hasApi = false;
      try {
        hasApi = await mainWindow.webContents.executeJavaScript(
          'typeof window.pomodoro !== "undefined"'
        );
        console.log('SMOKE_OK: window loaded, preload api =', hasApi);
      } catch (e) {
        console.log('SMOKE_FAIL:', e.message);
      }
      setTimeout(() => app.exit(hasApi ? 0 : 1), 300);
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
  config.alwaysOnTop = on;
  saveConfig();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(on);
  broadcast();
}

/* ================= 系统托盘 ================= */
let tray = null;
let trayIcon = null;

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
  tray.setToolTip('番茄钟');
  // ★ Windows：左键单击显示/隐藏窗口；右键单击弹出菜单
  tray.on('click', toggleMainWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
}

// 托盘菜单：显示/隐藏主窗口、开始/暂停/重置、置顶、退出
function buildTrayMenu() {
  const running = timer.state === 'running';
  const paused = timer.state === 'paused';
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '隐藏主窗口', click: hideMainWindow },
    { type: 'separator' },
    {
      label: running ? '暂停' : paused ? '继续' : '开始',
      click: running ? pauseTimer : startTimer,
    },
    { label: '重置', click: resetTimer },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    { label: '退出', click: quitApp },
  ]);
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

/* ================= IPC（渲染进程 <-> 主进程） ================= */
function registerIpc() {
  // 渲染进程加载完成后拉取一次初始状态
  ipcMain.handle('get-initial-state', () => getState());

  // 计时控制
  ipcMain.on('timer:start', startTimer);
  ipcMain.on('timer:pause', pauseTimer);
  ipcMain.on('timer:reset', resetTimer);

  // 修改工作时长/休息时长：立即生效 + 保存到本地
  ipcMain.on('timer:set-durations', (_e, { work, rest }) => {
    config.workMinutes = clampInt(work, 1, 120, 25);
    config.restMinutes = clampInt(rest, 1, 120, 5);
    saveConfig();
    // 立即生效：当前阶段的剩余时间刷新为新时长（运行中则保持运行）
    timer.remainingSec = currentTotalSec();
    broadcast();
  });

  // 窗口控制
  ipcMain.on('window:hide', hideMainWindow);
  ipcMain.on('window:toggle-always-on-top', () => setAlwaysOnTop(!config.alwaysOnTop));
}

/* ================= 应用生命周期 ================= */
// ★ Windows：必须在创建任何窗口/通知之前设置，否则 toast 显示异常
app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  loadConfig();       // 1. 读取本地配置
  createTrayIcon();   // 2. 准备托盘图标
  createWindow();     // 3. 创建主窗口
  registerIpc();      // 4. 注册 IPC
  if (!smokeTest) createTray(); // 5. 创建托盘（冒烟测试不建托盘，避免残留图标）

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

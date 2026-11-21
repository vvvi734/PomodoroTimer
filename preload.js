/**
 * ============================================================
 *  preload.js —— 安全桥接层
 * ------------------------------------------------------------
 *  作用：通过 contextBridge 向渲染进程暴露受限 API。
 *        渲染进程无法直接访问 Node，只能调用这里的封装方法，
 *        并通过 ipcRenderer 与主进程通信。
 * ============================================================
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  // 获取初始状态（渲染进程加载完成时调用一次）
  getInitialState: () => ipcRenderer.invoke('state:get'),

  // ---- 计时控制 ----
  start: () => ipcRenderer.send('timer:start'),
  pause: () => ipcRenderer.send('timer:pause'),
  reset: () => ipcRenderer.send('timer:reset'),
  skip: () => ipcRenderer.send('timer:skip'),

  // ---- 设置：时长（分钟）、开关项、主题、语言，主进程负责校验并保存 ----
  setDurations: (work, rest, longBreak, interval) =>
    ipcRenderer.send('config:set-durations', { work, rest, longBreak, interval }),
  setToggle: (key, value) => ipcRenderer.send('config:set-toggle', { key, value }),
  setTheme: (theme) => ipcRenderer.send('config:set-theme', theme),
  setLocale: (locale) => ipcRenderer.send('config:set-locale', locale),

  // ---- 窗口控制 ----
  hideWindow: () => ipcRenderer.send('window:hide'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),

  // ---- 主进程 → 渲染进程事件 ----
  onState: (cb) => ipcRenderer.on('state:update', (_e, s) => cb(s)), // 状态刷新（每秒/每次变更）
  onDone: (cb) => ipcRenderer.on('timer:done', (_e, s) => cb(s)),   // 阶段结束（播放提示音）
});

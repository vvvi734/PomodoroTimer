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
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),

  // ---- 计时控制 ----
  start: () => ipcRenderer.send('timer:start'),
  pause: () => ipcRenderer.send('timer:pause'),
  reset: () => ipcRenderer.send('timer:reset'),

  // ---- 设置时长（分钟），主进程负责校验并保存 ----
  setDurations: (work, rest) => ipcRenderer.send('timer:set-durations', { work, rest }),

  // ---- 窗口控制 ----
  hideWindow: () => ipcRenderer.send('window:hide'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),

  // ---- 主进程 → 渲染进程事件 ----
  onTick: (cb) => ipcRenderer.on('timer:tick', (_e, s) => cb(s)), // 每秒状态刷新
  onDone: (cb) => ipcRenderer.on('timer:done', (_e, s) => cb(s)), // 倒计时结束（播放提示音）
});

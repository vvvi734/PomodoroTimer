/**
 * ============================================================
 *  i18n.js —— 中英文文案表（主进程 / 渲染进程共用）
 * ------------------------------------------------------------
 *  主进程：  const I18N = require('./i18n');
 *  渲染进程：<script src="i18n.js"></script>  →  window.I18N
 *
 *  用法：I18N.t(locale, key, { n: 3, m: 5 })
 *       占位符写作 {n} / {m}，缺失时回退中文，再回退 key 本身。
 * ============================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.I18N = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const STRINGS = {
    /* ---------------- 中文 ---------------- */
    zh: {
      appTitle: '番茄钟',

      modeWork: '工作',
      modeRest: '休息',
      modeLongRest: '长休息',

      statusIdle: '空闲',
      statusRunning: '进行中',
      statusPaused: '已暂停',

      btnStart: '开始',
      btnResume: '继续',
      btnPause: '暂停',
      btnSkip: '跳过',
      btnReset: '重置',
      btnPin: '置顶',
      btnHide: '隐藏',

      themeTitle: '主题：自动 / 亮色 / 深色（点击切换）',
      themeSystem: '自动',
      themeLight: '亮色',
      themeDark: '深色',

      langTitle: '切换界面语言',
      langButton: 'EN',

      pinTitle: '窗口置顶',
      hideTitle: '隐藏到系统托盘',

      labelWork: '工作时长',
      labelRest: '休息时长',
      labelLongRest: '长休时长',
      labelInterval: '长休间隔',
      unitMinute: '分钟',
      unitPomodoro: '个番茄',

      autoHide: '自动隐藏',
      autoHideTitle: '开始计时后自动隐藏窗口到托盘',
      soundOn: '提示音',
      soundTitle: '倒计时结束时播放提示音',
      autoNext: '自动继续',
      autoNextTitle: '阶段结束后自动开始下一阶段',

      statsToday: '今日',
      statsTotal: '累计',
      cycleLabel: '长休进度',

      trayShow: '显示主窗口',
      trayHide: '隐藏主窗口',
      trayStart: '开始',
      trayResume: '继续',
      trayPause: '暂停',
      traySkip: '跳过当前阶段',
      trayReset: '重置',
      trayTheme: '主题',
      trayLanguage: '语言',
      trayAlwaysOnTop: '窗口置顶',
      trayQuit: '退出',

      themeSystemItem: '跟随系统',
      themeLightItem: '亮色',
      themeDarkItem: '深色',
      langZhItem: '中文',
      langEnItem: 'English',

      notifyWorkDoneTitle: '番茄完成',
      notifyWorkDoneBody: '已完成 {n} 个番茄，休息 {m} 分钟吧',
      notifyLongRestTitle: '该长休息了',
      notifyLongRestBody: '已完成 {n} 个番茄，长休息 {m} 分钟',
      notifyRestDoneTitle: '休息结束',
      notifyRestDoneBody: '休息结束，开始新的番茄吧',
    },

    /* ---------------- English ---------------- */
    en: {
      appTitle: 'Pomodoro',

      modeWork: 'Work',
      modeRest: 'Break',
      modeLongRest: 'Long Break',

      statusIdle: 'Idle',
      statusRunning: 'Running',
      statusPaused: 'Paused',

      btnStart: 'Start',
      btnResume: 'Resume',
      btnPause: 'Pause',
      btnSkip: 'Skip',
      btnReset: 'Reset',
      btnPin: 'Pin',
      btnHide: 'Hide',

      themeTitle: 'Theme: auto / light / dark (click to switch)',
      themeSystem: 'Auto',
      themeLight: 'Light',
      themeDark: 'Dark',

      langTitle: 'Switch interface language',
      langButton: '中文',

      pinTitle: 'Always on top',
      hideTitle: 'Hide to tray',

      labelWork: 'Work',
      labelRest: 'Break',
      labelLongRest: 'Long break',
      labelInterval: 'Every',
      unitMinute: 'min',
      unitPomodoro: 'poms',

      autoHide: 'Auto-hide',
      autoHideTitle: 'Hide the window to the tray when a session starts',
      soundOn: 'Sound',
      soundTitle: 'Play a chime when the countdown ends',
      autoNext: 'Auto-next',
      autoNextTitle: 'Start the next phase automatically',

      statsToday: 'Today',
      statsTotal: 'Total',
      cycleLabel: 'Long-break progress',

      trayShow: 'Show Window',
      trayHide: 'Hide Window',
      trayStart: 'Start',
      trayResume: 'Resume',
      trayPause: 'Pause',
      traySkip: 'Skip Phase',
      trayReset: 'Reset',
      trayTheme: 'Theme',
      trayLanguage: 'Language',
      trayAlwaysOnTop: 'Always on Top',
      trayQuit: 'Quit',

      themeSystemItem: 'Follow System',
      themeLightItem: 'Light',
      themeDarkItem: 'Dark',
      langZhItem: '中文',
      langEnItem: 'English',

      notifyWorkDoneTitle: 'Pomodoro Complete',
      notifyWorkDoneBody: '{n} pomodoros done. Take a {m}-minute break.',
      notifyLongRestTitle: 'Time for a Long Break',
      notifyLongRestBody: '{n} pomodoros done. Take a {m}-minute long break.',
      notifyRestDoneTitle: 'Break Over',
      notifyRestDoneBody: 'Break is over. Start a new pomodoro.',
    },
  };

  const MODE_KEYS = { work: 'modeWork', rest: 'modeRest', longRest: 'modeLongRest' };
  const STATUS_KEYS = { idle: 'statusIdle', running: 'statusRunning', paused: 'statusPaused' };

  // 取文案并做 {var} 插值
  function t(locale, key, vars) {
    const table = STRINGS[locale] || STRINGS.zh;
    let str = table[key];
    if (str === undefined) str = STRINGS.zh[key];
    if (str === undefined) return key;
    if (vars) {
      str = str.replace(/\{(\w+)\}/g, (m, k) =>
        vars[k] !== undefined ? String(vars[k]) : m
      );
    }
    return str;
  }

  return {
    t,
    locales: ['zh', 'en'],
    modeLabel: (locale, mode) => t(locale, MODE_KEYS[mode] || 'modeWork'),
    statusLabel: (locale, status) => t(locale, STATUS_KEYS[status] || 'statusIdle'),
  };
});

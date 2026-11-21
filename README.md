# 番茄钟（Pomodoro Timer）

Windows 桌面番茄钟小工具，基于 Electron。深色 / 亮色双主题、中英双语，工作模式橘红、休息薄荷绿、长休息蓝。

## 功能特性

### 计时与阶段
- **精确计时**：主进程基于「截止时间戳」计算剩余秒数，系统休眠、卡顿、事件循环延迟都不会让倒计时漂移；睡眠/解锁后自动校准
- **阶段自动推进**：工作 → 短休息 → 工作… 每完成 N 个番茄（默认 4）自动进入一次长休息（默认 15 分钟）
- **长休周期圆点**：底部小圆点显示本轮已完成的番茄数
- **跳过当前阶段**：不计入完成数，直接进入下一阶段
- 计时运行期间窗口自动隐藏到系统托盘（可在设置中关闭）；倒计时结束弹出 **Windows 系统通知（原生 toast，非 alert）** + 提示音，并自动唤起窗口

### 界面与主题
- **深色 / 亮色 / 跟随系统** 三种主题：主题按钮一键循环切换，也可在托盘菜单里选择
- 开启「跟随系统」时，Windows 切换深浅色后界面即时同步，无需重启
- 亮色主题单独调过强调色，保证白底下的对比度
- 界面语言：**中文 / English**，首次运行默认跟随系统语言；切换后标题、按钮、设置、托盘菜单、系统通知全部同步
- 窗口标题与任务栏进度条实时显示剩余时间与当前阶段

### 交互与使用逻辑
- 按钮：开始 / 继续 / 暂停 / 跳过 / 重置（暂停后「开始」自动变为「继续」）
- **键盘快捷键**：`空格` 开始或暂停、`S` 跳过当前阶段、`R` 重置（输入框聚焦时不触发）
- **单实例**：重复启动只会唤起已有窗口，不会同时跑两个计时器、出现两个托盘图标
- **修改时长不打断计时**：运行/暂停中改时长只影响下一阶段，不会把正在跑的倒计时重置
- **今日计数**：跨天自动清零，同时保留累计完成数
- 窗口固定 380×480，不可拉伸；支持一键置顶（窗口按钮 / 托盘菜单）
- 关闭窗口 → 最小化到系统托盘（不退出）；托盘菜单可显示/隐藏窗口、开始/暂停/跳过/重置、切换主题与语言、置顶、退出

## 使用说明

| 操作 | 方式 |
| --- | --- |
| 开始 / 继续 / 暂停 | 点击「开始」按钮，或按 `空格` |
| 跳过当前阶段 | 点击「跳过」，或按 `S`（不计入完成数） |
| 重置会话 | 点击「重置」，或按 `R`（回到工作 空闲，长休周期清零） |
| 切换主题 | 点击右上角主题按钮：自动 → 亮色 → 深色 → 自动 |
| 切换语言 | 点击右上角 `EN` / `中文` 按钮 |
| 设置时长 | 四个输入框，回车或失焦即生效并保存 |
| 行为开关 | 自动隐藏（开始后隐藏到托盘）、提示音、自动继续（阶段结束后自动开始下一阶段） |
| 置顶 / 隐藏 | 右上角「置顶」「隐藏」按钮 |

## 目录结构
```
pomodoro-timer/
├── package.json        # 项目配置、脚本、electron-builder 打包配置
├── main.js             # 主进程：窗口/托盘/系统通知/计时引擎/主题/语言/配置持久化
├── preload.js          # 安全桥接层（contextBridge）
├── i18n.js             # 中英文案表（主进程与渲染进程共用）
├── index.html          # 渲染进程页面
├── renderer.js         # 渲染进程逻辑：界面渲染、主题/语言、提示音、快捷键
├── style.css           # 深色 / 亮色双主题样式
├── scripts/
│   └── create-desktop-shortcut.ps1   # 生成/更新桌面快捷方式
├── assets/icon.png     # 应用图标（托盘/窗口图标）
└── build/icon.ico      # Windows 打包用图标
```

## 运行与打包

### 1. 安装依赖
```powershell
npm install
```

### 2. 本地运行调试
```powershell
npm start
```

### 3. 冒烟测试（自动验证 preload、i18n、主题、计时状态机后退出）
```powershell
npm run smoke
```

### 4. 打包
- 目录版（可直接运行，无需安装）：`npm run pack:dir`
- 便携版（免安装单文件 exe）：`npm run pack`
- 安装版（NSIS 安装程序 exe）：`npm run dist`

产物输出到 `release/` 目录。

> 首次打包会下载 electron-builder 所需的 Windows 打包工具，需要联网，耗时较长属正常。

> **关于杀软误报**：`npm run pack` 生成的便携版 exe 是**未签名 + 自解压**封装（运行时解压到临时目录再启动），火绒、360 等杀软常按“自解压释放并执行”的启发式规则误报。程序自身只依赖 `electron` / `path` / `fs`，无联网、无子进程、无动态执行代码，CSP 仅允许本地资源；桌面快捷方式指向的是 `release\win-unpacked\番茄钟.exe`（目录版），不受该误报影响。不需要单文件分发时，建议直接用 `npm run pack:dir`。

### 5. 桌面快捷方式
```powershell
npm run shortcut
```
在桌面生成 / 更新「番茄钟」快捷方式，指向 `release\win-unpacked\番茄钟.exe`（启动最快）；若该目录不存在，会自动回退到 `release` 下最新的便携版 exe。快捷方式已存在时直接覆盖。

## 配置持久化位置
`C:\Users\<用户名>\AppData\Roaming\pomodoro-timer\config.json`

主要字段：

| 字段 | 说明 |
| --- | --- |
| `workMinutes` / `restMinutes` / `longBreakMinutes` | 工作 / 短休 / 长休时长（分钟） |
| `longBreakInterval` | 每几个番茄进入一次长休息（2–8） |
| `completedCount` / `completedToday` / `countDate` | 累计完成数 / 今日完成数 / 所属日期 |
| `alwaysOnTop` | 窗口置顶 |
| `autoHideOnStart` | 开始计时后自动隐藏窗口 |
| `soundEnabled` | 提示音 |
| `autoStartNext` | 阶段结束后自动开始下一阶段 |
| `theme` | `system` 跟随系统 / `light` 亮色 / `dark` 深色 |
| `locale` | `zh` / `en`；留空表示跟随系统语言 |

---

## English (brief)

A minimal Windows Pomodoro timer built with Electron.

- **Themes**: dark, light, or follow the system — switch with the theme button or from the tray menu. When set to "Auto", the UI follows Windows light/dark changes live.
- **Languages**: Chinese / English, defaulting to the system locale. Window title, tray menu, and system notifications all switch with the interface.
- **Timer**: deadline-based countdown in the main process, so sleep/suspend or UI stalls never make it drift. Work → break → work, with a long break every N pomodoros.
- **Controls**: start / resume / pause / skip / reset; `Space` starts or pauses, `S` skips the current phase, `R` resets.
- **Extras**: single-instance lock, today + total counters, taskbar progress, live window title, auto-hide to tray when a session starts (toggleable), native Windows toast notifications on completion, and config persistence.

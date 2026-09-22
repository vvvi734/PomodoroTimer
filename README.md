# 番茄钟（Pomodoro Timer）

Windows 桌面番茄钟小工具，基于 Electron。深色极简科技风，工作模式橘红、休息模式薄荷绿。

## 功能特性
- 计时运行期间窗口自动隐藏到系统托盘，不占用屏幕；倒计时结束弹出 **Windows 系统通知（原生 toast，非 alert）** + 提示音，并自动唤起显示窗口
- 窗口固定 380×480，不可拉伸；支持一键置顶（窗口按钮 / 托盘菜单）
- 自定义工作时长、休息时长（输入框，单位分钟），修改立即生效，保存到本地，重启保留
- 默认预设：工作 25 分钟，短休息 5 分钟
- 按钮：开始 / 暂停 / 重置；倒计时大字体展示，区分工作 / 休息状态
- 统计已完成番茄个数
- 关闭窗口 → 最小化到系统托盘（不退出）；托盘菜单可显示/隐藏窗口、开始/暂停/重置、置顶、退出

## 目录结构
```
pomodoro-timer/
├── package.json        # 项目配置、脚本、electron-builder 打包配置
├── main.js             # 主进程：窗口/托盘/系统通知/计时/配置持久化
├── preload.js          # 安全桥接层（contextBridge）
├── index.html          # 渲染进程页面
├── renderer.js         # 渲染进程逻辑：界面渲染、提示音、交互
├── style.css           # 深色极简科技风样式
├── assets/icon.png     # 应用图标（托盘/窗口图标）
├── build/icon.ico      # Windows 打包用图标（由 build-icon.js 生成）
├── build-icon.js       # PNG → ICO 转换脚本
└── gen-fallback.js     # 托盘兜底图标生成脚本（可选）
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

### 3. 冒烟测试（可选，自动验证可启动后退出）
```powershell
npm run smoke
```

### 4. 打包
- 便携版（免安装单文件 exe）：`npm run pack`
- 安装版（NSIS 安装程序 exe）：`npm run dist`

产物输出到 `release/` 目录。

> 首次打包会下载 electron-builder 所需的 Windows 打包工具，需要联网，耗时较长属正常。

## 配置持久化位置
`C:\Users\<用户名>\AppData\Roaming\番茄钟\config.json`

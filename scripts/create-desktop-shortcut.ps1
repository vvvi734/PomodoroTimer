# ============================================================
#  create-desktop-shortcut.ps1
# ------------------------------------------------------------
#  在桌面生成 / 更新「番茄钟」快捷方式，指向打包后的程序。
#  优先使用 release\win-unpacked\番茄钟.exe（启动快），
#  找不到时回退到 release 下最新的便携版 exe。
#
#  用法：npm run shortcut
#       或 powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '番茄钟.lnk'

# ---- 1. 定位可执行文件 ----
$exe = Join-Path $root 'release\win-unpacked\番茄钟.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $portable = Get-ChildItem -LiteralPath (Join-Path $root 'release') -Filter 'PomodoroTimer-*-x64.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($portable) {
    $exe = $portable.FullName
  } else {
    Write-Error '未找到打包程序，请先运行 npm run pack'
    exit 1
  }
}

# ---- 2. 生成快捷方式（已存在则覆盖） ----
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcutPath)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = Split-Path -Parent $exe
$lnk.IconLocation = "$exe,0"
$lnk.Description = '番茄钟 - 桌面番茄钟'
$lnk.WindowStyle = 1          # 普通窗口
$lnk.Save()

# ---- 3. 结果 ----
Write-Host "桌面快捷方式已就绪：$shortcutPath"
Write-Host "指向：$exe"

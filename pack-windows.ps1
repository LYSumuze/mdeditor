<#
.SYNOPSIS
  Windows → Linux 打包脚本
  生成不含 node_modules / target 的轻量 tar.gz，传输到 Linux 后解压编译

.DESCRIPTION
  - 不删除本地 node_modules（保留开发环境）
  - tar 时仅排除大型构建产物，不做破坏性清理
  - 参数 -Clean 可额外删除本地 node_modules（首次打包或版本升级时使用）

.PARAMETER Clean
  同时删除本地 node_modules / target / dist，从零开始（首次使用或升级依赖时）
#>

param(
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ArchivePath = Join-Path $ProjectRoot 'mdeditor.tar.gz'

Write-Host "=== mdeditor Windows 打包脚本 ===" -ForegroundColor Cyan
Write-Host "项目路径: $ProjectRoot" -ForegroundColor Gray

# ── 可选：完全清理（依赖版本变更时用） ──

if ($Clean) {
  Write-Host ""
  Write-Host "🔧 使用 -Clean 参数，将删除本地 node_modules/target/dist" -ForegroundColor Yellow
  $DirsToRemove = @(
    'node_modules',
    'src-tauri\target',
    'dist'
  )
  foreach ($Dir in $DirsToRemove) {
    $FullPath = Join-Path $ProjectRoot $Dir
    if (Test-Path $FullPath) {
      Write-Host "   删除: $Dir ..." -NoNewline
      Remove-Item -Recurse -Force $FullPath
      Write-Host " [OK]" -ForegroundColor Green
    }
  }
} else {
  Write-Host ""
  Write-Host "跳过本地清理（保留 node_modules/target/dist）" -ForegroundColor Green
  Write-Host "提示: 如需完全清理请使用: .\pack-windows.ps1 -Clean" -ForegroundColor Gray
}

# ── 删除旧的压缩包 ──

if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
    Write-Host "删除旧压缩包 [OK]" -ForegroundColor Green
}

# ── 压缩（排除大型 + 平台相关目录） ──

Write-Host ""
Write-Host "正在压缩（排除 .git / node_modules / src-tauri\target / dist / .versions）..." -NoNewline
tar -czf $ArchivePath `
    --exclude=".git" `
    --exclude="node_modules" `
    --exclude="src-tauri/target" `
    --exclude="dist" `
    --exclude=".versions" `
    -C "$ProjectRoot" .
Write-Host " [OK]" -ForegroundColor Green

# ── 结果 ──

$ArchiveSize = (Get-Item $ArchivePath).Length / 1MB
Write-Host ""
Write-Host "=== 打包完成 ===" -ForegroundColor Cyan
Write-Host "输出: $ArchivePath" -ForegroundColor White
Write-Host ("大小: {0:N2} MB" -f $ArchiveSize) -ForegroundColor White
Write-Host ""
Write-Host "把此文件传到 Linux 机器上，解压后运行:" -ForegroundColor Yellow
Write-Host "  tar -xzf mdeditor.tar.gz" -ForegroundColor Yellow
Write-Host "  cd mdeditor" -ForegroundColor Yellow
Write-Host "  bash pack-linux.sh" -ForegroundColor Yellow

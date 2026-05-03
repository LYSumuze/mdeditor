<#
.SYNOPSIS
  打包 mdeditor 项目，清理平台相关文件，生成压缩包供 Linux 编译

.DESCRIPTION
  删除 node_modules / src-tauri\target / dist / .versions，
  然后压缩整个项目文件夹为 mdeditor.zip
#>

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ZipPath = Join-Path $ProjectRoot 'mdeditor.zip'

Write-Host "=== mdeditor Windows 打包脚本 ===" -ForegroundColor Cyan
Write-Host "项目路径: $ProjectRoot" -ForegroundColor Gray

# ── 清理 ──

$DirsToRemove = @(
    'node_modules',
    'src-tauri\target',
    'dist',
    '.versions'
)

foreach ($Dir in $DirsToRemove) {
    $FullPath = Join-Path $ProjectRoot $Dir
    if (Test-Path $FullPath) {
        Write-Host "删除: $Dir ..." -NoNewline
        Remove-Item -Recurse -Force $FullPath
        Write-Host " ✓" -ForegroundColor Green
    } else {
        Write-Host "跳过: $Dir (不存在)" -ForegroundColor Yellow
    }
}

# ── 删除已有的压缩包 ──

if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
    Write-Host "删除旧压缩包 ✓" -ForegroundColor Green
}

# ── 压缩 ──

Write-Host "正在压缩..." -NoNewline
Compress-Archive -Path "$ProjectRoot\*" -DestinationPath $ZipPath
Write-Host " ✓" -ForegroundColor Green

# ── 结果 ──

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "`n=== 打包完成 ===" -ForegroundColor Cyan
Write-Host "输出: $ZipPath" -ForegroundColor White
Write-Host "大小: $('{0:N2}' -f $ZipSize) MB" -ForegroundColor White
Write-Host "`n把此文件传到 Linux 机器上，解压后运行 ./pack-linux.sh" -ForegroundColor Yellow

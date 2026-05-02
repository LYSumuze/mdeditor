#!/usr/bin/env bash
#
# mdeditor Linux 打包脚本
# 用法: bash scripts/pack-linux.sh
#
# 前置条件:
#   1. 把 Windows 上打包的 mdeditor.zip 放到项目根目录并解压
#   2. 确保已安装: curl, pnpm, rustup
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== mdeditor Linux 打包脚本 ==="
echo "项目路径: $PROJECT_ROOT"

# ── 1. 安装系统依赖 ──

echo ""
echo "[1/5] 安装系统依赖..."

if command -v apt &>/dev/null; then
    sudo apt update
    sudo apt install -y \
        build-essential \
        curl \
        wget \
        file \
        git \
        libssl-dev \
        libgtk-3-dev \
        libwebkit2gtk-4.1-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        pkg-config
elif command -v dnf &>/dev/null; then
    sudo dnf groupinstall -y "Development Tools"
    sudo dnf install -y \
        curl \
        wget \
        file \
        git \
        openssl-devel \
        gtk3-devel \
        webkit2gtk4.1-devel \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        pkg-config
elif command -v pacman &>/dev/null; then
    sudo pacman -S --needed --noconfirm \
        base-devel \
        curl \
        wget \
        file \
        git \
        openssl \
        gtk3 \
        webkit2gtk-4.1 \
        libappindicator-gtk3 \
        librsvg \
        pkg-config
else
    echo "⚠ 无法自动安装依赖，请手动安装以下软件包:"
    echo "  build-essential, libssl-dev, libgtk-3-dev,"
    echo "  libwebkit2gtk-4.1-dev, libayatana-appindicator3-dev,"
    echo "  librsvg2-dev, pkg-config"
fi

# ── 2. 安装 pnpm（如果没有） ──

echo ""
echo "[2/5] 检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
    echo "安装 pnpm..."
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    # 让当前 shell 生效
    export PNPM_HOME="$HOME/.local/share/pnpm"
    case "$SHELL" in
        */zsh) export PATH="$HOME/.local/share/pnpm:$PATH" ;;
        *)    export PATH="$HOME/.local/share/pnpm:$PATH" ;;
    esac
    echo "pnpm 安装完成"
else
    echo "pnpm 已安装: $(pnpm --version)"
fi

# ── 3. 安装 Rust（如果没有） ──

echo ""
echo "[3/5] 检查 Rust..."
if ! command -v rustc &>/dev/null; then
    echo "安装 Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "Rust 安装完成"
else
    echo "Rust 已安装: $(rustc --version)"
fi

# ── 4. 安装前端依赖 ──

echo ""
echo "[4/5] 安装前端依赖..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile
echo "依赖安装完成"

# ── 5. 构建 ──

echo ""
echo "[5/5] 构建 Tauri 应用..."
# 确保 Rust 环境变量可用
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

pnpm tauri build
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
    echo ""
    echo "=== 打包成功! ==="
    echo ""
    echo "生成的包在以下位置:"
    ls -lh "$PROJECT_ROOT/src-tauri/target/release/bundle/deb/"*.deb 2>/dev/null || echo "（未找到 deb 包，可能在其他 bundle 目录）"
    ls -lh "$PROJECT_ROOT/src-tauri/target/release/bundle/"* 2>/dev/null
else
    echo ""
    echo "=== 打包失败，请查看上方错误信息 ==="
    exit 1
fi

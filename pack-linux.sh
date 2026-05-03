#!/usr/bin/env bash
#
# mdeditor Linux 打包脚本
# 用法: bash pack-linux.sh
#
# 遇到的所有已知问题均已修复:
#   - ✅ 项目根目录路径正确 (PROJECT_ROOT=$SCRIPT_DIR)
#   - ✅ pnpm 安装走 npm + npmmirror 国内镜像
#   - ✅ Node.js 自动升级到 v22（二进制下载，无需 sudo）
#   - ✅ Rust 安装后自动 source 环境变量
#   - ✅ 构建前 source cargo env，避免 cargo not found
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

echo "=== mdeditor Linux 打包脚本 ==="
echo "项目路径: $PROJECT_ROOT"

# ── 1. 安装系统依赖 ──

echo ""
echo "[1/6] 安装系统依赖..."

if command -v apt &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
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

# ── 2. 安装 Node.js 22（如果版本不够） ──

echo ""
echo "[2/6] 检查 Node.js 版本..."

NODE_VERSION_OK=false
if command -v node &>/dev/null; then
    NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
        NODE_VERSION_OK=true
        echo "✓ Node.js 版本满足要求: $(node --version)"
    fi
fi

if [ "$NODE_VERSION_OK" != "true" ]; then
    echo "Node.js 版本过低 ($(node --version 2>/dev/null || echo '未安装'))，安装 Node.js 22 LTS..."
    NODE_VERSION="v22.14.0"
    NODE_ARCH="linux-x64"
    NODE_TAR="node-${NODE_VERSION}-${NODE_ARCH}.tar.xz"
    NODE_URL="https://cdn.npmmirror.com/binaries/node/${NODE_VERSION}/${NODE_TAR}"
    NODE_DIR="$HOME/.local/node-${NODE_VERSION}-${NODE_ARCH}"

    mkdir -p "$HOME/.local"
    echo "  下载 $NODE_URL ..."
    curl -fsSL -o "/tmp/${NODE_TAR}" "$NODE_URL"
    echo "  解压..."
    tar -xf "/tmp/${NODE_TAR}" -C "$HOME/.local/"
    rm -f "/tmp/${NODE_TAR}"

    # 加入 PATH，优先于系统 Node
    export PATH="${NODE_DIR}/bin:$PATH"
    # 写入 .bashrc 以持久化
    if ! grep -q "$NODE_DIR" "$HOME/.bashrc" 2>/dev/null; then
        echo "export PATH=\"${NODE_DIR}/bin:\$PATH\"" >> "$HOME/.bashrc"
    fi
    echo "✓ Node.js 安装完成: $(node --version)"
    echo "  npm: $(npm --version)"
fi

# ── 3. 安装 pnpm（如果没有） ──

echo ""
echo "[3/6] 检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
    echo "安装 pnpm..."
    npm install -g pnpm --registry=https://registry.npmmirror.com
    echo "✓ pnpm 安装完成: $(pnpm --version)"
else
    echo "✓ pnpm 已安装: $(pnpm --version)"
fi

# ── 4. 安装 Rust（如果没有） ──

echo ""
echo "[4/6] 检查 Rust..."
if ! command -v rustc &>/dev/null; then
    echo "安装 Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    echo "✓ Rust 安装完成"
else
    echo "✓ Rust 已安装: $(rustc --version)"
fi

# ── 5. 安装前端依赖 ──

echo ""
echo "[5/6] 安装前端依赖..."
cd "$PROJECT_ROOT"
# --prefer-offline: 利用 pnpm 全局 store，反复构建时不重复下载
pnpm install --frozen-lockfile --prefer-offline
echo "✓ 依赖安装完成"

# ── 6. 构建 Tauri 应用 ──

echo ""
echo "[6/6] 构建 Tauri 应用..."

# source Rust 环境变量（确保 cargo 在 PATH 中）
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# 再次确认 Rust 工具链可用
echo "  cargo: $(which cargo || echo 'NOT FOUND!')"
echo "  rustc: $(rustc --version 2>/dev/null || echo 'NOT FOUND!')"

pnpm tauri build
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
    echo ""
    echo "=== 打包成功! ==="
    echo ""
    echo "生成的包在以下位置:"
    ls -lh "$PROJECT_ROOT/src-tauri/target/release/bundle/deb/"*.deb 2>/dev/null || echo "（未找到 deb 包）"
    ls -lh "$PROJECT_ROOT/src-tauri/target/release/bundle/"* 2>/dev/null
else
    echo ""
    echo "=== 打包失败，请查看上方错误信息 ==="
    exit 1
fi

# Markdown Editor (mdeditor)

> VS Code 风格本地 Markdown 编辑器 · 纯本地、支持局域网 P2P 同步和版本管理

一个 VS Code 风格暗色主题的 Markdown 编辑器，支持直接读写本地文件（File System Access API / Tauri IPC）、全文搜索、P2P 局域网同步和版本回溯。提供 Tauri v2 桌面端，打包为 `mdeditor`。

---

## 核心特性

- **VS Code 风格 UI** — 活动栏、侧边栏、标签页、状态栏、右键菜单，完整的 IDE 布局
- **Markdown 实时预览** — 编辑/预览/分屏三种模式，支持 GFM、LaTeX 数学公式、YAML Frontmatter
- **本地文件系统** — 通过 File System Access API（浏览器）或 Tauri IPC（桌面端）直接读写本地 .md 文件
- **多文件夹支持** — 同时打开多个文件夹，文件树展示
- **P2P 局域网同步** — 纯 WebRTC 实现，无需服务器，同局域网设备实时同步笔记
- **版本管理** — 自动保存版本历史（最多 20 个版本），可回滚、对比、恢复
- **全文搜索** — 基于 Fuse.js 的模糊搜索
- **查找替换** — 查找和批量替换，Ctrl+F 一键展开
- **撤销/重做** — 自定义历史栈（跨平台，不依赖已弃用的 `document.execCommand`）
- **Emoji 面板** — 592 个 Emoji 离线渲染（本地加载 Twemoji SVG，无需 CDN）
- **目录大纲 (TOC)** — 自动提取标题，点击定位编辑器和预览滚动位置
- **localStorage 回退** — 浏览器中自动回退到 localStorage 存储
- **错误日志系统** — 自动收集运行时的前端错误，支持导出

---

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://rustup.rs/)（仅 Tauri 桌面端需要）

### 安装依赖

```bash
pnpm install
```

### 开发调试

```bash
pnpm dev
```

浏览器打开 **http://localhost:5000** 即可使用。修改代码后自动热更新（HMR）。

### 构建

#### 纯 Web 版

```bash
pnpm build        # 构建到 dist/ 目录
pnpm start        # 本地预览构建后的版本
```

`dist/` 目录下的静态文件可直接部署到任何 Web 服务器。

#### Tauri 桌面版（Windows）

```bash
pnpm tauri build
```

构建产物在 `src-tauri/target/release/bundle/` 下。

#### Linux .deb 构建

Tauri 不支持从 Windows 交叉编译到 Linux，需要在 Linux 上构建。Windows 上打包源码传到 Linux：

```powershell
.\pack-windows.ps1
```

生成 `mdeditor.tar.gz`，传到 Linux 机器，然后：

```bash
tar -xzf mdeditor.tar.gz
cd mdeditor
bash pack-linux.sh
```

脚本会自动安装系统依赖、Rust、pnpm，然后执行 `pnpm tauri build`，最终在 `src-tauri/target/release/bundle/deb/` 下生成 `.deb` 安装包。

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存当前文件 |
| Ctrl+F | 查找替换（查找 + 替换同时显示） |
| Ctrl+Z | 撤销 |
| Ctrl+Y / Ctrl+Shift+Z | 重做 |
| Ctrl+W | 关闭当前标签 |
| Ctrl+O | 打开文件夹 |
| Ctrl+B | 切换侧边栏 |
| Escape | 关闭弹窗/菜单 |

> **注意：** Ctrl+F 同时显示查找和替换输入框，无需额外切换。撤销/重做使用自定义历史栈，在 Tauri 桌面端和浏览器中均正常工作。

---

## 运行模式详解

| 模式 | 文件访问 | 数据持久化 | 平台支持 |
|------|---------|-----------|---------|
| **浏览器 + File System Access** | 读写本地文件 | 磁盘持久化 | Chrome/Edge |
| **浏览器 + localStorage** | 浏览器沙箱 | 浏览器存储 | 所有浏览器 |
| **Tauri 桌面端** | 完整系统文件访问 | 磁盘持久化 | Windows / macOS / Linux |

---

## 技术架构

```
mdeditor/
├── index.html              # HTML 入口
├── src/
│   ├── index.ts            # 应用入口
│   ├── main.ts             # 核心逻辑（UI + 状态管理 + 事件处理 + 撤销栈）
│   └── services/
│       ├── markdown.ts     # Markdown 渲染引擎（unified + remark + rehype）
│       ├── fileSystem.ts   # 文件系统服务（FS Access API + localStorage + Tauri）
│       ├── p2pSync.ts      # P2P 同步引擎（纯 WebRTC）
│       ├── search.ts       # 全文搜索（Fuse.js）
│       └── tauri-api.ts    # Tauri IPC 桥接（文件读写 + 菜单事件 + 剪贴板）
├── public/
│   └── emoji/              # 592 个离线 Emoji SVG（Twemoji）
├── src-tauri/              # Tauri v2 桌面端
│   ├── src/
│   │   ├── lib.rs          # Rust 后端：文件操作、版本管理、剪贴板
│   │   └── main.rs         # Tauri 入口
│   ├── Cargo.toml          # Rust 依赖（含 clipboard-manager 插件）
│   ├── capabilities/
│   │   └── default.json    # 权限配置（core + dialog + clipboard-manager）
│   └── tauri.conf.json     # Tauri 配置（productName: mdeditor）
├── pack-windows.ps1        # Windows 打包脚本（输出 mdeditor.tar.gz）
├── pack-linux.sh           # Linux 构建脚本（自动安装依赖 + tauri build）
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 核心依赖

| 包 | 用途 |
|---|---|
| **Vite 7.x** | 构建工具与开发服务器 |
| **TypeScript 5.x** | 类型安全开发 |
| **Tailwind CSS 3.x** | 样式框架 |
| **unified + remark + rehype** | Markdown → HTML 渲染管线 |
| **remark-gfm** | GFM 扩展（表格、任务列表、删除线） |
| **remark-math + rehype-katex** | LaTeX 数学公式渲染 |
| **remark-frontmatter** | YAML Frontmatter 解析 |
| **Fuse.js** | 全文模糊搜索 |
| **diff.js** | 文件差异对比 |
| **@tauri-apps/api + plugin-dialog + plugin-clipboard-manager** | Tauri 桌面 API |

---

## 常见问题

**Q: Emoji 显示为方框？**

A: 编辑器内置了 592 个 Twemoji SVG，**完全离线渲染，不依赖任何 CDN**。所有现代浏览器和 Tauri 桌面端均可正确显示。

**Q: 支持哪些 Markdown 语法？**

A: 标准 Markdown + GFM（表格、任务列表、删除线、自动链接）+ LaTeX 数学公式（行内 `$...$` 和块级 `$$...$$`）+ YAML Frontmatter。

**Q: 如何打开 P2P 同步？**

A: 在侧边栏选择 Sync 面板，显示本机 Peer ID，另一台设备输入该 ID 即可连接（需同一局域网，浏览器需支持 WebRTC）。

---

## 许可证

MIT

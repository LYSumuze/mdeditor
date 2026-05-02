# Markdown Editor

> VS Code 风格本地 Markdown 编辑器 · 纯本地、支持局域网 P2P 同步和版本管理

一个完全运行在浏览器中的 Markdown 编辑器，UI 仿 VS Code 暗色主题，支持直接读写本地文件（File System Access API）、全文搜索、P2P 局域网同步和版本回溯。同时提供 Tauri v2 桌面端，实现更完善的系统文件访问。

---

## 核心特性

- **VS Code 风格 UI** — 标题栏、活动栏、侧边栏、标签页、状态栏、右键菜单，完整的 IDE 布局
- **Markdown 实时预览** — 编辑/预览/分屏三种模式，支持 GFM（表格、任务列表）、LaTeX 数学公式、YAML Frontmatter 等扩展语法
- **本地文件系统** — 通过 File System Access API（浏览器）或 Tauri IPC（桌面端）直接读写本地 .md 文件
- **多文件夹支持** — 同时打开多个文件夹，文件树展示
- **P2P 局域网同步** — 纯 WebRTC 实现，无需服务器，同一局域网内的设备可实时同步笔记
- **版本管理** — 自动保存版本历史（最多 20 个版本），可回滚、对比、恢复
- **全文搜索** — 基于 Fuse.js 的模糊搜索，按文件名和内容权重排序
- **Emoji 面板** — 支持 592 个 Emoji 选择，离线渲染（Twemoji SVG，本地加载）
- **目录大纲 (TOC)** — 自动提取标题生成目录，点击目录可同时定位编辑器和预览
- **查找替换** — 编辑器内支持查找和批量替换
- **localStorage 回退** — 在不支持 File System Access API 的浏览器中自动回退到 localStorage 存储
- **错误日志系统** — 自动收集运行时的前端错误，支持导出

---

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9（必须使用 pnpm，npm/yarn 被 preinstall 脚本阻止）
- [Rust](https://rustup.rs/)（仅 Tauri 桌面端需要）

### 安装依赖

`bash
pnpm install
`

### 开发调试

`bash
pnpm dev
`

浏览器打开 **http://localhost:5000** 即可使用。修改代码后自动热更新（HMR）。

> **调试技巧：**
> - 按 F12 打开开发者工具，查看 Console 输出和 Network 请求
> - 编辑器支持右键菜单和快捷键
> - 侧边栏可切换：文件树 / 搜索 / P2P 同步 / 版本历史

### 构建

#### 纯 Web 版

`bash
pnpm build        # 构建到 dist/ 目录
pnpm start        # 本地预览构建后的版本
`

dist/ 目录下的静态文件可直接部署到任何 Web 服务器。

#### Tauri 桌面版（Windows）

`bash
pnpm tauri build
`

构建产物在 src-tauri/target/release/bundle/ 下：
- Windows → msi/ 或 
sis/ 目录的安装程序

#### Linux .deb 构建

由于 Tauri 不支持从 Windows 交叉编译到 Linux，需要两步：

**Windows 上**（打包源码）：

`powershell
.\pack-windows.ps1
`
生成 mdeditor.zip，传到 Linux 机器。

**Linux 上**（构建 .deb）：

`bash
unzip mdeditor.zip -d mdeditor
cd mdeditor
bash pack-linux.sh
`
脚本会自动安装系统依赖、Rust、pnpm，然后执行 pnpm tauri build，最终在 src-tauri/target/release/bundle/deb/ 下生成 .deb 安装包。

---

## 运行模式详解

### 三种运行模式对比

| 模式 | 文件访问 | 数据持久化 | 平台支持 |
|------|---------|-----------|---------|
| **浏览器 + File System Access** | 读写本地文件 | 磁盘持久化 | Chrome/Edge |
| **浏览器 + localStorage** | 浏览器沙箱 | 浏览器存储 | 所有浏览器 |
| **Tauri 桌面端** | 完整系统文件访问 | 磁盘持久化 | Windows/macOS/Linux |

### 工作流

1. **打开/创建文件夹** — 点击左侧 Open Folder 按钮选择本地 Markdown 文件夹
2. **编辑文件** — 在文件树中双击文件打开，编辑器支持 Markdown 语法高亮
3. **预览** — 通过工具栏切换编辑/分屏/预览模式
4. **保存** — Ctrl+S 保存，自动创建版本快照
5. **同步** — 在 Sync 面板查看本机 Peer ID，另一台设备输入该 ID 即可 P2P 连接（需同一局域网）
6. **版本管理** — 在 History 面板查看/回滚文件历史版本

---

## 技术架构

`
mdeditor/
├── index.html              # HTML 入口
├── src/
│   ├── index.ts            # 应用入口
│   ├── main.ts             # 核心逻辑（~3000 行，负责 UI + 状态管理 + 事件处理）
│   ├── index.css           # VS Code 暗色主题 + Tailwind CSS 基础样式
│   └── services/
│       ├── markdown.ts     # Markdown 渲染引擎（unified + remark + rehype）
│       ├── fileSystem.ts   # 文件系统服务（File System Access API + localStorage + Tauri）
│       ├── p2pSync.ts      # P2P 同步引擎（纯 WebRTC，无服务器依赖）
│       ├── search.ts       # 全文搜索（Fuse.js 模糊搜索）
│       └── tauri-api.ts    # Tauri IPC 桥接（兼容 Electron API 接口）
├── public/
│   └── emoji/              # 592 个离线 Emoji SVG 图标（Twemoji）
├── src-tauri/              # Tauri v2 桌面端
│   ├── src/
│   │   ├── lib.rs          # Rust 后端：文件操作、版本管理、错误日志
│   │   └── main.rs         # Tauri 入口
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── pack-windows.ps1        # Windows 打包脚本（清理 + 压缩，供 Linux 构建用）
├── pack-linux.sh           # Linux 构建脚本（自动安装依赖 + tauri build）
├── vite.config.ts          # Vite 配置（端口 5000）
├── tailwind.config.js      # Tailwind CSS 配置
├── postcss.config.js       # PostCSS 配置
├── tsconfig.json           # TypeScript 配置
└── package.json            # 依赖管理（仅 pnpm）
`

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
| **@tauri-apps/api + plugin-dialog** | Tauri 桌面 API |

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存当前文件 |
| Ctrl+F | 查找 |
| Ctrl+H | 查找替换 |
| Ctrl+W | 关闭当前标签 |
| Ctrl+Shift+P | 打开命令面板 |
| Ctrl+, | 打开设置 |
| Escape | 关闭弹窗/菜单 |

---

## 常见问题

**Q: 为什么有些 Emoji 显示为方框？**

A: 新版 Emoji（如 🫐 🪴 🫘）在 Windows 10 的 Segoe UI Emoji 中不支持。编辑器内置了 Twemoji SVG 离线渲染，理论上所有浏览器都能正确显示。如果仍有问题，检查网络是否拦截了 fonts.googleapis.com。

**Q: 支持哪些 Markdown 语法？**

A: 标准 Markdown + GFM（表格、任务列表、删除线、自动链接）+ LaTeX 数学公式（行内 $...$ 和块级 $$...）+ YAML Frontmatter。

**Q: 如何修改端口？**

A: 编辑 package.json 中 dev 脚本的 --port 参数，或直接运行 pnpm vite --port <端口> --host。

**Q: 数据存在哪里？**

A: 取决于模式：File System Access API → 你打开的原始文件夹；localStorage → 浏览器内置存储（DevTools > Application > Local Storage 查看）；Tauri → 你选择的系统目录。

**Q: 如何打开 P2P 同步？**

A: 在侧边栏选择 Sync 面板，会显示本机 Peer ID，另一台设备输入该 ID 即可连接（需在同一局域网，且浏览器支持 WebRTC）。

---

## 许可证

MIT

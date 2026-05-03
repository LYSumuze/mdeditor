/**
 * Markdown Editor
 * VS Code Style UI Implementation
 */

import { FileSystemAccessService, type FileItem, type FileVersion, logError } from './services/fileSystem';
import { initMarkdownRenderer } from './services/markdown';
import { SearchService, type SearchResult as SearchResultType } from './services/search';
import { P2PSyncService, type SyncStatus } from './services/p2pSync';
import { isTauri, setupTauriShim, showOpenDialog, onMenuOpenFolder, onMenuSave, onMenuUndo, onMenuRedo, onMenuFind, onExportLogs } from './services/tauri-api';

// ============ 应用状态 ============
interface AppState {
  sidebar: 'files' | 'search' | 'sync' | 'history' | null;
  activeTab: string | null;
  openFiles: Map<string, FileTab>;
  activeView: 'edit' | 'split' | 'preview';
  syncStatus: SyncStatus;
  peerId: string;
  isMobile: boolean;
  currentFolder: FileSystemDirectoryHandle | null;
  files: FileItem[];
  markdownRenderer: ((markdown: string) => Promise<string>) | null;
  selectedFiles: Set<string>; // 选中的文件/目录路径集合（复选框批量选择）
  selectedFilePath: string | null; // 单击选中的文件路径（单选高亮）
  folders: Array<{ name: string; path: string; handle: FileSystemDirectoryHandle | null; files: FileItem[] }>; // 多文件夹支持
  tocVisible: boolean;
  sidebarVisible: boolean;
}

// ============ 历史版本类型 ============
// FileVersion 类型从 services/fileSystem.ts 导入

interface FileTab {
  name: string;
  path: string;
  relativePath: string;  // 相对于文件夹的路径
  content: string;
  originalContent: string; // 原始内容，用于判断是否修改
  modified: boolean;
  handle?: FileSystemFileHandle;
  folderHandle?: FileSystemDirectoryHandle;  // 文件所属文件夹的 handle
  versions: FileVersion[];
}

const state: AppState = {
  sidebar: 'files',
  activeTab: null,
  openFiles: new Map(),
  activeView: 'edit',
  syncStatus: 'disconnected',
  peerId: '',
  isMobile: window.innerWidth <= 768,
  currentFolder: null,
  files: [],
  markdownRenderer: null,
  selectedFiles: new Set(),
  selectedFilePath: null,
  folders: [],
  tocVisible: false,
  sidebarVisible: true
};

// 记录当前单击选中的文件 DOM 元素（用于视觉高亮，避免 querySelectorAll 遍历）
let lastSelectedEl: HTMLElement | null = null;

// ============ 服务实例 ============
const fileService = new FileSystemAccessService();
const searchService = new SearchService();
let p2pService: P2PSyncService | null = null;

// ============ 工具函数 ============
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  console.log('renderMarkdownToHtml called, renderer exists:', !!state.markdownRenderer);
  if (!state.markdownRenderer) {
    console.log('Initializing markdown renderer...');
    state.markdownRenderer = await initMarkdownRenderer();
    console.log('Markdown renderer initialized');
  }
  return state.markdownRenderer(markdown);
}

// ============ 渲染函数 ============
async function renderAppAsync(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    ${renderTitleBar()}
    <div class="main-container">
      ${renderActivityBar()}
      ${renderSidebar()}
      ${renderEditorArea()}
    </div>
    ${renderStatusBar()}
  `;

  attachEventListeners();
  initializeServices();
  setupGlobalErrorCapture();

  // 等待 DOM 更新完成后再初始化预览渲染
  await new Promise(resolve => setTimeout(resolve, 50));
  await initPreviewRender();
  setupScrollIndicators();
}

function renderApp(): void {
  // 异步渲染以支持预览初始化
  (async () => {
    // Setup Tauri shim before first render
    if (isTauri()) {
      await setupTauriShim();
    }
    await renderAppAsync();
  })();
}

function renderTitleBar(): string {
  return `
    <div class="title-bar">
      <div class="title-bar-left">
        <div class="title-bar-logo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="2" fill="#4ec9b0" fill-opacity="0.2" stroke="#4ec9b0" stroke-width="1"/>
            <path d="M4 5h8M4 8h6M4 11h7" stroke="#4ec9b0" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="menu-item">
          <span class="menu-label">文件</span>
          <div class="menu-dropdown">

            <div class="menu-dropdown-item" data-action="open-folder">打开文件夹 <kbd>Ctrl+O</kbd></div>
            <div class="menu-dropdown-item" data-action="open-file">打开文件</div>
            <div class="menu-divider"></div>
            <div class="menu-dropdown-item" data-action="save-file">保存 <kbd>Ctrl+S</kbd></div>
            <div class="menu-dropdown-item" data-action="save-file-as">另存为... <kbd>Ctrl+Shift+S</kbd></div>
            <div class="menu-divider"></div>
            <div class="menu-dropdown-item" data-action="close-window">退出 <kbd>Ctrl+Q</kbd></div>
          </div>
        </div>
        <div class="menu-item">
          <span class="menu-label">编辑</span>
          <div class="menu-dropdown">
            <div class="menu-dropdown-item" data-action="undo">撤销 <kbd>Ctrl+Z</kbd></div>
            <div class="menu-dropdown-item" data-action="redo">重做 <kbd>Ctrl+Y</kbd></div>
          </div>
        </div>
        <div class="menu-item">
          <span class="menu-label">视图</span>
          <div class="menu-dropdown">
            <div class="menu-dropdown-item" data-action="view-edit">编辑模式</div>
            <div class="menu-dropdown-item" data-action="view-split">分屏模式</div>
            <div class="menu-dropdown-item" data-action="view-preview">预览模式</div>
            <div class="menu-divider"></div>
            <div class="menu-dropdown-item" data-action="toggle-sidebar">切换侧边栏 <kbd>Ctrl+B</kbd></div>
          </div>
        </div>
        <div class="menu-item">
          <span class="menu-label">帮助</span>
          <div class="menu-dropdown">
            <div class="menu-dropdown-item" data-action="show-shortcuts">快捷键</div>
            <div class="menu-dropdown-item" data-action="show-docs">使用文档</div>
            <div class="menu-divider"></div>
            <div class="menu-dropdown-item" data-action="export-logs">导出日志</div>
            <div class="menu-dropdown-item" data-action="show-about">关于</div>
          </div>
        </div>
      </div>
      <div class="title-bar-center">Markdown Editor</div>
      <div class="title-bar-right"></div>
    </div>
  `;
}

function renderActivityBar(): string {
  return `
    <div class="activity-bar">
      <div class="activity-icon ${state.sidebar === 'files' ? 'active' : ''}" data-panel="files" data-tooltip="资源管理器">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 7v13a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
      </div>
      <div class="activity-icon ${state.sidebar === 'search' ? 'active' : ''}" data-panel="search" data-tooltip="搜索">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
      </div>
      <div class="activity-icon ${state.sidebar === 'sync' ? 'active' : ''}" data-panel="sync" data-tooltip="P2P 同步">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 1l4 4-4 4"/>
          <path d="M3 11V9a4 4 0 014-4h14"/>
          <path d="M7 23l-4-4 4-4"/>
          <path d="M21 13v2a4 4 0 01-4 4H3"/>
        </svg>
      </div>
      <div class="activity-icon ${state.sidebar === 'history' ? 'active' : ''}" data-panel="history" data-tooltip="历史版本">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12,6 12,12 16,14"/>
        </svg>
      </div>
      <div class="sidebar-spacer"></div>
      <div class="activity-icon" data-action="show-about" data-tooltip="关于">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4M12 8h.01"/>
        </svg>
      </div>
    </div>
  `;
}

function renderSidebar(): string {
  return `
    <div class="sidebar ${state.sidebar === null ? 'hidden' : ''}">
      ${state.sidebar === 'files' ? renderFilesPanel() : ''}
      ${state.sidebar === 'search' ? renderSearchPanel() : ''}
      ${state.sidebar === 'sync' ? renderSyncPanel() : ''}
      ${state.sidebar === 'history' ? renderHistoryPanel() : ''}
      <div class="sidebar-resizer"></div>
    </div>
  `;
}

function renderFilesPanel(): string {
  const hasFolders = state.folders.length > 0;
  
  // 渲染多文件夹结构
  const renderFolders = () => {
    if (state.folders.length === 0) {
      return '';
    }
    return state.folders.map((folder, index) => `
      <div class="folder-root">
        <div class="folder-item" data-folder="${escapeHtml(folder.name)}" data-folder-index="${index}">
          <input type="checkbox" class="file-checkbox" data-select="${escapeHtml(folder.name)}" ${state.selectedFiles?.has(folder.name) ? 'checked' : ''}>
          <span class="folder-expand" data-expand="${escapeHtml(folder.name)}">▼</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dcad6b" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="folder-name">${escapeHtml(folder.name)}</span>
          <button class="btn-icon btn-close-folder" onclick="window.closeFolderHandler && window.closeFolderHandler(${index})" data-folder-index="${index}" title="关闭文件夹">×</button>
        </div>
        <div class="folder-children" data-parent="${escapeHtml(folder.name)}">
          <div class="file-tree">
            ${renderFileTree(folder.files, 0, folder.name)}
          </div>
        </div>
      </div>
    `).join('');
  };
  
  return `
    <div class="panel-header">
      <span class="panel-title">资源管理器</span>
      <button class="panel-header-btn" data-action="refresh-folder" title="刷新">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>
    <div class="panel-content">
      <div class="project-panel">
        ${hasFolders ? `
          <div class="folder-tree">
            ${renderFolders()}
          </div>
          <div class="selection-info ${(state.selectedFiles?.size ?? 0) > 0 ? 'visible' : ''}">
            已选择 ${state.selectedFiles?.size ?? 0} 项
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-icon">📁</div>
            <p>没有打开的文件夹</p>
          </div>
        `}
        <div class="project-actions">
          <button class="project-btn" data-action="sync-selected" ${!hasFolders ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            <span>同步选中(${state.selectedFiles?.size ?? 0})</span>
          </button>
          <button class="project-btn btn-delete" data-action="delete-selected" ${(state.selectedFiles?.size ?? 0) === 0 ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>删除选中</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderFileTree(files: FileItem[], level = 0, folderName?: string): string {
  return files.map(file => {
    const indent = level * 12;
    // 构建完整路径，包含文件夹名称
    const fullPath = folderName ? `${folderName}/${file.path}` : file.path;
    const isSelected = state.selectedFiles?.has(fullPath) ?? false;
    const folderIcon = `<svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dcad6b" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`;
    const fileIcon = `<svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ec9b0" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>`;
    
    if (file.isDirectory) {
      return `
        <div class="file-item folder-expandable" data-path="${escapeHtml(fullPath)}" data-type="directory" data-folder="${escapeHtml(folderName || '')}" style="padding-left: ${indent}px">
          <input type="checkbox" class="file-checkbox" data-select="${escapeHtml(fullPath)}" ${isSelected ? 'checked' : ''}>
          <span class="folder-expand" data-expand="${escapeHtml(fullPath)}">▶</span>
          ${folderIcon}
          <span class="file-name">${escapeHtml(file.name)}</span>
        </div>
        <div class="file-children" data-parent="${escapeHtml(fullPath)}" style="display: none;">
          ${file.children ? renderFileTree(file.children, level + 1, folderName) : ''}
        </div>
      `;
    }
    const isHighlighted = state.selectedFilePath === fullPath;
    return `
      <div class="file-item ${state.activeTab === fullPath ? 'active' : ''} ${isHighlighted ? 'selected' : ''}" 
           data-path="${escapeHtml(fullPath)}" 
           data-type="file"
           data-folder="${escapeHtml(folderName || '')}"
           style="padding-left: ${indent}px">
        <input type="checkbox" class="file-checkbox" data-select="${escapeHtml(fullPath)}" ${isSelected ? 'checked' : ''}>
        ${fileIcon}
        <span class="file-name">${escapeHtml(file.name)}</span>
      </div>
    `;
  }).join('');
}

function renderSearchPanel(): string {
  return `
    <div class="panel-header">
      <span class="panel-title">搜索</span>
    </div>
    <div class="panel-content">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input type="text" class="search-input" placeholder="搜索文件..." data-search-input>
      </div>
      <div class="search-results" data-search-results></div>
    </div>
  `;
}

function renderSyncPanel(): string {
  const isConnected = state.syncStatus === 'connected';
  const isConnecting = state.syncStatus === 'connecting';
  
  return `
    <div class="panel-header">
      <span class="panel-title">P2P 同步</span>
    </div>
    <div class="panel-content">
      <div class="sync-panel">
        <div class="sync-status">
          <div class="sync-status-icon ${isConnected ? 'connected' : ''}">
            ${isConnected ? `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <path d="M22 4L12 14.01l-3-3"/>
              </svg>
            ` : `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
            `}
          </div>
          <div class="sync-status-text">
            <h4>${isConnected ? '已连接' : isConnecting ? '连接中...' : '未连接'}</h4>
            <p>${isConnected ? 'P2P 同步已启用' : '点击连接其他设备'}</p>
          </div>
        </div>
        
        <div class="peer-id-section">
          <label>你的 Peer ID</label>
          <div class="peer-id-box">
            <code>${state.peerId || '初始化中...'}</code>
            <button class="btn-icon" data-action="copy-peer-id" title="复制">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="peer-id-section">
          <label>连接到其他设备</label>
          <div class="input-group">
            <input type="text" class="form-input" placeholder="输入对方 Peer ID..." data-connect-input>
            <button class="btn btn-primary" data-action="connect-peer">连接</button>
          </div>
        </div>
        
        <div class="form-hint">
          复制你的 Peer ID 发送给其他人，或输入他们的 ID 进行连接。
        </div>
      </div>
    </div>
  `;
}

// ============ 历史版本面板 ============
function renderHistoryPanel(): string {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  const versions = activeTabData?.versions || [];
  
  return `
    <div class="panel-header">
      <span class="panel-title">历史版本</span>
    </div>
    <div class="panel-content">
      ${!activeTabData ? `
        <div class="history-empty">
          <p>暂无打开的文件</p>
          <p class="hint">打开一个文件后，系统会自动保存历史版本</p>
        </div>
      ` : `
        <div class="history-actions">
          <button class="btn btn-secondary" data-action="save-version" ${versions.length >= 20 ? 'disabled' : ''}>
            <span>💾</span> 保存当前版本
          </button>
          ${versions.length >= 20 ? '<p class="hint">已达最大版本数（20个）</p>' : ''}
        </div>
        <div class="history-list">
          <h4>版本历史 (${versions.length}/20)</h4>
          ${versions.length === 0 ? `
            <div class="history-empty">
              <p>暂无历史版本</p>
              <p class="hint">保存文件时会自动创建版本</p>
            </div>
          ` : (() => {
            // 找到最新版本（时间戳最大）
            const maxTimestamp = Math.max(...versions.map(v => v.timestamp));
            return versions.map((version) => {
            const date = new Date(version.timestamp);
            const timeStr = date.toLocaleString('zh-CN');
            const isLatest = version.timestamp === maxTimestamp;
            return `
              <div class="version-item" data-version-id="${version.id}">
                <div class="version-info">
                  <span class="version-label">${escapeHtml(version.label || '未命名版本')}</span>
                  <span class="version-time">${timeStr}</span>
                  ${isLatest ? '<span class="version-badge">最新</span>' : ''}
                </div>
                <div class="version-actions">
                  <button class="btn-icon" data-action="preview-version" data-version-id="${version.id}" title="预览">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button class="btn-icon" data-action="restore-version" data-version-id="${version.id}" title="恢复">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                  </button>
                  <button class="btn-icon btn-delete" data-action="delete-version" data-version-id="${version.id}" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join('');
            })()}
        </div>
      `}
    </div>
  `;
}

interface TocItem {
  level: number;
  text: string;
  id: string;
}

function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split('\n');
  const toc: TocItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
      toc.push({ level, text, id });
    }
  }
  return toc;
}

function renderTocPanel(): string {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!activeTabData) return '';
  
  const toc = extractToc(activeTabData.content);
  if (toc.length === 0) {
    return `
      <div class="toc-panel">
        <div class="toc-header">目录</div>
        <div class="toc-empty">暂无标题</div>
      </div>
    `;
  }
  
  return `
    <div class="toc-panel">
      <div class="toc-header">目录</div>
      <div class="toc-list">
        ${toc.map(item => `
          <div class="toc-item toc-level-${item.level}" data-toc-id="${escapeHtml(item.id)}">
            ${escapeHtml(item.text)}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function updateTocPanel(markdown: string): void {
  const tocPanel = document.querySelector('.toc-panel');
  if (!tocPanel) return;
  
  const toc = extractToc(markdown);
  const tocList = tocPanel.querySelector('.toc-list');
  const tocEmpty = tocPanel.querySelector('.toc-empty');
  
  if (toc.length === 0) {
    if (tocList) tocList.remove();
    if (!tocEmpty) {
      tocPanel.innerHTML = '<div class="toc-header">目录</div><div class="toc-empty">暂无标题</div>';
    }
    return;
  }
  
  if (tocEmpty) tocEmpty.remove();
  if (tocList) {
    tocList.innerHTML = toc.map(item => `
      <div class="toc-item toc-level-${item.level}" data-toc-id="${escapeHtml(item.id)}">
        ${escapeHtml(item.text)}
      </div>
    `).join('');
  } else {
    const newList = document.createElement('div');
    newList.className = 'toc-list';
    newList.innerHTML = toc.map(item => `
      <div class="toc-item toc-level-${item.level}" data-toc-id="${escapeHtml(item.id)}">
        ${escapeHtml(item.text)}
      </div>
    `).join('');
    tocPanel.appendChild(newList);
  }
  
  // 重新绑定点击事件
  tocPanel.querySelectorAll('.toc-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.tocId;
      const tocItem = el as HTMLElement;
      if (id) {
        // 预览区域滚动
        const target = document.querySelector(`#${CSS.escape(id)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // 编辑器滚动到对应行
        const editor = document.querySelector('[data-editor]') as HTMLTextAreaElement;
        const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
        if (editor && activeTabData) {
          const lines = activeTabData.content.split('\n');
          const headingPrefix = tocItem.textContent || '';
          // 在 markdown 中查找对应的标题行
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (match && match[2].trim() === headingPrefix.trim()) {
              // 计算滚动位置：行号 * 行高（近似值，取编辑器计算后的实际行高）
              const lineHeight = 22; // 约 22px
              const scrollTarget = Math.max(0, i * lineHeight - 40);
              editor.scrollTop = scrollTarget;
              // 设置光标位置到该行开头
              const charPosition = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
              editor.setSelectionRange(charPosition, charPosition);
              editor.focus();
              break;
            }
          }
        }
      }
    });
  });
}

function renderEditorArea(): string {
  const hasOpenFiles = state.openFiles.size > 0;
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;

  return `
    <div class="editor-area">
      ${hasOpenFiles ? renderTabBar() : ''}
      ${renderToolbar()}
      ${hasOpenFiles && activeTabData ? renderFindReplaceBar() : ''}
      <div class="editor-main">
        <div class="editor-content">
          ${hasOpenFiles && activeTabData ? renderEditorPanes(activeTabData) : renderWelcomeScreen()}
        </div>
        ${hasOpenFiles && activeTabData && state.tocVisible ? renderTocPanel() : ''}
      </div>
    </div>
  `;
}

function renderTabBar(): string {
  const tabs = Array.from(state.openFiles.values());
  return `
    <div class="tab-bar">
      ${tabs.map(tab => `
        <div class="tab ${state.activeTab === tab.path ? 'active' : ''}" data-path="${escapeHtml(tab.path)}">
          <span class="tab-name">${escapeHtml(tab.name)}</span>
          <span class="tab-modified" style="color: #ccc;${tab.modified ? '' : 'display:none'}">●</span>
          <button class="tab-close" data-close="${escapeHtml(tab.path)}">×</button>
        </div>
      `).join('')}
    </div>
  `;
}

function updateTabModifiedIndicators(): void {
  const tabs = Array.from(state.openFiles.values());
  tabs.forEach(tab => {
    const tabEl = document.querySelector(`.tab[data-path="${CSS.escape(tab.path)}"] .tab-modified`) as HTMLElement;
    if (tabEl) {
      tabEl.style.display = tab.modified ? '' : 'none';
    }
  });
}

function renderToolbar(): string {
  return `
    <div class="editor-toolbar">
      <button class="toolbar-btn ${state.activeView === 'edit' ? 'active' : ''}" data-action="view-edit" title="编辑模式">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="toolbar-btn ${state.activeView === 'split' ? 'active' : ''}" data-action="view-split" title="分屏模式">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
      </button>
      <button class="toolbar-btn ${state.activeView === 'preview' ? 'active' : ''}" data-action="view-preview" title="预览模式">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
      <button class="toolbar-btn ${state.tocVisible ? 'active' : ''}" data-action="toggle-toc" title="目录">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="6" x2="20" y2="6"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="18" x2="20" y2="18"/>
        </svg>
      </button>
      <button class="toolbar-btn" data-action="toggle-find" title="查找/替换 (Ctrl+F)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </button>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn" data-action="save-file" title="保存 (Ctrl+S)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
          <polyline points="17,21 17,13 7,13 7,21"/>
          <polyline points="7,3 7,8 15,8"/>
        </svg>
      </button>
    </div>
  `;
}

function renderFindReplaceBar(): string {
  return `
    <div class="find-replace-bar" style="display: ${findReplaceState.visible ? 'flex' : 'none'};">
      <input type="text" class="find-replace-input find-replace-query-input" placeholder="查找..." value="${escapeHtml(findReplaceState.query)}" data-find-query />
      <input type="text" class="find-replace-input find-replace-replace-input" placeholder="替换为..." value="${escapeHtml(findReplaceState.replaceWith)}" data-find-replace />
      <button class="find-replace-btn" data-action="find-next" title="查找下一个">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>
      </button>
      <button class="find-replace-btn" data-action="replace-current" title="替换">替换</button>
      <button class="find-replace-btn" data-action="replace-all" title="全部替换">全部</button>
      <button class="find-replace-btn close" data-action="close-find-replace" title="关闭 (Escape)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function renderEditorPanes(tab: FileTab): string {
  const showEditor = state.activeView === 'edit' || state.activeView === 'split';
  const showPreview = state.activeView === 'preview' || state.activeView === 'split';
  const isSplit = state.activeView === 'split';

  return `
    <div class="editor-panes ${state.activeView}">
      ${showEditor ? `
        <div class="editor-pane" data-editor-pane>
          <textarea class="editor-textarea"
                    data-editor
                    placeholder="开始输入 Markdown...">${escapeHtml(tab.content)}</textarea>
        </div>
      ` : ''}
      ${isSplit ? `<div class="pane-resizer" data-pane-resizer></div>` : ''}
      ${showPreview ? `
        <div class="preview-pane" data-preview-pane style="background-color: #1e1e1e;">
          <div class="preview-content markdown-body" data-preview style="background-color: #1e1e1e; color: #cccccc;">
            <span class="preview-loading">正在渲染...</span>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function renderPreview(markdown: string): Promise<void> {
  const token = ++renderPreviewToken;
  console.log('renderPreview called with token:', token, markdown.substring(0, 50));
  const preview = document.querySelector('[data-preview]') as HTMLElement;
  const previewPane = document.querySelector('.preview-pane') as HTMLElement;
  
  // 先设置父容器的背景色
  if (previewPane) previewPane.style.backgroundColor = '#1e1e1e';
  if (preview) {
    preview.innerHTML = '<span class="preview-loading">正在渲染...</span>';
    preview.style.backgroundColor = '#1e1e1e';
    preview.style.color = '#cccccc';
    
    try {
      const html = await renderMarkdownToHtml(markdown);
      // 如果已经被新的渲染请求覆盖，直接返回
      if (token !== renderPreviewToken) {
        console.log('Render token', token, 'superseded by', renderPreviewToken);
        return;
      }
      console.log('Rendered HTML length:', html.length);
      // Debug: check for img tags
      const imgMatch = html.match(/<img[^>]*>/g);
      console.log('[renderPreview] Image tags found:', imgMatch ? imgMatch.length : 0);
      if (imgMatch) {
        imgMatch.forEach((img, i) => console.log(`[renderPreview] Image ${i}:`, img.substring(0, 200)));
      }
      preview.innerHTML = html;
      
      // 强制设置背景色
      preview.style.backgroundColor = '#1e1e1e';
      preview.style.color = '#cccccc';
      
      // 遍历所有子元素，设置背景色为 inherit
      const setBgColor = (el: Element | null) => {
        if (!el) return;
        (el as HTMLElement).style.backgroundColor = 'inherit';
        el.querySelectorAll('*').forEach(child => {
          (child as HTMLElement).style.backgroundColor = 'inherit';
          (child as HTMLElement).style.color = 'inherit';
        });
      };
      setBgColor(preview);
      
      // 更新 TOC
      updateTocPanel(markdown);

      // 为代码块添加复制按钮
      addCopyButtonsToCodeBlocks(preview);
    } catch (err) {
      if (token !== renderPreviewToken) return;
      console.error('渲染预览失败:', err);
      preview.innerHTML = `<pre style="color: #f48771; background-color: #1e1e1e;">渲染失败: ${escapeHtml(String(err))}</pre>`;
    }
  }
}

// 为预览区域的代码块添加复制按钮
function addCopyButtonsToCodeBlocks(container: HTMLElement): void {
  const pres = container.querySelectorAll('pre');
  pres.forEach(pre => {
    // 避免重复添加
    if (pre.querySelector('.code-copy-btn')) return;

    const code = pre.querySelector('code');
    if (!code) return;

    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = '复制';
    btn.type = 'button';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = code.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '复制';
          btn.classList.remove('copied');
        }, 2000);
      } catch {
        btn.textContent = '失败';
        setTimeout(() => {
          btn.textContent = '复制';
        }, 2000);
      }
    });

    pre.appendChild(btn);
  });
}

// 初始化预览渲染（在 DOM 更新后调用）
async function initPreviewRender(): Promise<void> {
  // 等待 DOM 更新
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const preview = document.querySelector('[data-preview]');
  
  if (preview) {
    // 直接从 state 获取当前标签页的内容，避免 HTML 属性转义问题
    const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
    const source = activeTabData?.content || '';
    if (source) {
      await renderPreview(source);
    }
  }
}

function renderWelcomeScreen(): string {
  return `
    <div class="welcome-screen">
      <div class="welcome-content">
        <div class="welcome-logo">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="4" y="4" width="56" height="56" rx="8" fill="#4ec9b0" fill-opacity="0.2" stroke="#4ec9b0" stroke-width="2"/>
            <path d="M16 20h32M16 32h24M16 44h28" stroke="#4ec9b0" stroke-width="4" stroke-linecap="round"/>
          </svg>
        </div>
        <h1>Markdown Editor</h1>
        <p class="welcome-subtitle">本地 P2P Markdown 编辑器</p>
        <div class="welcome-actions">
          <button class="welcome-btn primary" data-action="start-local">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            开始使用
          </button>
          <button class="welcome-btn secondary" data-action="open-folder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            打开文件夹
          </button>
        </div>
        <div class="welcome-features">
          <div class="feature-item">
            <span>📝</span> Markdown 编辑
          </div>
          <div class="feature-item">
            <span>🔗</span> P2P 同步
          </div>
          <div class="feature-item">
            <span>🔍</span> 全文搜索
          </div>
          <div class="feature-item">
            <span>📜</span> 版本历史
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStatusBar(): string {
  const folderName = state.currentFolder?.name || '未选择';
  const activeTab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  const wordCount = activeTab ? activeTab.content.split(/\s+/).filter(w => w.length > 0).length : 0;
  const syncIndicator = state.syncStatus === 'connected' ? 'connected' : '';
  
  return `
    <div class="status-bar">
      <div class="status-left">
        <div class="status-item ${syncIndicator}">
          <span>${state.syncStatus === 'connected' ? '●' : '○'}</span>
          <span>${state.syncStatus === 'connected' ? '已同步' : '未同步'}</span>
        </div>
        <div class="status-item">
          <span>📁</span>
          <span>${escapeHtml(folderName)}</span>
        </div>
      </div>
      <div class="status-right">
        ${activeTab ? `
          <div class="status-item">行 1, 列 1</div>
          <div class="status-item">${wordCount} 字</div>
          <div class="status-item">UTF-8</div>
        ` : ''}
        <div class="status-item">Markdown</div>
      </div>
    </div>
  `;
}

// ============ 预览渲染防并发 ============
let renderPreviewToken = 0;

// ============ 事件处理 ============
let currentAbortController: AbortController | null = null;

function attachEventListeners(): void {
  // 清理旧的监听器
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // 活动栏点击
  document.querySelectorAll('.activity-icon[data-panel]').forEach(el => {
    el.addEventListener('click', async () => {
      const panel = el.getAttribute('data-panel');
      state.sidebar = state.sidebar === panel ? null : panel as 'files' | 'search' | 'sync' | 'history';
      await renderAppAsync();
    }, { signal });
  });

  // 菜单项操作
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = (el as HTMLElement).dataset.action;
      if (action) await handleActionAsync(action, e);
    }, { signal });
  });

  // 菜单下拉悬停处理（防止 Tauri WebView 中 hover 间隙导致菜单消失）
  const menuHideTimers = new Map<Element, number>();
  document.querySelectorAll('.menu-item').forEach(item => {
    const dropdown = item.querySelector('.menu-dropdown') as HTMLElement;
    if (!dropdown) return;

    // 关闭所有菜单下拉的辅助函数
    const closeAllMenus = () => {
      document.querySelectorAll('.menu-dropdown').forEach(dd => {
        (dd as HTMLElement).style.display = '';
      });
    };

    item.addEventListener('mouseenter', () => {
      // 清空当前项的隐藏计时器
      const existing = menuHideTimers.get(item);
      if (existing !== undefined) { clearTimeout(existing); menuHideTimers.delete(item); }
      // 先关所有，再开当前 → 避免上一个菜单残留
      closeAllMenus();
      dropdown.style.display = 'block';
    }, { signal });

    item.addEventListener('mouseleave', () => {
      const timer = window.setTimeout(() => {
        dropdown.style.display = '';
        menuHideTimers.delete(item);
      }, 200);
      menuHideTimers.set(item, timer);
    }, { signal });
  });

  // 点击菜单项后关闭对应下拉
  document.querySelectorAll('.menu-dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const menuItem = el.closest('.menu-item');
      if (menuItem) {
        const dd = menuItem.querySelector('.menu-dropdown') as HTMLElement;
        if (dd) dd.style.display = '';
      }
    }, { signal });
  });

  // 点击菜单外部关闭所有下拉
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.menu-item')) {
      document.querySelectorAll('.menu-dropdown').forEach(dd => {
        (dd as HTMLElement).style.display = '';
      });
    }
  }, { signal });

  // 文件树点击（使用事件委托）
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    
    // 检查是否点击了复选框
    const checkbox = target.closest('.file-checkbox');
    if (checkbox) {
      e.stopPropagation();
      const path = (checkbox as HTMLElement).dataset.select;
      if (path) toggleFileSelection(path);
      return;
    }
    
    // 检查是否点击了删除按钮
    const deleteBtn = target.closest('[data-action="delete-file"]');
    if (deleteBtn) {
      e.stopPropagation();
      const path = (deleteBtn as HTMLElement).dataset.path;
      if (path) deleteFile(path);
      return;
    }

    // 检查是否点击了关闭文件夹按钮
    const closeFolderBtn = target.closest('[data-action="close-folder"]');
    if (closeFolderBtn) {
      e.stopPropagation();
      const indexStr = (closeFolderBtn as HTMLElement).dataset.folderIndex;
      console.log('关闭按钮点击, index:', indexStr);
      if (indexStr) {
        const index = parseInt(indexStr, 10);
        closeFolder(index);
      }
      return;
    }

    // 检查是否点击了文件夹展开箭头
    const folderExpand = target.closest('.folder-expand');
    if (folderExpand) {
      // 顶层文件夹用 .folder-item，子目录用 .folder-expandable
      const folderItem = folderExpand.closest('.folder-item') || folderExpand.closest('.folder-expandable');
      if (folderItem) {
        const folderName = folderItem.getAttribute('data-folder') || folderItem.getAttribute('data-expand') || folderItem.getAttribute('data-path');
        if (folderName) {
          // 顶层文件夹用 .folder-children，子目录用 .file-children
          const children = document.querySelector(`.folder-children[data-parent="${CSS.escape(folderName)}"]`) as HTMLElement
            || document.querySelector(`.file-children[data-parent="${CSS.escape(folderName)}"]`) as HTMLElement;
          if (children) {
            const isExpanded = children.style.display !== 'none';
            children.style.display = isExpanded ? 'none' : 'block';
            folderExpand.textContent = isExpanded ? '▶' : '▼';
          }
        }
        return;
      }
    }
    
    // 检查是否点击了文件项（排除按钮和复选框）- renderFileTree 生成的目录/文件
    const fileItem = target.closest('.file-item[data-type]') as HTMLElement | null;
    if (fileItem && !target.closest('button') && !target.closest('.file-checkbox')) {
      const type = fileItem.getAttribute('data-type');
      const path = fileItem.getAttribute('data-path');
      if (!path) return;

      if (type === 'directory') {
        const children = document.querySelector(`[data-parent="${CSS.escape(path)}"]`) as HTMLElement;
        if (children) {
          const expand = fileItem.querySelector('.folder-expand');
          const isExpanded = children.style.display !== 'none';
          children.style.display = isExpanded ? 'none' : 'block';
          if (expand) expand.textContent = isExpanded ? '▶' : '▼';
        }
      } else if (type === 'file') {
        // 单击：立即选中，不等待
        if (lastSelectedEl && lastSelectedEl !== fileItem) {
          lastSelectedEl.classList.remove('selected');
        }
        fileItem.classList.add('selected');
        lastSelectedEl = fileItem;
        state.selectedFilePath = path;
      }
    }
  }, { signal });

  // 双击打开文件（事件委托）
  document.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const fileItem = target.closest('.file-item[data-type="file"]') as HTMLElement | null;
    if (!fileItem) return;
    const path = fileItem.getAttribute('data-path');
    if (!path) return;
    const folderName = fileItem.getAttribute('data-folder');
    const folder = folderName ? state.folders.find(f => f.name === folderName) : undefined;
    openFile(path, undefined, folder?.handle || undefined);
  }, { signal });

  // 标签页点击
  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.getAttribute('data-path');
      if (path) {
        state.activeTab = path;
        renderAppAsync();
      }
    }, { signal });
  });

  // 标签关闭
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = el.getAttribute('data-close');
      if (path) await closeFile(path);
    }, { signal });
  });

  // 编辑器内容变更（直接在编辑器元素上绑定，避免依赖事件冒泡）
  const editor = document.querySelector('[data-editor]') as HTMLTextAreaElement;
  if (editor) {
    editor.addEventListener('input', () => {
      const tab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
      if (tab) {
        tab.content = editor.value;
        tab.modified = true;
        updateTabModifiedIndicators();
        
        // 更新预览
        if (state.activeView === 'split' || state.activeView === 'preview') {
          renderPreview(editor.value);
        }
      }
    });

    // 编辑器右键菜单
    editor.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, editor);
    });
  }

  // 预览区域右键菜单
  const previewEl = document.querySelector('[data-preview]');
  if (previewEl) {
    previewEl.addEventListener('contextmenu', (e: Event) => {
      const me = e as MouseEvent;
      e.preventDefault();
      showContextMenu(me.clientX, me.clientY, null);
    });
  }

  // 搜索输入
  const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', debounce(async () => {
      const query = searchInput.value.trim();
      if (query.length < 2) {
        const resultsContainer = document.querySelector('[data-search-results]');
        if (resultsContainer) resultsContainer.innerHTML = '';
        return;
      }
      
      const results = await searchService.search(query);
      renderSearchResults(results);
    }, 300));
  }

  // 连接 Peer
  const connectInput = document.querySelector('[data-connect-input]') as HTMLInputElement;
  if (connectInput) {
    connectInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const peerId = connectInput.value.trim();
        if (peerId) connectToPeer(peerId);
      }
    });
  }

  // 查找替换输入框事件
  const findQueryInput = document.querySelector('[data-find-query]') as HTMLInputElement;
  if (findQueryInput) {
    findQueryInput.addEventListener('input', () => {
      findReplaceState.query = findQueryInput.value;
    });
    findQueryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        findNext();
      }
    });
  }

  const findReplaceInput = document.querySelector('[data-find-replace]') as HTMLInputElement;
  if (findReplaceInput) {
    findReplaceInput.addEventListener('input', () => {
      findReplaceState.replaceWith = findReplaceInput.value;
    });
  }

  // 分屏拖拽调节大小
  const resizer = document.querySelector('[data-pane-resizer]') as HTMLElement;
  if (resizer) {
    let isResizing = false;
    
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const editorPane = document.querySelector('[data-editor-pane]') as HTMLElement;
      const previewPane = document.querySelector('[data-preview-pane]') as HTMLElement;
      const container = document.querySelector('.editor-panes') as HTMLElement;
      if (!editorPane || !previewPane || !container) return;
      
      const rect = container.getBoundingClientRect();
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
      if (newWidth > 15 && newWidth < 85) {
        editorPane.style.flex = `0 0 ${newWidth}%`;
        previewPane.style.flex = `0 0 ${100 - newWidth}%`;
      }
    };
    
    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // 使用 AbortController 清理
    if (currentAbortController) {
      currentAbortController.signal.addEventListener('abort', () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      });
    }
  }

  // 侧边栏拖拽调整大小
  const sidebarResizer = document.querySelector('.sidebar-resizer') as HTMLElement;
  const sidebarEl = document.querySelector('.sidebar') as HTMLElement;
  if (sidebarResizer && sidebarEl) {
    sidebarResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sidebarResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startWidth = sidebarEl.offsetWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const newWidth = startWidth + (moveEvent.clientX - startX);
        const clampedWidth = Math.max(150, Math.min(500, newWidth));
        sidebarEl.style.width = `${clampedWidth}px`;
      };

      const onMouseUp = () => {
        sidebarResizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }, { signal });
  }

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      switch (key) {
        case 's':
          e.preventDefault();
          if (e.shiftKey) {
            handleAction('save-file-as');
          } else {
            handleAction('save-file');
          }
          break;

        case 'o':
          e.preventDefault();
          handleAction('open-folder');
          break;
        case 'q':
          e.preventDefault();
          window.close();
          break;
        case 'b':
          e.preventDefault();
          toggleSidebar();
          break;
        case 'f':
          e.preventDefault();
          toggleFindReplace(false);
          break;
        case 'h':
          e.preventDefault();
          toggleFindReplace(true);
          break;
      }
    }

    if (e.key === 'Escape') {
      if (findReplaceState.visible) {
        findReplaceState.visible = false;
        updateFindReplaceBar();
      } else {
        closeAllModals();
      }
    }
  }, { signal });

  // 点击模态框外部关闭
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal-overlay')) {
      closeAllModals();
    }
  }, { signal });
}

async function handleActionAsync(action: string, e?: Event): Promise<void> {
  switch (action) {
    case 'start-local':
      await initLocalStorageMode();
      await renderAppAsync();
      break;

    case 'open-folder':
      openFolder();
      break;
    case 'open-file':
      openFileFromDialog();
      break;
    case 'save-file':
      saveCurrentFile();
      break;
    case 'save-file-as':
      saveFileAs();
      break;
    case 'close-window': {
      const hasChanges = hasUnsavedChanges();
      if (hasChanges) {
        const res = await showSaveConfirmModal('有未保存的更改');
        if (res === 'cancel') return;
        if (res === 'save') {
          for (const [, tab] of state.openFiles) {
            if (tab.modified) await saveCurrentFile();
          }
        }
      }
      if (isTauri()) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } else {
        window.close();
      }
      break;
    }
    case 'view-edit':
      state.activeView = 'edit';
      await renderAppAsync();
      break;
    case 'view-split':
      state.activeView = 'split';
      await renderAppAsync();
      break;
    case 'view-preview':
      state.activeView = 'preview';
      await renderAppAsync();
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'copy-peer-id':
      copyPeerId();
      break;
    case 'connect-peer': {
      const input = document.querySelector('[data-connect-input]') as HTMLInputElement;
      if (input && input.value.trim()) {
        connectToPeer(input.value.trim());
      }
      break;
    }
    case 'show-shortcuts':
      showShortcuts();
      break;
    case 'show-docs':
      showDocs();
      break;
    case 'show-about':
      showAbout();
      break;
    case 'export-logs':
      exportLogs();
      break;
    case 'save-version':
      saveVersion();
      await renderAppAsync();
      break;
    case 'preview-version':
      await previewVersion((e?.target as HTMLElement)?.closest('[data-version-id]')?.getAttribute('data-version-id') || '');
      break;
    case 'restore-version':
      await restoreVersion((e?.target as HTMLElement)?.closest('[data-version-id]')?.getAttribute('data-version-id') || '');
      break;
    case 'delete-version':
      await deleteVersion((e?.target as HTMLElement)?.closest('[data-version-id]')?.getAttribute('data-version-id') || '');
      break;
    case 'delete-file':
      await deleteFile((e?.target as HTMLElement)?.closest('[data-path]')?.getAttribute('data-path') || '');
      break;
    case 'delete-selected':
      await deleteSelectedItems();
      break;
    case 'sync-selected':
      syncSelectedItems();
      break;
    case 'undo':
      editorUndo();
      break;
    case 'redo':
      editorRedo();
      break;
    case 'find':
      toggleFindReplace(false);
      break;
    case 'replace':
      toggleFindReplace(true);
      break;
    case 'toggle-find':
      toggleFindReplace(false);
      break;
    case 'toggle-replace':
      toggleFindReplace(true);
      break;
    case 'find-next':
      findNext();
      break;
    case 'replace-current':
      replaceCurrent();
      break;
    case 'replace-all':
      replaceAll();
      break;
    case 'close-find-replace':
      findReplaceState.visible = false;
      updateFindReplaceBar();
      break;
    case 'toggle-toc':
      state.tocVisible = !state.tocVisible;
      await renderAppAsync();
      break;
    case 'refresh-folder':
      await refreshFolders();
      break;
  }
}

function handleAction(action: string): void {
  handleActionAsync(action);
}

function toggleSidebar(): void {
  state.sidebar = state.sidebar ? null : 'files';
  renderAppAsync();
}

// ============ 历史版本管理 ============
function saveVersion(): void {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!activeTabData) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const label = `${timeStr} - ${activeTabData.content.length} 字符`;
  const timestamp = now.getTime();
  // ID 必须与文件系统保存的文件名一致（时间戳），以便删除时能正确找到文件
  const versionId = timestamp.toString();

  const version: FileVersion = {
    id: versionId,
    content: activeTabData.content,
    timestamp: timestamp,
    date: now.toISOString(),
    label
  };

  activeTabData.versions.unshift(version);

  // 限制最多保存 20 个版本
  if (activeTabData.versions.length > 20) {
    activeTabData.versions.pop();
  }

  // 保存历史版本
  if (fileService.isUsingLocalStorage()) {
    // LocalStorage 模式：统一使用文件名（不含路径），与读取保持一致
    const fileNameOnly = activeTabData.path.split('/').pop() || activeTabData.path;
    fileService.saveLocalStorageFile(activeTabData.path, activeTabData.content);
    fileService.saveFileVersions(fileNameOnly, activeTabData.versions);
  } else {
    // File System Access API 模式 - 保存到 .versions 目录
    // 计算相对于文件夹的路径
    let relativePath = activeTabData.path;
    const firstSlashIndex = relativePath.indexOf('/');
    if (firstSlashIndex > 0) {
      relativePath = relativePath.substring(firstSlashIndex + 1);
    }
    console.log('saveVersion main:', { relativePath, versionId, folderHandle: !!activeTabData.folderHandle, isElectron: fileService.isUsingLocalStorage() });
    fileService.saveVersion(relativePath, activeTabData.content, activeTabData.folderHandle, versionId)
      .then(savedId => {
        if (savedId) {
          console.log('saveVersion success:', savedId);
        } else {
          console.error('saveVersion failed');
          showNotification('保存版本失败', 'error');
        }
      })
      .catch(err => {
        console.error('saveVersion error:', err);
        logError('main.saveVersion', err);
        showNotification('保存版本失败', 'error');
      });
  }

  showNotification(`已保存版本: ${label}`);
}

// ============ 文件选择与同步 ============
function toggleFileSelection(path: string): void {
  if (state.selectedFiles.has(path)) {
    state.selectedFiles.delete(path);
  } else {
    state.selectedFiles.add(path);
  }
  renderAppAsync();
}

// --- Editor Undo/Redo ---
function editorUndo(): void {
  const textarea = document.querySelector('textarea.editor-textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    document.execCommand('undo');
  }
}

function editorRedo(): void {
  const textarea = document.querySelector('textarea.editor-textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    document.execCommand('redo');
  }
}

// --- Find & Replace ---
const findReplaceState = {
  visible: false,
  showReplace: false,
  query: '',
  replaceWith: ''
};

function toggleFindReplace(showReplace = false): void {
  findReplaceState.visible = !findReplaceState.visible;
  findReplaceState.showReplace = showReplace;
  updateFindReplaceBar();
}

function updateFindReplaceBar(): void {
  const bar = document.querySelector('.find-replace-bar') as HTMLElement | null;
  if (!bar) return;
  bar.style.display = findReplaceState.visible ? 'flex' : 'none';
  const replaceInput = bar.querySelector('.find-replace-replace-input') as HTMLElement | null;
  if (replaceInput) {
    replaceInput.style.display = findReplaceState.showReplace ? 'block' : 'none';
  }
  if (findReplaceState.visible) {
    const queryInput = bar.querySelector('.find-replace-query-input') as HTMLInputElement | null;
    if (queryInput) queryInput.focus();
  }
}

function findNext(): void {
  const textarea = document.querySelector('textarea.editor-textarea') as HTMLTextAreaElement | null;
  if (!textarea || !findReplaceState.query) return;
  const content = textarea.value;
  const startPos = textarea.selectionEnd;
  const idx = content.indexOf(findReplaceState.query, startPos);
  if (idx !== -1) {
    textarea.setSelectionRange(idx, idx + findReplaceState.query.length);
    textarea.focus();
  } else {
    const wrapIdx = content.indexOf(findReplaceState.query);
    if (wrapIdx !== -1) {
      textarea.setSelectionRange(wrapIdx, wrapIdx + findReplaceState.query.length);
      textarea.focus();
    }
  }
}

function replaceCurrent(): void {
  const textarea = document.querySelector('textarea.editor-textarea') as HTMLTextAreaElement | null;
  if (!textarea || !findReplaceState.query) return;
  const content = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = content.substring(start, end);
  if (selected === findReplaceState.query) {
    const before = content.substring(0, start);
    const after = content.substring(end);
    const newContent = before + findReplaceState.replaceWith + after;
    textarea.value = newContent;
    // Update state and content
    const tab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
    if (tab) {
      tab.content = newContent;
      tab.modified = true;
    }
    textarea.setSelectionRange(start + findReplaceState.replaceWith.length, start + findReplaceState.replaceWith.length);
    textarea.focus();
    renderAppAsync();
  } else {
    findNext();
  }
}

function replaceAll(): void {
  const textarea = document.querySelector('textarea.editor-textarea') as HTMLTextAreaElement | null;
  if (!textarea || !findReplaceState.query) return;
  const content = textarea.value;
  const regex = new RegExp(findReplaceState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const newContent = content.replace(regex, findReplaceState.replaceWith);
  if (content !== newContent) {
    textarea.value = newContent;
    const tab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
    if (tab) {
      tab.content = newContent;
      tab.modified = true;
    }
    renderAppAsync();
  }
}

async function syncSelectedItems(): Promise<void> {
  if (state.selectedFiles.size === 0) {
    showNotification('请先选择要同步的文件或文件夹', 'error');
    return;
  }

  const selectedItems = Array.from(state.selectedFiles);
  const itemList = selectedItems.map(path => `• ${path.split('/').pop()}`).join('\n');

  const confirmed = await showConfirmModal(`确定要同步以下 ${selectedItems.length} 项吗？\n\n${itemList}`);
  if (!confirmed) {
    return;
  }
  
  // 获取同步面板的 P2P 信息
  const connectedPeers = document.querySelectorAll('[data-peer-connected]');
  
  if (connectedPeers.length === 0) {
    showNotification('没有连接的 peer，无法同步', 'error');
    return;
  }
  
  // 模拟同步过程
  showNotification(`正在同步 ${selectedItems.length} 项...`, 'info');
  
  // TODO: 实现实际的 P2P 同步逻辑
  // 这里可以调用 p2pSync 服务来同步文件
  setTimeout(() => {
    showNotification(`已发送同步请求到 ${connectedPeers.length} 个 peer`, 'success');
  }, 1000);
}

async function deleteSelectedItems(): Promise<void> {
  if (state.selectedFiles.size === 0) {
    showNotification('请先选择要删除的文件或文件夹', 'error');
    return;
  }

  const selectedItems = Array.from(state.selectedFiles);
  const itemList = selectedItems.map(path => `• ${path.split('/').pop()}`).join('\n');
  const confirmed = await showConfirmModal(`确定要删除以下 ${selectedItems.length} 项吗？\n\n${itemList}\n\n此操作不可恢复。`);
  if (!confirmed) return;

  for (const path of selectedItems) {
    await deleteFile(path);
  }
  state.selectedFiles.clear();
  await renderAppAsync();
  showNotification(`已删除 ${selectedItems.length} 项`, 'success');
}

async function previewVersion(versionId: string): Promise<void> {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!activeTabData) {
    console.log('previewVersion: no active tab data');
    return;
  }
  
  const version = activeTabData.versions.find(v => v.id === versionId);
  if (!version) {
    console.log('previewVersion: version not found', versionId, activeTabData.versions);
    return;
  }
  
  // 获取版本内容
  let content = version.content;
  console.log('previewVersion: initial content length', content?.length, 'isLocalStorage:', fileService.isUsingLocalStorage());
  
  if (!content && !fileService.isUsingLocalStorage()) {
    // File System Access API 模式下动态读取内容
    // 计算相对于文件夹的路径
    let relativePath = activeTabData.path;
    const firstSlashIndex = relativePath.indexOf('/');
    if (firstSlashIndex > 0) {
      relativePath = relativePath.substring(firstSlashIndex + 1);
    }
    console.log('previewVersion: loading from FS, path:', relativePath, 'versionId:', versionId, 'folderHandle:', activeTabData.folderHandle);
    try {
      const loadedContent = await fileService.getVersionContent(relativePath, versionId, activeTabData.folderHandle);
      console.log('previewVersion: loaded from FS, length:', loadedContent?.length);
      content = loadedContent || '';
    } catch (err) {
      console.error('previewVersion: failed to load from FS:', err);
      content = '';
    }
  }
  
  console.log('previewVersion: final content length:', content?.length);
  
  // 临时显示预览版本的 HTML
  const html = await state.markdownRenderer!(content);
  const preview = document.querySelector('.preview-content');
  if (preview) {
    preview.innerHTML = `<div class="version-preview-overlay"><div class="version-preview-header">预览版本: ${version.label}</div>${html}</div>`;
  }
}

async function restoreVersion(versionId: string): Promise<void> {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!activeTabData) return;
  
  const version = activeTabData.versions.find(v => v.id === versionId);
  if (!version) return;
  
  // 确认恢复
  const confirmed = await showConfirmModal(`确定要恢复到此版本吗？\n\n版本: ${version.label}\n\n当前内容将被替换。`);
  if (!confirmed) {
    return;
  }
  
  // 保存当前版本
  const now = new Date();
  const backupLabel = `${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - 恢复前备份`;
  activeTabData.versions.push({
    id: `v_${Date.now()}_backup`,
    content: activeTabData.content,
    timestamp: now.getTime(),
    date: now.toISOString(),
    label: backupLabel
  });
  
  // 限制版本数量
  if (activeTabData.versions.length > 20) {
    activeTabData.versions.shift();
  }
  
  // 如果版本内容为空，从文件系统读取
  let restoreContent = version.content;
  if (!restoreContent && !fileService.isUsingLocalStorage()) {
    try {
      const loaded = await fileService.getVersionContent(
        activeTabData.relativePath || activeTabData.path,
        version.id,
        activeTabData.folderHandle
      );
      if (loaded) restoreContent = loaded;
    } catch (err) {
      console.error('读取版本内容失败:', err);
    }
  }
  
  // 恢复版本内容
  activeTabData.content = restoreContent;
  
  // 更新编辑器内容
  const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
  if (textarea) {
    textarea.value = restoreContent;
  }
  
  // 保存到文件
  await saveCurrentFile();
  
  // 重新渲染预览
  if (state.activeView !== 'edit') {
    await renderAppAsync();
    await initPreviewRender();
  }
  
  showNotification(`已恢复到版本: ${version.label}`);
}

async function deleteVersion(versionId: string): Promise<void> {
  const activeTabData = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!activeTabData) return;
  
  const versionIndex = activeTabData.versions.findIndex(v => v.id === versionId);
  if (versionIndex === -1) return;
  
  const version = activeTabData.versions[versionIndex];
  
  // 确认删除
  const confirmed = await showConfirmModal(`确定要删除此版本吗？\n\n版本: ${version.label}\n\n此操作不可恢复。`);
  if (!confirmed) {
    return;
  }
  
  // 从存储中删除版本
  // localStorage 模式下统一使用文件名，与保存保持一致
  let filePath: string;
  if (fileService.isUsingLocalStorage()) {
    filePath = activeTabData.path.split('/').pop() || activeTabData.path;
  } else {
    filePath = activeTabData.relativePath || activeTabData.name;
  }
  const deleted = await fileService.deleteVersion(filePath, versionId, activeTabData.folderHandle);
  
  if (deleted) {
    // 从内存中删除版本
    activeTabData.versions.splice(versionIndex, 1);
    showNotification(`已删除版本: ${version.label}`);
  } else {
    showNotification('删除版本失败', 'error');
  }
  
  renderAppAsync();
}

async function deleteFile(path: string): Promise<void> {
  if (!path) return;
  
  const name = path.split('/').pop() || path;
  
  // 确认删除
  const confirmed = await showConfirmModal(`确定要删除文件 "${name}" 吗？\n\n此操作不可恢复。`);
  if (!confirmed) {
    return;
  }

  try {
    if (fileService.isUsingLocalStorage()) {
      // 删除文件
      fileService.deleteLocalStorageFile(path);
      // 删除历史版本
      fileService.deleteFileVersions(path);
    } else {
      const tab = state.openFiles.get(path);
      const deletePath = tab?.relativePath || tab?.name || name;
      if (deletePath) {
        await fileService.deleteFile(null, deletePath);
      }
    }
    
    // 从打开的标签中移除
    state.openFiles.delete(path);
    
    // 如果当前打开的是此文件，关闭它
    if (state.activeTab === path) {
      // 切换到其他标签
      const tabs = Array.from(state.openFiles.keys());
      state.activeTab = tabs.length > 0 ? tabs[0] : null;
    }
    
    // 刷新文件列表
    if (state.currentFolder) {
      state.files = await fileService.loadFileTree(state.currentFolder as any);
      const folderName = state.currentFolder.name;
      const folder = state.folders.find(f => f.name === folderName);
      if (folder) folder.files = state.files;
    }
    
    showNotification(`已删除文件: ${name}`);
    await renderAppAsync();
  } catch (error) {
    console.error('删除文件失败:', error);
    showNotification(`删除文件失败: ${(error as Error).message}`);
  }
}

// 全局关闭文件夹处理函数（供 onclick 使用）
(window as any).closeFolderHandler = (index: number): void => {
  console.log('closeFolderHandler called with index:', index);
  closeFolder(index);
};

// 关闭文件夹
function closeFolder(index: number): void {
  console.log('closeFolder called, index:', index, 'folders:', state.folders.length);
  const folder = state.folders[index];
  if (!folder) {
    console.log('文件夹不存在, index:', index);
    return;
  }

  // 如果当前激活的文件属于这个文件夹，关闭它
  if (state.activeTab?.startsWith(folder.name + '/')) {
    state.activeTab = null;
  }

  // 关闭所有属于该文件夹的打开文件
  for (const [path] of state.openFiles) {
    if (path.startsWith(folder.name + '/')) {
      state.openFiles.delete(path);
    }
  }

  // 移除该文件夹的选中文件
  folder.files.forEach(file => {
    state.selectedFiles?.delete(file.path);
  });

  // 从列表中移除
  state.folders.splice(index, 1);

  // 保存到本地存储
  localStorage.setItem('md_editor_folders', JSON.stringify(state.folders.map(f => f.name)));

  renderAppAsync();
  showNotification(`已关闭文件夹: ${folder.name}`);
}

// ============ 文件操作 ============
async function openFolder(): Promise<void> {
  try {
    const handle = await fileService.selectFolder();
    
    if (fileService.isUsingLocalStorage()) {
      // LocalStorage fallback mode - 检查是否已存在本地笔记文件夹
      console.log('Using localStorage fallback mode');
      const existingIndex = state.folders.findIndex(f => f.name === '本地笔记');
      if (existingIndex === -1) {
        state.folders.push({
          name: '本地笔记',
          path: '本地笔记',
          handle: null,
          files: fileService.getLocalStorageFiles()
        });
        showNotification('已添加本地笔记文件夹');
      } else {
        showNotification('本地笔记文件夹已存在');
      }
    } else if (handle) {
      // 检查是否已存在同名文件夹
      const folderName = fileService.isElectronMode() && fileService.getCurrentFolderPath()
        ? fileService.getCurrentFolderPath()!.split(/[/\\]/).pop() || handle.name
        : handle.name;
      const existingIndex = state.folders.findIndex(f => f.name === folderName);
      if (existingIndex !== -1) {
        showNotification(`文件夹 "${folderName}" 已经打开`);
        return;
      }
      // 添加新文件夹
      const files = await fileService.loadFileTree(handle);
      state.folders.push({
        name: folderName,
        path: folderName,
        handle: handle,
        files: files
      });
      state.currentFolder = handle;
      state.files = files;

      // 索引所有文件到搜索
      const indexFilesRecursive = (items: typeof files) => {
        items.forEach(item => {
          if (item.isDirectory && item.children) {
            indexFilesRecursive(item.children);
          } else if (!item.isDirectory) {
            // 异步读取文件内容并索引
            fileService.readFile(item.path).then(content => {
              searchService.indexFile({ name: item.name, path: `${handle.name}/${item.path}`, content });
            }).catch(() => { /* ignore */ });
          }
        });
      };
      indexFilesRecursive(files);
    } else {
      // User cancelled
      return;
    }
    
    await renderAppAsync();
  } catch (err) {
    console.error('打开文件夹失败:', err);
    showNotification(`打开文件夹失败: ${(err as Error).message}`);
  }
}

async function refreshFolders(): Promise<void> {
  if (state.folders.length === 0) {
    showNotification('没有打开的文件夹');
    return;
  }
  
  try {
    for (const folder of state.folders) {
      if (folder.handle) {
        const files = await fileService.loadFileTree(folder.handle);
        folder.files = files;
      } else if (fileService.isUsingLocalStorage()) {
        folder.files = fileService.getLocalStorageFiles();
      }
    }
    
    // 更新当前文件列表
    if (state.folders.length > 0) {
      state.files = state.folders[0].files;
    }
    
    await renderAppAsync();
    showNotification('文件夹已刷新');
  } catch (err) {
    console.error('刷新文件夹失败:', err);
    showNotification(`刷新失败: ${(err as Error).message}`);
  }
}

// 自动初始化 localStorage 模式
async function initLocalStorageMode(): Promise<void> {
  // 检查是否已经在使用 localStorage 模式
  if (fileService.isUsingLocalStorage() && state.folders.length > 0) {
    console.log('Already in localStorage mode, skipping init');
    return;
  }
  
  // 在沙箱环境中自动使用 localStorage
  // const isSandbox = window.location.hostname.includes('.dev.coze.site') || 
  //                   window.location.hostname.includes('.prod.coze.site') ||
  //                   window.location.hostname.includes('.cn');
  
  // 如果有文件夹已经打开，不初始化 localStorage 模式
  if (state.folders.length > 0 && !fileService.isUsingLocalStorage()) {
    console.log('Folder already opened, skipping localStorage init');
    return;
  }
  
  console.log('Initializing localStorage mode');
  fileService.setLocalStorageMode(true); // Enable localStorage mode
  state.activeView = 'split'; // Default to split view
  const rootFiles = fileService.getLocalStorageFiles();
  if (rootFiles.length === 0) {
    // Create a sample note
    fileService.saveLocalStorageFile('welcome.md', `# Welcome to Markdown Editor

This is a sample note stored in your browser.

## Features

- **Markdown Editing** with live preview
- **P2P Sync** via WebRTC
- **Local-first** - your data stays on your device

## How to Use

1. Click the file in the sidebar to open it
2. Use the toolbar buttons to switch between edit/split/preview modes
3. Start writing your notes!

## Markdown Support

You can use all standard Markdown syntax:

- **Bold** and *italic* text
- \`inline code\` and code blocks
- Lists (ordered and unordered)
- Links and images
- Tables

## Math Support

Inline math: $E = mc^2$

Block math:

$$
\\int_{a}^{b} f(x) dx = F(b) - F(a)
$$

Enjoy writing!
`);
  }
  // 初始化 folders 数组
  const localFiles = fileService.getLocalStorageFiles();
  state.folders = [{
    name: '本地笔记',
    path: '本地笔记',
    handle: null,
    files: localFiles
  }];
  state.currentFolder = { name: '本地笔记', kind: 'directory' } as any;
  state.files = localFiles;

  // 索引所有本地文件到搜索
  localFiles.forEach(f => {
    if (!f.isDirectory) {
      const content = fileService.getLocalStorageFile(f.path) || '';
      searchService.indexFile({ name: f.name, path: f.path, content });
    }
  });

  // Auto-open first file if exists
  if (localFiles.length > 0 && !state.activeTab) {
    const firstFile = localFiles[0];
    if (!firstFile.isDirectory) {
      await openFile(firstFile.path);
    }
  }
}

// ===================== 右键上下文菜单 =====================
function showContextMenu(x: number, y: number, editor: HTMLTextAreaElement | null) {
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    const hasSelection = editor && editor.selectionStart !== editor.selectionEnd;
    type ContextMenuItem = { label: string; icon: string; action?: () => void; disabled?: boolean; divider?: boolean; submenu?: { label: string; icon: string; action: () => void }[] };
    const items: ContextMenuItem[] = [];
    if (editor) {
      items.push({ label: '撤销', icon: '↩', action: () => { document.execCommand('undo'); } });
      items.push({ label: '重做', icon: '↪', action: () => { document.execCommand('redo'); } });
      items.push({ label: '', icon: '', divider: true });
      items.push({ label: '剪切', icon: '✂', action: () => { document.execCommand('cut'); }, disabled: !hasSelection });
      items.push({ label: '复制', icon: '📋', action: () => { document.execCommand('copy'); }, disabled: !hasSelection });
      items.push({ label: '粘贴', icon: '📎', action: () => { navigator.clipboard.readText().then(t => { insertAtCursor(editor, t); }); } });
      items.push({ label: '删除', icon: '🗑', action: () => { document.execCommand('delete'); }, disabled: !hasSelection });
      items.push({ label: '', icon: '', divider: true });
      items.push({ label: '全选', icon: '☑', action: () => { editor.select(); } });
      items.push({ label: '', icon: '', divider: true });
      items.push({ label: '插入标题', icon: 'H', submenu: [
        { label: '一级标题 H1', icon: 'H1', action: () => { insertMarkdownPrefix(editor, '# '); } },
        { label: '二级标题 H2', icon: 'H2', action: () => { insertMarkdownPrefix(editor, '## '); } },
        { label: '三级标题 H3', icon: 'H3', action: () => { insertMarkdownPrefix(editor, '### '); } },
        { label: '四级标题 H4', icon: 'H4', action: () => { insertMarkdownPrefix(editor, '#### '); } },
        { label: '五级标题 H5', icon: 'H5', action: () => { insertMarkdownPrefix(editor, '##### '); } },
        { label: '六级标题 H6', icon: 'H6', action: () => { insertMarkdownPrefix(editor, '###### '); } },
      ]});
      items.push({ label: '插入粗体', icon: 'B', action: () => { wrapSelection(editor, '**', '**'); } });
      items.push({ label: '插入斜体', icon: 'I', action: () => { wrapSelection(editor, '*', '*'); } });
      items.push({ label: '插入删除线', icon: 'S', action: () => { wrapSelection(editor, '~~', '~~'); } });
      items.push({ label: '插入代码', icon: '<>', action: () => { wrapSelection(editor, '`', '`'); } });
      items.push({ label: '插入代码块', icon: '{}', action: () => { wrapSelection(editor, '\n```\n', '\n```\n'); } });
      items.push({ label: '', icon: '', divider: true });
      items.push({ label: '插入链接', icon: '🔗', action: () => { insertAtCursor(editor, '[链接文本](url)'); } });
      items.push({ label: '插入图片', icon: '🖼', action: () => { insertAtCursor(editor, '![图片描述](image-url)'); } });
      items.push({ label: '插入表格', icon: '▦', action: () => { insertAtCursor(editor, '\n| 列1 | 列2 | 列3 |\n|------|------|------|\n| 内容 | 内容 | 内容 |\n'); } });
      items.push({ label: '插入引用', icon: '❝', action: () => { insertMarkdownPrefix(editor, '> '); } });
      items.push({ label: '插入分割线', icon: '—', action: () => { insertAtCursor(editor, '\n---\n'); } });
      items.push({ label: '', icon: '', divider: true });
      items.push({ label: '插入 Emoji', icon: '😀', action: undefined, submenu: [] }); // emoji submenu handled specially
    } else {
      items.push({ label: '复制', icon: '📋', action: () => { document.execCommand('copy'); }, disabled: !window.getSelection()?.toString() });
      items.push({ label: '全选', icon: '☑', action: () => { document.execCommand('selectAll'); } });
    }
    items.forEach(item => {
      if (item.divider) { const d = document.createElement('div'); d.className = 'context-menu-divider'; menu.appendChild(d); return; }
      const mi = document.createElement('div');
      mi.className = 'context-menu-item' + (item.disabled ? ' disabled' : '') + (item.submenu ? ' has-submenu' : '');
      mi.innerHTML = '<span class="context-menu-icon">' + item.icon + '</span><span class="context-menu-label">' + item.label + '</span>' + (item.submenu ? '<span class="context-menu-arrow">▸</span>' : '');
      if (item.submenu && item.label === '插入 Emoji') {
        // Emoji grid submenu
        const sub = document.createElement('div');
        sub.className = 'context-submenu emoji-grid';
        buildEmojiGrid(editor!, menu, sub);
        mi.appendChild(sub);
      } else if (item.submenu) {
        const sub = document.createElement('div');
        sub.className = 'context-submenu';
        item.submenu.forEach(subItem => {
          const si = document.createElement('div');
          si.className = 'context-menu-item';
          si.innerHTML = '<span class="context-menu-icon">' + subItem.icon + '</span><span class="context-menu-label">' + subItem.label + '</span>';
          si.addEventListener('click', (ev) => { ev.stopPropagation(); subItem.action(); menu.remove(); if (editor) editor.focus(); });
          sub.appendChild(si);
        });
        mi.appendChild(sub);
      } else if (!item.disabled && item.action) {
        mi.addEventListener('click', () => {
          item.action!();
          menu.remove();
          if (editor) { editor.focus(); }
        });
      }
      menu.appendChild(mi);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 4) + 'px';
    // Adjust submenus that would overflow the screen
    const menuRect = menu.getBoundingClientRect();
    menu.querySelectorAll('.has-submenu').forEach((miEl) => {
      const sub = (miEl as HTMLElement).querySelector('.context-submenu') as HTMLElement | null;
      if (sub) {
        const miRect = (miEl as HTMLElement).getBoundingClientRect();
        const subWidth = sub.classList.contains('emoji-grid') ? 340 : 160;
        // Horizontal: flip to left if overflows right edge
        if (menuRect.right + subWidth > window.innerWidth) {
          sub.style.left = 'auto';
          sub.style.right = '100%';
        }
        // Vertical: align submenu bottom to viewport bottom if overflows
        const estimatedSubHeight = sub.classList.contains('emoji-grid') ? Math.min(window.innerHeight * 0.7, 500) : 240;
        if (miRect.top + estimatedSubHeight > window.innerHeight) {
          sub.style.top = 'auto';
          sub.style.bottom = '0';
        }
      }
    });
  }

  function buildEmojiGrid(editor: HTMLTextAreaElement, menu: HTMLDivElement, container: HTMLDivElement) {
    const categories: { name: string; emojis: string[] }[] = [
      { name: '笑脸', emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😈','👿','💀','☠','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
      { name: '手势', emojis: ['👍','👎','👌','✌','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝','✋','🤚','🖐','🖖','👋','🤏','💪','🦾','🙏','✍','👏','🙌','👐','🤲','🤝'] },
      { name: '动物', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦆','🦉','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮'] },
      { name: '食物', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯'] },
      { name: '自然', emojis: ['🌸','💐','🌷','🌹','🥀','🌺','🌻','🌼','🌱','🪴','🌲','🌳','🌴','🌵','🌾','🌿','☘','🍀','🍁','🍂','🍃','🌍','🌎','🌏','🗺','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🧱','🪨','🪵','🛖','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩','🕋','⛲','⛺','🌁','🌃','🏙','🌄','🌅','🌆','🌇','🌉','♨','🎠','🛝','🎡','🎢','💈','🎪'] },
      { name: '物品', emojis: ['💡','🔦','🕯','📱','💻','⌨','🖥','🖨','🖱','🖲','💾','💿','📀','📼','📷','📹','🎥','📽','🎞','📞','☎','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🪫','🔌','💰','🪙','💴','💵','💶','💷','🏧','💳','💎','⚖','🪜','🧰','🪛','🔧','🔨','⚒','🛠','⛏','🪚','🔩','🔒','🔓','🔏','🔐','🔑','🗝','🗡','⚔','🛡','🪃','🏹','🔫','🪄','🔮','📿','👾','🎯','🎲','🧩','🧸','🪅','🪩','🪆','♠','♥','♦','♣','♟','🃏','🀄','🎴','🎭','🖼','🎨','🧵','🪡','🧶','🪢'] },
      { name: '符号', emojis: ['❤','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣','💕','💞','💓','💗','💖','💘','💝','💟','☮','✝','☪','🕉','☸','✡','🔯','🕎','☯','☦','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛','🉑','☢','☣','📴','📳','🈶','🈚','🈸','🈺','🈷','✴','🆚','💮','🉐','㊙','㊗','🈴','🈵','🈹','🈲','🅰','🅱','🆎','🆑','🅾','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼','⁉','🔅','🔆','〽','⚠','🚸','🔱','⚜','🔰','♻','✅','🈯','💹','❇','✳','❎','🌐','💠','Ⓜ','🌀','💤','🏧','🚾','♿','🅿','🛗','🈳','🈂','🛂','🛃','🛄','🛅'] },
    ];
    for (const cat of categories) {
      const label = document.createElement('div');
      label.className = 'emoji-category-label';
      label.textContent = cat.name;
      container.appendChild(label);
      for (const emoji of cat.emojis) {
        const item = document.createElement('div');
        item.className = 'emoji-item';
        // Use Twemoji SVG images for reliable cross-platform emoji rendering
        const codepoints = [...emoji]
          .filter(ch => ch !== '\uFE0F' && ch !== '\uFE0E')
          .map(ch => ch.codePointAt(0)!.toString(16))
          .join('-');
        const img = document.createElement('img');
        img.src = `/emoji/${codepoints}.svg`;
        img.alt = emoji;
        img.loading = 'lazy';
        img.style.cssText = 'width:22px;height:22px;display:block;pointer-events:none';
        img.onerror = () => { img.remove(); item.textContent = emoji; };
        item.appendChild(img);
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          insertAtCursor(editor, emoji);
          menu.remove();
          editor.focus();
        });
        container.appendChild(item);
      }
    }
  }

  function insertAtCursor(editor: HTMLTextAreaElement, text: string) {
    const s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
    editor.value = v.substring(0, s) + text + v.substring(e);
    editor.selectionStart = editor.selectionEnd = s + text.length;
  }

  function wrapSelection(editor: HTMLTextAreaElement, before: string, after: string) {
    const s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
    const sel = v.substring(s, e);
    editor.value = v.substring(0, s) + before + sel + after + v.substring(e);
    editor.selectionStart = s + before.length;
    editor.selectionEnd = s + before.length + sel.length;
  }

  function insertMarkdownPrefix(editor: HTMLTextAreaElement, prefix: string) {
    const s = editor.selectionStart;
    const ls = editor.value.lastIndexOf('\n', s - 1) + 1;
    const v = editor.value;
    if (v.substring(ls, ls + prefix.length) === prefix) {
      editor.value = v.substring(0, ls) + v.substring(ls + prefix.length);
      editor.selectionStart = editor.selectionEnd = s - prefix.length;
    } else {
      editor.value = v.substring(0, ls) + prefix + v.substring(ls);
      editor.selectionStart = editor.selectionEnd = s + prefix.length;
    }
  }

  document.addEventListener('click', (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.context-menu')) {
      document.querySelectorAll('.context-menu').forEach(el => el.remove());
    }
  });

async function openFile(path: string, fileHandle?: FileSystemFileHandle, folderHandle?: FileSystemDirectoryHandle): Promise<void> {
  try {
    let content: string;
    let actualFolderHandle = folderHandle;
    
    // 如果没有传入 folderHandle，尝试从路径推断
    if (!actualFolderHandle && !fileService.isUsingLocalStorage()) {
      const firstSlashIndex = path.indexOf('/');
      if (firstSlashIndex > 0) {
        const folderName = path.substring(0, firstSlashIndex);
        const folder = state.folders.find(f => f.name === folderName);
        if (folder) {
          actualFolderHandle = folder.handle || undefined;
        }
      } else {
        // 文件在根目录，使用第一个文件夹
        const firstFolder = state.folders[0];
        if (firstFolder) {
          actualFolderHandle = firstFolder.handle || undefined;
        }
      }
    }
    
    // 提取相对于文件夹的文件路径（去掉文件夹名称前缀）
    let relativePath = path;
    if (!fileService.isUsingLocalStorage() && actualFolderHandle) {
      const firstSlashIndex = path.indexOf('/');
      if (firstSlashIndex > 0) {
        relativePath = path.substring(firstSlashIndex + 1);
      }
    }
    
    const fileNameOnly = path.split('/').pop() || path;
    if (fileService.isUsingLocalStorage()) {
      // LocalStorage fallback mode
      const localContent = fileService.getLocalStorageFile(fileNameOnly);
      if (localContent !== null) {
        content = localContent;
      } else {
        console.error('File not found in localStorage:', fileNameOnly);
        return;
      }
    } else {
      // 先尝试 File System Access API，失败则回退到 localStorage
      try {
        content = await fileService.readFile(relativePath);
      } catch (err) {
        const localContent = fileService.getLocalStorageFile(fileNameOnly);
        if (localContent !== null) {
          content = localContent;
        } else {
          throw err;
        }
      }
    }
    
    const name = path.split('/').pop() || path;

    // 读取历史版本
    let versions: FileVersion[] = [];
    const versionPath = fileService.isUsingLocalStorage() ? (path.split('/').pop() || path) : path;
    console.log('openFile: loading versions for path:', versionPath, 'isLocalStorage:', fileService.isUsingLocalStorage());
    if (fileService.isUsingLocalStorage()) {
      versions = fileService.getFileVersions(versionPath);
      console.log('openFile: loaded versions from localStorage:', versions.length);
    } else {
      // File System Access API 模式 - 从 .versions 目录读取
      const fsVersions = await fileService.getVersionHistoryFromFS(relativePath, actualFolderHandle);
      versions = fsVersions.map(v => ({
        id: v.version,
        content: '',
        timestamp: new Date(v.time).getTime(),
        label: new Date(v.time).toLocaleString(),
        date: v.time
      }));
    }

    state.openFiles.set(path, {
      name,
      path,
      relativePath,
      content,
      originalContent: content,
      modified: false,
      handle: fileHandle,
      folderHandle: actualFolderHandle,
      versions
    });

    // 添加到搜索索引
    searchService.indexFile({ name, path, content });

    state.activeTab = path;
    await renderAppAsync();
    
    // 更新预览（renderAppAsync 已处理，这里仅作为备用）
    // if (state.activeView === 'split' || state.activeView === 'preview') {
    //   renderPreview(content);
    // }
  } catch (err) {
    console.error('打开文件失败:', err);
    showModal('错误', `<p>无法打开文件: ${escapeHtml(String(err))}</p>`);
  }
}

async function openFileFromDialog(): Promise<void> {
  const result = await fileService.selectFile();
  if (!result) return;
  const name = (result.handle as unknown as { name?: string })?.name || 'untitled.md';
  const path = name;
  state.openFiles.set(path, {
    name,
    path,
    relativePath: name,
    content: result.content,
    originalContent: result.content,
    modified: false,
    handle: result.handle,
    versions: []
  });
  state.activeTab = path;
  await renderAppAsync();
}

async function saveCurrentFile(): Promise<void> {
  const tab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!tab) return;

  try {
    const savePath = fileService.isUsingLocalStorage() ? tab.path : (tab.relativePath || tab.path);
    await fileService.saveFile(savePath, tab.content);
    tab.modified = false;
    // 更新搜索索引
    searchService.indexFile({ name: tab.name, path: tab.path, content: tab.content });
    updateTabModifiedIndicators();
  } catch (err) {
    console.error('保存文件失败:', err);
    showModal('错误', `<p>保存失败: ${escapeHtml(String(err))}</p>`);
  }
}

async function saveFileAs(): Promise<void> {
  const tab = state.activeTab ? state.openFiles.get(state.activeTab) : null;
  if (!tab) {
    showModal('提示', '<p>没有打开的文件</p>');
    return;
  }
  
  if (!state.currentFolder) {
    // Tauri mode without folder: use native save dialog
    if (isTauri() && window.electronAPI) {
      try {
        const savePath = await window.electronAPI.showSaveFileDialog(tab.name);
        if (!savePath) return;
        const success = await window.electronAPI.writeFile(savePath, tab.content);
        if (success) {
          const fileName = savePath.split(/[/\\]/).pop() || savePath;
          const newPath = fileName;
          const oldPath = tab.path;
          state.openFiles.delete(oldPath);
          state.openFiles.set(newPath, {
            ...tab,
            name: fileName,
            path: newPath,
            relativePath: newPath,
            modified: false,
          });
          state.activeTab = newPath;
          await renderAppAsync();
          showNotification(`文件已保存到: ${fileName}`);
        } else {
          showModal('错误', '<p>保存文件失败</p>');
        }
      } catch (err) {
        console.error('另存为失败:', err);
        showModal('错误', `<p>另存为失败: ${escapeHtml(String(err))}</p>`);
      }
      return;
    }
    // localStorage mode
    const name = await showPromptModal('输入文件名', tab.name);
    if (!name) return;
    
    const fileName = name.endsWith('.md') ? name : name + '.md';
    const newPath = fileName;
    
    try {
      // 保存到 localStorage
      await fileService.saveLocalStorageFile(newPath, tab.content);
      
      // 更新文件列表
      const existingIndex = state.files.findIndex(f => f.name === fileName);
      if (existingIndex === -1) {
        state.files.push({
          name: fileName,
          path: newPath,
          isDirectory: false
        });
      }
      
      // 更新当前标签的信息
      const oldPath = tab.path;
      state.openFiles.delete(oldPath);
      state.openFiles.set(newPath, {
        ...tab,
        name: fileName,
        path: newPath,
        modified: false
      });
      state.activeTab = newPath;
      
      await renderAppAsync();
      showModal('成功', `<p>文件已保存为: ${escapeHtml(fileName)}</p>`);
    } catch (err) {
      console.error('另存为失败:', err);
      showModal('错误', `<p>另存为失败: ${escapeHtml(String(err))}</p>`);
    }
    return;
  }
  
  // File System Access API 模式
  const name = await showPromptModal('输入文件名', tab.name);
  if (!name) return;
  
  const fileName = name.endsWith('.md') ? name : name + '.md';
  
  try {
    await fileService.saveFile(fileName, tab.content);
    const folderName = state.currentFolder.name;
    const newPath = `${folderName}/${fileName}`;
    
    // 更新文件列表
    const existingIndex = state.files.findIndex(f => f.name === fileName);
    if (existingIndex === -1) {
      state.files.push({
        name: fileName,
        path: newPath,
        isDirectory: false
      });
    }
    
    // 更新当前标签的信息
    const oldPath = tab.path;
    state.openFiles.delete(oldPath);
    state.openFiles.set(newPath, {
      ...tab,
      name: fileName,
      path: newPath,
      relativePath: fileName,
      modified: false
    });
    state.activeTab = newPath;
    
    await renderAppAsync();
    showModal('成功', `<p>文件已保存为: ${escapeHtml(fileName)}</p>`);
  } catch (err) {
    console.error('另存为失败:', err);
    showModal('错误', `<p>另存为失败: ${escapeHtml(String(err))}</p>`);
  }
}

async function closeFile(path: string): Promise<void> {
  const tab = state.openFiles.get(path);
  if (tab && tab.modified) {
    const result = await showSaveConfirmModal(tab.name);
    if (result === 'cancel') return;
    if (result === 'save') {
      await saveCurrentFile();
    }
    // 'dontSave' - 直接关闭，丢弃修改
  }

  state.openFiles.delete(path);
  
  if (state.activeTab === path) {
    const remaining = Array.from(state.openFiles.keys());
    state.activeTab = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
  
  renderAppAsync();
}

// ============ 搜索 ============
function renderSearchResults(results: SearchResultType[]): void {
  const container = document.querySelector('[data-search-results]');
  if (!container) return;
  
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>没有找到结果</p></div>';
    return;
  }
  
  container.innerHTML = results.slice(0, 20).map(result => `
    <div class="search-result" data-file="${escapeHtml(result.path)}">
      <div class="result-file">
        <span>📄</span>
        <span>${escapeHtml(result.name)}</span>
      </div>
      ${result.matches && result.matches.length > 0 ? `
        <div class="result-match">${escapeHtml(result.matches[0].context)}</div>
      ` : ''}
    </div>
  `).join('');
  
  container.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const file = el.getAttribute('data-file');
      if (file) openFile(file);
    });
  });
}

// ============ P2P 同步 ============
async function initializeP2P(): Promise<void> {
  try {
    p2pService = new P2PSyncService();
    state.peerId = p2pService.getPeerId();
    
    p2pService.onStatusChange((peerId: string, connected: boolean) => {
      state.syncStatus = connected ? 'connected' : 'disconnected';
      // 不调用 renderApp()，避免无限循环
    });
  } catch (err) {
    console.error('P2P 初始化失败:', err);
  }
}

async function copyPeerId(): Promise<void> {
  if (state.peerId) {
    await navigator.clipboard.writeText(state.peerId);
    showModal('提示', '<p>Peer ID 已复制到剪贴板</p>');
  }
}

async function connectToPeer(peerId: string): Promise<void> {
  if (!p2pService) return;
  
  try {
    state.syncStatus = 'connecting';
    await renderAppAsync();
    
    const result = await p2pService.connectToPeer(peerId);
    if (result.success) {
      state.syncStatus = 'connected';
    } else {
      state.syncStatus = 'disconnected';
      showModal('连接失败', '<p>无法连接到指定节点</p>');
    }
    await renderAppAsync();
  } catch (err) {
    console.error('连接失败:', err);
    state.syncStatus = 'disconnected';
    showModal('连接失败', `<p>${escapeHtml(String(err))}</p>`);
    await renderAppAsync();
  }
}

// ============ 模态框 ============
function showModal(title: string, content: string): void {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">${content}</div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  overlay.querySelector('.modal-close')?.addEventListener('click', closeAllModals);
}

function closeAllModals(): void {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
}

function showPromptModal(title: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-close" data-prompt-cancel>×</button>
        </div>
        <div class="modal-body">
          <input type="text" class="prompt-input" value="${escapeHtml(defaultValue)}" style="width: 100%; padding: 8px; background: var(--bg-dark); border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary" data-prompt-cancel>取消</button>
            <button class="btn btn-primary" data-prompt-ok>确定</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.prompt-input') as HTMLInputElement;
    input?.focus();
    input?.select();

    const cleanup = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('[data-prompt-ok]')?.addEventListener('click', () => {
      cleanup(input?.value || null);
    });

    overlay.querySelectorAll('[data-prompt-cancel]').forEach(el => {
      el.addEventListener('click', () => cleanup(null));
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(input.value || null);
      if (e.key === 'Escape') cleanup(null);
    });
  });
}

function showConfirmModal(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>确认</h3>
          <button class="modal-close" data-confirm-cancel>×</button>
        </div>
        <div class="modal-body">
          <p style="white-space: pre-line;">${escapeHtml(message)}</p>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary" data-confirm-cancel>取消</button>
            <button class="btn btn-primary" data-confirm-ok>确定</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('[data-confirm-ok]')?.addEventListener('click', () => cleanup(true));
    overlay.querySelectorAll('[data-confirm-cancel]').forEach(el => {
      el.addEventListener('click', () => cleanup(false));
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cleanup(false);
    });
  });
}

function showSaveConfirmModal(fileName: string): Promise<'save' | 'dontSave' | 'cancel'> {
  return new Promise((resolve) => {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Markdown Editor</h3>
          <button class="modal-close" data-save-cancel>×</button>
        </div>
        <div class="modal-body">
          <p style="white-space: pre-line;">是否保存对 "${escapeHtml(fileName)}" 的更改？</p>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary" data-save-dont>不保存</button>
            <button class="btn btn-secondary" data-save-cancel>取消</button>
            <button class="btn btn-primary" data-save-ok>保存</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (value: 'save' | 'dontSave' | 'cancel') => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('[data-save-ok]')?.addEventListener('click', () => cleanup('save'));
    overlay.querySelector('[data-save-dont]')?.addEventListener('click', () => cleanup('dontSave'));
    overlay.querySelectorAll('[data-save-cancel]').forEach(el => {
      el.addEventListener('click', () => cleanup('cancel'));
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cleanup('cancel');
    });
  });
}

function showShortcuts(): void {
  const shortcuts = [

    ['打开文件夹', 'Ctrl+O'],
    ['保存文件', 'Ctrl+S'],
    ['另存为', 'Ctrl+Shift+S'],
    ['切换侧边栏', 'Ctrl+B'],
    ['关闭弹窗', 'Escape']
  ];
  
  const content = `
    <div class="shortcuts-list">
      ${shortcuts.map(([action, key]) => `
        <div class="shortcut-item">
          <span class="shortcut-action">${action}</span>
          <span class="shortcut-key">${key}</span>
        </div>
      `).join('')}
    </div>
  `;
  
  showModal('快捷键', content);
}

function showDocs(): void {
  const content = `
    <div class="docs-content">
      <section>
        <h3>快速开始</h3>
        <ol>
          <li>点击「打开文件夹」选择要编辑的 Markdown 文件所在目录</li>
          <li>在文件列表中点击文件名打开编辑器</li>
          <li>编辑完成后会自动保存，或使用 Ctrl+S 手动保存</li>
        </ol>
      </section>
      <section>
        <h3>P2P 同步</h3>
        <ul>
          <li>复制你的 Peer ID 发送给其他设备</li>
          <li>在其他设备上输入你的 Peer ID 进行连接</li>
          <li>连接成功后，文件更改会自动同步</li>
        </ul>
      </section>
      <section>
        <h3>搜索</h3>
        <p>在搜索面板输入关键词，可搜索文件名和文件内容。</p>
      </section>
      <section>
        <h3>历史版本</h3>
        <ul>
          <li>点击活动栏的时钟图标打开历史版本面板</li>
          <li>保存文件时会自动创建版本快照</li>
          <li>最多保存 20 个历史版本</li>
          <li>可以预览或恢复任意历史版本</li>
        </ul>
      </section>
    </div>
  `;
  
  showModal('使用文档', content);
}

// ============ 通知提示 ============
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

function showNotification(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  // 移除现有通知
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <span class="notification-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="notification-message">${escapeHtml(message)}</span>
  `;
  
  document.body.appendChild(notification);
  
  // 动画显示
  requestAnimationFrame(() => {
    notification.classList.add('show');
  });
  
  // 3秒后自动隐藏
  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function showAbout(): void {
  const content = `
    <div class="about-content">
      <div class="about-logo">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="4" y="4" width="56" height="56" rx="8" fill="#4ec9b0" fill-opacity="0.2" stroke="#4ec9b0" stroke-width="2"/>
          <path d="M16 20h32M16 32h24M16 44h28" stroke="#4ec9b0" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>Markdown Editor</h2>
      <p class="version">版本 1.0.0</p>
      <p>本地 P2P Markdown 编辑器，无公网依赖，数据完全可控。</p>
      <div class="about-features">
        <span>Markdown 编辑</span>
        <span>P2P 同步</span>
        <span>全文搜索</span>
        <span>版本历史</span>
      </div>
    </div>
  `;
  
  showModal('关于', content);
}

function setupGlobalErrorCapture(): void {
  const w = window as Window & { __errorLog?: string[] };
  w.__errorLog = [];

  window.addEventListener('error', (e) => {
    const msg = `[${new Date().toLocaleTimeString()}] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
    w.__errorLog?.push(msg);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = `[${new Date().toLocaleTimeString()}] Unhandled Promise: ${e.reason}`;
    w.__errorLog?.push(msg);
  });
}

function exportLogs(): void {
  const lines: string[] = [];
  lines.push('=== Markdown Editor 日志导出 ===');
  lines.push(`导出时间: ${new Date().toLocaleString()}`);
  lines.push(`用户代理: ${navigator.userAgent}`);
  lines.push(`平台: ${navigator.platform}`);
  lines.push(`语言: ${navigator.language}`);
  lines.push('');

  lines.push('--- 当前状态 ---');
  lines.push(`打开文件数: ${state.openFiles.size}`);
  lines.push(`活动标签: ${state.activeTab || '无'}`);
  lines.push(`当前视图: ${state.activeView}`);
  lines.push(`侧边栏可见: ${state.sidebarVisible}`);
  lines.push(`文件夹数: ${state.folders.length}`);
  state.folders.forEach(f => lines.push(`  - ${f.name} (${f.path || '无路径'})`));
  lines.push('');

  lines.push('--- 打开的文件 ---');
  for (const [path, tab] of state.openFiles) {
    const dirty = tab.originalContent !== undefined && tab.content !== tab.originalContent ? ' [未保存]' : '';
    lines.push(`  ${path}: ${tab.content.length} 字${dirty}`);
  }
  lines.push('');

  lines.push('--- localStorage 文件 ---');
  try {
    const localFiles = fileService.getLocalStorageFiles();
    localFiles.forEach(f => lines.push(`  ${f.name} (${f.path})`));
  } catch (e) {
    lines.push(`  读取失败: ${e}`);
  }
  lines.push('');

  lines.push('--- localStorage 键值 (前 20 项) ---');
  try {
    let count = 0;
    for (let i = 0; i < localStorage.length && count < 20; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        const preview = value ? value.substring(0, 200).replace(/\n/g, '\\n') : '(null)';
        lines.push(`  ${key}: ${preview}${value && value.length > 200 ? '...' : ''}`);
        count++;
      }
    }
  } catch (e) {
    lines.push(`  读取失败: ${e}`);
  }
  lines.push('');

  lines.push('--- 控制台错误日志 ---');
  const errors = (window as Window & { __errorLog?: string[] }).__errorLog || [];
  if (errors.length === 0) {
    lines.push('  (无错误日志)');
  } else {
    errors.slice(-50).forEach(e => lines.push(`  ${e}`));
  }
  lines.push('');

  lines.push('=== 日志结束 ===');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `md-editor-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ 未保存更改检测 ============
function hasUnsavedChanges(): boolean {
  for (const tab of state.openFiles.values()) {
    if (tab.modified) return true;
  }
  return false;
}

// ============ 服务初始化 ============
async function initializeServices(): Promise<void> {
  await initializeP2P();

  // 浏览器模式：退出前提示（Electron 环境由主进程处理，跳过）
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Electron menu event listeners
  if (window.electronAPI) {
    if (window.electronAPI.onMenuOpenFolder) {
      window.electronAPI.onMenuOpenFolder(() => openFolder());
    }
    if (window.electronAPI.onMenuSave) {
      window.electronAPI.onMenuSave(() => saveCurrentFile());
    }

    if (window.electronAPI.onMenuUndo) {
      window.electronAPI.onMenuUndo(() => editorUndo());
    }
    if (window.electronAPI.onMenuRedo) {
      window.electronAPI.onMenuRedo(() => editorRedo());
    }
    if (window.electronAPI.onMenuFind) {
      window.electronAPI.onMenuFind(() => toggleFindReplace(false));
    }
    if (window.electronAPI.onCheckUnsaved) {
      window.electronAPI.onCheckUnsaved(() => {
        window.electronAPI?.sendUnsavedResponse?.(hasUnsavedChanges());
      });
    }
  }
}

// ============ 工具函数 ============
function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), delay);
  };
}

// ============ 启动应用 ============
document.addEventListener('DOMContentLoaded', async () => {
  // Setup Tauri shim before anything else
  if (isTauri()) {
    await setupTauriShim();
  }

  // 在沙箱或 Electron/Tauri 环境中自动初始化 localStorage 模式
  const isSandbox = window.location.hostname.includes('.dev.coze.site') || 
                    window.location.hostname.includes('.prod.coze.site') ||
                    window.location.hostname.includes('.cn');
  
  // Electron/Tauri 或沙箱环境，或者没有任何文件夹时，初始化 localStorage
  const isElectron = navigator.userAgent.includes('Electron') || isTauri();
  if (isSandbox || isElectron || state.folders.length === 0) {
    await initLocalStorageMode();
  }
  
  await renderAppAsync();
});

function setupScrollIndicators(): void {
  const scrollTimeouts = new Map<EventTarget, number>();

  document.addEventListener('scroll', (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    target.classList.add('scrolling');

    const existingTimeout = scrollTimeouts.get(target);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeout = window.setTimeout(() => {
      target.classList.remove('scrolling');
      scrollTimeouts.delete(target);
    }, 800);

    scrollTimeouts.set(target, timeout);
  }, true);
}

export { renderApp, renderAppAsync };

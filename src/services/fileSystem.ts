import { isTauri } from './tauri-api';

// File System Access API Service
// 扩展 Window 接口以支持 File System Access API 和 Electron/Tauri API
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: {
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      multiple?: boolean;
    }): Promise<FileSystemFileHandle[]>;
    electronAPI?: {
      showOpenDialog: () => Promise<string | null>;
      showOpenFileDialog: () => Promise<string | null>;
      showSaveFileDialog: (defaultName: string) => Promise<string | null>;
      readDirectory: (dirPath: string) => Promise<{ name: string; isDirectory: boolean; path: string }[]>;
      readFile: (filePath: string) => Promise<string | null>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      deleteFile: (filePath: string) => Promise<boolean>;
      renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
      deleteDirectory: (dirPath: string) => Promise<boolean>;
      saveVersion: (folderPath: string, fileName: string, versionId: string, content: string) => Promise<boolean>;
      getVersionHistory: (folderPath: string, fileName: string) => Promise<{ version: string; time: string; size: number }[]>;
      deleteVersionFile: (folderPath: string, fileName: string, versionId: string) => Promise<boolean>;
      getVersionContent: (folderPath: string, fileName: string, versionId: string) => Promise<string | null>;
      writeErrorLog: (logContent: string) => Promise<string | null>;
      onMenuOpenFolder: (callback: () => void) => (() => void);
      onMenuSave: (callback: () => void) => (() => void);
      onMenuUndo: (callback: () => void) => (() => void);
      onMenuRedo: (callback: () => void) => (() => void);
      onMenuFind: (callback: () => void) => (() => void);
      onCheckUnsaved: (callback: () => void) => (() => void);
      sendUnsavedResponse: (hasUnsaved: boolean) => void;
    };
  }
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
  expanded?: boolean;
}

export interface FileVersion {
  id: string;
  timestamp: number;
  date: string;
  content: string;
  label?: string;
}

// Error log helper
export function logError(context: string, error: unknown): void {
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const logEntry = `[${timestamp}] [${context}] ${message}`;
  console.error(logEntry);
  // Store in memory for export
  const logs = JSON.parse(localStorage.getItem('md-editor-error-logs') || '[]');
  logs.push(logEntry);
  // Keep last 100 entries
  if (logs.length > 100) logs.shift();
  localStorage.setItem('md-editor-error-logs', JSON.stringify(logs));
}

export function getErrorLogs(): string {
  const logs = JSON.parse(localStorage.getItem('md-editor-error-logs') || '[]');
  return logs.join('\n');
}

export function clearErrorLogs(): void {
  localStorage.removeItem('md-editor-error-logs');
}

export async function exportErrorLogs(): Promise<void> {
  const logs = getErrorLogs();
  if (!logs) {
    console.log('No error logs to export');
    return;
  }
  // In Electron, write to file via IPC
  if (window.electronAPI) {
    const logFile = await window.electronAPI.writeErrorLog(logs);
    if (logFile) {
      console.log('Error log saved to:', logFile);
      alert(`错误日志已保存到: ${logFile}`);
    }
    return;
  }
  // In browser, download as file
  const blob = new Blob([logs], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `markdown-editor-error-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export class FileSystemAccessService {
  private currentFolderHandle: FileSystemDirectoryHandle | null = null;
  private currentFolderPath: string | null = null; // For Electron/Tauri mode
  private useLocalStorage = false; // Fallback mode
  private isElectron = false;

  constructor() {
    this.isElectron = isTauri() || (typeof window !== 'undefined' && window.electronAPI !== undefined);
    console.log('FileSystemAccessService: isElectron =', this.isElectron, 'isTauri =', isTauri());
  }

  isElectronMode(): boolean {
    return this.isElectron;
  }

  getCurrentFolderPath(): string | null {
    return this.currentFolderPath;
  }

  async selectFolder(): Promise<FileSystemDirectoryHandle | null> {
    try {
      // Electron mode: use IPC
      if (this.isElectron && window.electronAPI) {
        const folderPath = await window.electronAPI.showOpenDialog();
        if (folderPath) {
          this.currentFolderPath = folderPath;
          this.useLocalStorage = false;
          // Return a mock handle for compatibility
          return { name: folderPath.split(/[/\\]/).pop() || folderPath } as FileSystemDirectoryHandle;
        }
        return null;
      }

      // Check if File System Access API is available (Browser mode)
      if ('showDirectoryPicker' in window) {
        const handle = await window.showDirectoryPicker({
          mode: 'readwrite'
        });
        this.currentFolderHandle = handle;
        this.useLocalStorage = false;
        return handle;
      } else {
        // Fallback: Use localStorage for demo purposes
        console.log('File System Access API not available, using localStorage fallback');
        this.useLocalStorage = true;
        // Create a virtual root
        const rootFiles = this.getLocalStorageFiles();
        if (rootFiles.length === 0) {
          // Create a sample note
          this.saveLocalStorageFile('welcome.md', '# Welcome to Markdown Editor\n\nThis is a sample note stored in your browser.\n\n## Features\n\n- **Markdown Editing** with live preview\n- **Local-first** - your data stays on your device\n\nStart writing your notes!');
        }
        return null;
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        logError('selectFolder', err);
      }
      return null;
    }
  }
  
  // LocalStorage fallback methods
  getLocalStorageFiles(): FileItem[] {
    const notes = localStorage.getItem('md-editor-notes');
    if (!notes) return [];
    try {
      const files: FileItem[] = JSON.parse(notes);
      // Filter out version history items (files starting with . or containing history/versions)
      return files.filter(f => {
        const name = f.name.toLowerCase();
        return !name.startsWith('.') && !name.includes('.versions') && !name.includes('history');
      });
    } catch {
      return [];
    }
  }
  
  private saveLocalStorageFiles(files: FileItem[]): void {
    localStorage.setItem('md-editor-notes', JSON.stringify(files));
  }
  
  getLocalStorageFile(name: string): string | null {
    // 确保 name 不带 / 前缀（统一格式）
    const normalizedName = name.startsWith('/') ? name.slice(1) : name;
    const key = `file:${normalizedName}`;
    const content = localStorage.getItem(key);
    console.log('getLocalStorageFile: name:', name, 'key:', key, 'found:', content !== null, 'length:', content?.length);
    return content;
  }
  
  saveLocalStorageFile(name: string, content: string): void {
    // 确保 name 不带 / 前缀（统一格式）
    const normalizedName = name.startsWith('/') ? name.slice(1) : name;
    localStorage.setItem(`file:${normalizedName}`, content);
    const files = this.getLocalStorageFiles();
    const existing = files.find(f => f.name === normalizedName);
    if (!existing) {
      files.push({ name: normalizedName, path: `/${normalizedName}`, isDirectory: false });
      this.saveLocalStorageFiles(files);
    }
  }
  
  deleteLocalStorageFile(name: string): void {
    // 确保 name 不带 / 前缀（统一格式）
    const normalizedName = name.startsWith('/') ? name.slice(1) : name;
    localStorage.removeItem(`file:${normalizedName}`);
    const files = this.getLocalStorageFiles().filter(f => f.name !== normalizedName && f.name !== name);
    this.saveLocalStorageFiles(files);
  }
  
  isUsingLocalStorage(): boolean {
    return this.useLocalStorage;
  }

  // Version history methods
  getFileVersions(fileName: string): FileVersion[] {
    const normalizedName = fileName.startsWith('/') ? fileName.slice(1) : fileName;
    const key = `file:${normalizedName}:versions`;
    const versionsJson = localStorage.getItem(key);
    console.log('getFileVersions:', fileName, 'key:', key, 'found:', !!versionsJson);
    if (!versionsJson) return [];
    try {
      const versions = JSON.parse(versionsJson) as FileVersion[];
      console.log('getFileVersions: loaded', versions.length, 'versions');
      return versions;
    } catch {
      return [];
    }
  }

  saveFileVersions(fileName: string, versions: FileVersion[]): void {
    const normalizedName = fileName.startsWith('/') ? fileName.slice(1) : fileName;
    const key = `file:${normalizedName}:versions`;
    // 限制最多保存 20 个版本
    const limitedVersions = versions.slice(-20);
    localStorage.setItem(key, JSON.stringify(limitedVersions));
    console.log('saveFileVersions:', fileName, 'key:', key, 'saved:', limitedVersions.length, 'versions');
  }

  deleteFileVersions(fileName: string): void {
    const normalizedName = fileName.startsWith('/') ? fileName.slice(1) : fileName;
    localStorage.removeItem(`file:${normalizedName}:versions`);
  }

  setLocalStorageMode(enabled: boolean): void {
    this.useLocalStorage = enabled;
  }

  setCurrentFolderHandle(handle: FileSystemDirectoryHandle): void {
    this.currentFolderHandle = handle;
  }

  getCurrentFolderHandle(): FileSystemDirectoryHandle | null {
    return this.currentFolderHandle;
  }

  async loadFileTree(handle: FileSystemDirectoryHandle, path: string = ''): Promise<FileItem[]> {
    // Electron mode: use IPC
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const dirPath = path ? `${this.currentFolderPath}/${path}` : this.currentFolderPath;
      try {
        const entries = await window.electronAPI.readDirectory(dirPath);
        const items: FileItem[] = [];
        for (const entry of entries) {
          // Exclude hidden/version directories and non-markdown files
          if (entry.name.startsWith('.') || (!entry.isDirectory && !entry.name.endsWith('.md') && !entry.name.endsWith('.markdown'))) {
            continue;
          }
          const itemPath = path ? `${path}/${entry.name}` : entry.name;
          if (entry.isDirectory) {
            const children = await this.loadFileTree(handle, itemPath);
            items.push({ name: entry.name, path: itemPath, isDirectory: true, children, expanded: false });
          } else {
            items.push({ name: entry.name, path: itemPath, isDirectory: false });
          }
        }
        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        return items;
      } catch (err) {
        logError('loadFileTree.electron', err);
        return [];
      }
    }

    // Browser mode: use File System Access API
    const items: FileItem[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iterator = (handle as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
      for await (const entry of iterator) {
        const entryName = entry[0] as string;
        const entryHandle = entry[1] as FileSystemHandle;
        const isDir = entryHandle.kind === 'directory';
        if (isDir || (entryName.endsWith('.md') || entryName.endsWith('.markdown')) && !entryName.includes('history')) {
          const itemPath = path ? `${path}/${entryName}` : entryName;
          if (isDir) {
            const children = await this.loadFileTree(entryHandle as FileSystemDirectoryHandle, itemPath);
            items.push({ name: entryName, path: itemPath, isDirectory: true, children, expanded: false });
          } else {
            items.push({ name: entryName, path: itemPath, isDirectory: false });
          }
        }
      }
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      logError('loadFileTree.browser', err);
    }
    return items;
  }

  async readFile(filePath: string): Promise<string> {
    if (!filePath) throw new Error('Path is required');

    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const fullPath = `${this.currentFolderPath}/${filePath}`;
      const content = await window.electronAPI.readFile(fullPath);
      if (content === null) throw new Error(`Failed to read file: ${filePath}`);
      return content;
    }

    // Browser mode
    const folderHandle = this.currentFolderHandle;
    if (!folderHandle) throw new Error('No folder selected');
    try {
      const parts = filePath.split('/');
      let currentHandle = folderHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (err) {
      logError('readFile', err);
      throw err;
    }
  }

  async writeFile(handle: FileSystemFileHandle, content: string): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async saveFile(filePath: string, content: string): Promise<void> {
    if (this.useLocalStorage) {
      const normalizedName = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      localStorage.setItem(`file:${normalizedName}`, content);
      localStorage.setItem(`file:${normalizedName}:modified`, new Date().toISOString());
      console.log('saveFile: saved to localStorage, key:', `file:${normalizedName}`, 'length:', content.length);
      return;
    }
    await this.writeFileByPath(filePath, content);
  }

  async writeFileByPath(filePath: string, content: string): Promise<void> {
    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const fullPath = `${this.currentFolderPath}/${filePath}`;
      const success = await window.electronAPI.writeFile(fullPath, content);
      if (!success) throw new Error(`Failed to write file: ${filePath}`);
      return;
    }

    // Browser mode
    const folderHandle = this.currentFolderHandle;
    if (!folderHandle) throw new Error('No folder selected');
    const parts = filePath.split('/');
    let currentHandle = folderHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }



  async deleteFile(folderHandle: FileSystemDirectoryHandle | null, name: string): Promise<void> {
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const fullPath = `${this.currentFolderPath}/${name}`;
      await window.electronAPI.deleteFile(fullPath);
      return;
    }
    if (folderHandle) {
      await folderHandle.removeEntry(name);
    } else {
      throw new Error('No folder handle available');
    }
  }

  async renameFile(folderHandle: FileSystemDirectoryHandle, oldName: string, newName: string): Promise<void> {
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const oldPath = `${this.currentFolderPath}/${oldName}`;
      const newPath = `${this.currentFolderPath}/${newName}`;
      await window.electronAPI.renameFile(oldPath, newPath);
      return;
    }
    const oldHandle = await folderHandle.getFileHandle(oldName);
    const file = await oldHandle.getFile();
    const content = await file.text();
    const newHandle = await folderHandle.getFileHandle(newName);
    const writable = await newHandle.createWritable();
    await writable.write(content);
    await writable.close();
    await folderHandle.removeEntry(oldName);
  }



  async selectFile(): Promise<{ handle: FileSystemFileHandle; content: string } | null> {
    if (this.isElectron && window.electronAPI) {
      // Tauri mode: use file dialog to pick a single file
      try {
        const filePath = await window.electronAPI.showOpenFileDialog();
        if (filePath) {
          const content = await window.electronAPI.readFile(filePath);
          if (content !== null) {
            const name = filePath.split(/[/\\]/).pop() || filePath;
            return {
              handle: { name } as unknown as FileSystemFileHandle,
              content
            };
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          logError('selectFile.tauri', err);
        }
      }
      return null;
    }
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
          multiple: false
        });
        const file = await handle.getFile();
        const content = await file.text();
        return { handle, content };
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          logError('selectFile', err);
        }
        return null;
      }
    }
    return null;
  }

  // 版本历史功能
  private readonly MAX_VERSIONS = 10;

  async saveVersion(filePath: string, content: string, folderHandle?: FileSystemDirectoryHandle | null, versionId?: string): Promise<string | null> {
    // 统一使用传入的 versionId 或生成新的，确保内存和文件系统一致
    const timestamp = versionId || Date.now().toString();

    if (this.useLocalStorage) {
      const normalizedName = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      const versions = this.getFileVersions(normalizedName);
      const nowNum = parseInt(timestamp);
      const newVersion: FileVersion = {
        id: timestamp,
        timestamp: nowNum,
        date: new Date(nowNum).toISOString(),
        content: content,
        label: new Date(nowNum).toLocaleString('zh-CN')
      };
      versions.unshift(newVersion);
      if (versions.length > this.MAX_VERSIONS) {
        versions.pop();
      }
      this.saveFileVersions(normalizedName, versions);
      return timestamp;
    }

    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const safeName = filePath.replace(/[/\\]/g, '_');
      console.log('saveVersion Electron:', { folderPath: this.currentFolderPath, safeName, timestamp });
      try {
        const success = await window.electronAPI.saveVersion(this.currentFolderPath, safeName, timestamp, content);
        if (success) {
          console.log('saveVersion: saved via Electron IPC, timestamp:', timestamp);
          return timestamp;
        } else {
          logError('saveVersion.electron', new Error('IPC saveVersion returned false'));
          return null;
        }
      } catch (err) {
        logError('saveVersion.electron', err);
        return null;
      }
    }

    // Browser mode: File System Access API
    const handle = folderHandle || this.currentFolderHandle;
    if (!handle) {
      logError('saveVersion.browser', new Error('No folder handle'));
      return null;
    }
    try {
      console.log('saveVersion browser:', { filePath, safeName: filePath.replace(/[/\\]/g, '_'), timestamp, handleName: (handle as any).name });
      const versionsDir = await handle.getDirectoryHandle('.versions', { create: true });
      const safeName = filePath.replace(/[/\\]/g, '_');
      const fileVersionsDir = await versionsDir.getDirectoryHandle(safeName, { create: true });
      const versionFileName = `${timestamp}.md`;
      console.log('saveVersion: creating file:', versionFileName);
      const versionFile = await fileVersionsDir.getFileHandle(versionFileName, { create: true });
      const writable = await versionFile.createWritable();
      await writable.write(content);
      await writable.close();
      console.log('saveVersion: saved via File System Access API, timestamp:', timestamp);

      // Clean up old versions
      try {
        const oldVersions = await this.getVersionHistoryFromFS(filePath, folderHandle);
        if (oldVersions.length > this.MAX_VERSIONS) {
          for (let i = this.MAX_VERSIONS; i < oldVersions.length; i++) {
            try {
              await fileVersionsDir.removeEntry(`${oldVersions[i].version}.md`);
              console.log('saveVersion: removed old version:', oldVersions[i].version);
            } catch {
              // Ignore errors
            }
          }
        }
      } catch (cleanupErr) {
        console.log('saveVersion: cleanup error (non-critical):', cleanupErr);
      }
      return timestamp;
    } catch (err) {
      logError('saveVersion.browser', err);
      return null;
    }
  }

  async getVersionHistoryFromFS(filePath: string, folderHandle?: FileSystemDirectoryHandle | null): Promise<Array<{version: string; time: string; size: number}>> {
    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const safeName = filePath.replace(/[/\\]/g, '_');
      try {
        const versions = await window.electronAPI.getVersionHistory(this.currentFolderPath, safeName);
        console.log('getVersionHistoryFromFS: Electron returned', versions.length, 'versions');
        return versions;
      } catch (err) {
        logError('getVersionHistoryFromFS.electron', err);
        return [];
      }
    }

    // Browser mode
    const handle = folderHandle || this.currentFolderHandle;
    if (!handle) return [];
    try {
      const versionsDir = await handle.getDirectoryHandle('.versions');
      const safeName = filePath.replace(/[/\\]/g, '_');
      const fileVersionsDir = await versionsDir.getDirectoryHandle(safeName);
      const versions: Array<{version: string; time: string; size: number}> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iterator = (fileVersionsDir as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
      for await (const entry of iterator) {
        const name = entry[0];
        if (name.endsWith('.md')) {
          const version = name.replace('.md', '');
          versions.push({ version, time: new Date(parseInt(version)).toISOString(), size: 0 });
        }
      }
      versions.sort((a, b) => parseInt(b.version) - parseInt(a.version));
      return versions;
    } catch {
      return [];
    }
  }

  async getVersionContent(filePath: string, versionId: string, folderHandle?: FileSystemDirectoryHandle | null): Promise<string | null> {
    console.log('getVersionContent:', filePath, versionId);
    if (this.useLocalStorage) {
      const normalizedName = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      const versions = this.getFileVersions(normalizedName);
      const v = versions.find(ver => ver.id === versionId);
      return v?.content || null;
    }

    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const safeName = filePath.replace(/[/\\]/g, '_');
      try {
        const content = await window.electronAPI.getVersionContent(this.currentFolderPath, safeName, versionId);
        console.log('getVersionContent: Electron returned content length:', content?.length);
        return content;
      } catch (err) {
        logError('getVersionContent.electron', err);
        return null;
      }
    }

    // Browser mode
    const handle = folderHandle || this.currentFolderHandle;
    if (!handle) {
      logError('getVersionContent.browser', new Error('No folder handle'));
      return null;
    }
    try {
      const versionsDir = await handle.getDirectoryHandle('.versions');
      const safeName = filePath.replace(/[/\\]/g, '_');
      const fileVersionsDir = await versionsDir.getDirectoryHandle(safeName);
      const versionFileName = `${versionId}.md`;
      const versionFile = await fileVersionsDir.getFileHandle(versionFileName);
      const file = await versionFile.getFile();
      return await file.text();
    } catch (err) {
      logError('getVersionContent.browser', err);
      return null;
    }
  }

  async deleteVersion(filePath: string, versionId: string, folderHandle?: FileSystemDirectoryHandle | null): Promise<boolean> {
    console.log('deleteVersion:', filePath, versionId);
    if (this.useLocalStorage) {
      const normalizedName = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      const versions = this.getFileVersions(normalizedName);
      const filtered = versions.filter(v => v.id !== versionId);
      if (filtered.length === versions.length) {
        console.log('deleteVersion: version not found');
        return false;
      }
      this.saveFileVersions(normalizedName, filtered);
      console.log('deleteVersion: deleted from localStorage');
      return true;
    }

    // Electron mode
    if (this.isElectron && this.currentFolderPath && window.electronAPI) {
      const safeName = filePath.replace(/[/\\]/g, '_');
      try {
        const success = await window.electronAPI.deleteVersionFile(this.currentFolderPath, safeName, versionId);
        console.log('deleteVersion: Electron returned', success);
        return success;
      } catch (err) {
        logError('deleteVersion.electron', err);
        return false;
      }
    }

    // Browser mode
    const handle = folderHandle || this.currentFolderHandle;
    if (!handle) {
      logError('deleteVersion.browser', new Error('No folder handle'));
      return false;
    }
    try {
      const versionsDir = await handle.getDirectoryHandle('.versions');
      const safeName = filePath.replace(/[/\\]/g, '_');
      const fileVersionsDir = await versionsDir.getDirectoryHandle(safeName);
      await fileVersionsDir.removeEntry(`${versionId}.md`);
      console.log('deleteVersion: deleted from file system');
      return true;
    } catch (err) {
      logError('deleteVersion.browser', err);
      return false;
    }
  }
}

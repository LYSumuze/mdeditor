// Tauri API Bridge
// Replaces all window.electronAPI calls with Tauri invoke calls

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

// Detect if running in Tauri
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ============ File Operations ============

export async function showOpenDialog(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择文件夹',
    });
    return selected as string | null;
  } catch (e) {
    console.error('showOpenDialog error:', e);
    return null;
  }
}

export async function showOpenFileDialog(): Promise<string | null> {
  try {
    const selected = await open({
      directory: false,
      multiple: false,
      title: '打开文件',
      filters: [{
        name: 'Markdown',
        extensions: ['md', 'markdown'],
      }],
    });
    return selected as string | null;
  } catch (e) {
    console.error('showOpenFileDialog error:', e);
    return null;
  }
}

export async function showSaveFileDialog(defaultName: string): Promise<string | null> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      defaultPath: defaultName,
      filters: [{
        name: 'Markdown',
        extensions: ['md'],
      }],
    });
    return selected as string | null;
  } catch (e) {
    console.error('showSaveFileDialog error:', e);
    return null;
  }
}

export async function readDirectory(dirPath: string): Promise<{ name: string; isDirectory: boolean; path: string }[]> {
  return await invoke<{ name: string; isDirectory: boolean; path: string }[]>('read_directory', { dirPath });
}

export async function readFile(filePath: string): Promise<string | null> {
  return await invoke<string | null>('read_file_content', { filePath });
}

export async function writeFile(filePath: string, content: string): Promise<boolean> {
  return await invoke<boolean>('write_file_content', { filePath, content });
}

export async function deleteFile(filePath: string): Promise<boolean> {
  return await invoke<boolean>('delete_file_cmd', { filePath });
}

export async function renameFile(oldPath: string, newPath: string): Promise<boolean> {
  return await invoke<boolean>('rename_file_cmd', { oldPath, newPath });
}

export async function deleteDirectory(dirPath: string): Promise<boolean> {
  return await invoke<boolean>('delete_directory_cmd', { dirPath });
}

// ============ Version History ============

export async function saveVersion(folderPath: string, fileName: string, versionId: string, content: string): Promise<boolean> {
  return await invoke<boolean>('save_version', { folderPath, fileName, versionId, content });
}

export async function getVersionHistory(folderPath: string, fileName: string): Promise<{ version: string; time: string; size: number }[]> {
  return await invoke<{ version: string; time: string; size: number }[]>('get_version_history', { folderPath, fileName });
}

export async function getVersionContent(folderPath: string, fileName: string, versionId: string): Promise<string | null> {
  return await invoke<string | null>('get_version_content', { folderPath, fileName, versionId });
}

export async function deleteVersionFile(folderPath: string, fileName: string, versionId: string): Promise<boolean> {
  return await invoke<boolean>('delete_version_file', { folderPath, fileName, versionId });
}

// ============ Error Log ============

export async function writeErrorLog(logContent: string): Promise<string | null> {
  return await invoke<string | null>('write_error_log', { logContent });
}

// ============ Menu Events ============

type MenuCallback = () => void;

export async function onMenuOpenFolder(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'open_folder') callback();
  }).then(unlisten => () => unlisten());
}

export async function onMenuSave(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'save') callback();
  }).then(unlisten => () => unlisten());
}

export async function onMenuUndo(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'undo') callback();
  }).then(unlisten => () => unlisten());
}

export async function onMenuRedo(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'redo') callback();
  }).then(unlisten => () => unlisten());
}

export async function onMenuFind(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'find') callback();
  }).then(unlisten => () => unlisten());
}

export async function onExportLogs(callback: MenuCallback): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    if (event.payload === 'export_logs') callback();
  }).then(unlisten => () => unlisten());
}

// ============ Window Control ============

export async function closeWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().destroy();
  } catch (e) {
    console.error('closeWindow error:', e);
  }
}

// ============ Close Request Listener ============

export async function onCloseRequested(callback: () => void): Promise<() => void> {
  return listen('close-requested', () => {
    callback();
  }).then(unlisten => () => unlisten());
}

// ============ Compatibility: Set up window.electronAPI shim ============

// This function patches window.electronAPI so existing code works without changes
export async function setupTauriShim(): Promise<void> {
  if (!isTauri()) return;

  // Create the shim that maps electronAPI calls to Tauri invoke
  const shim = {
    showOpenDialog,
    showOpenFileDialog,
    showSaveFileDialog,
    readDirectory,
    readFile,
    writeFile,
    deleteFile,
    renameFile,
    deleteDirectory: deleteDirectory,
    saveVersion,
    getVersionHistory,
    getVersionContent,
    deleteVersionFile,
    writeErrorLog,
    onMenuOpenFolder,
    onMenuSave,
    onMenuUndo,
    onMenuRedo,
    onMenuFind,
    onCheckUnsaved: (callback: () => void) => {
      return onCloseRequested(callback);
    },
    sendUnsavedResponse: (_hasUnsaved: boolean) => {
      // In Tauri, the close is handled differently - we just destroy the window
    },
    closeWindow,
  };

  (window as any).electronAPI = shim;
  console.log('Tauri API shim installed');
}

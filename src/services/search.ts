// 全文搜索服务
import Fuse from 'fuse.js';
import type { FileSystemAccessService } from './fileSystem';

interface IndexedFile {
  name: string;
  path: string;
  content: string;
  lines: string[];
}

export interface SearchMatch {
  context: string;
}

export interface SearchResult {
  name: string;
  path: string;
  matches: SearchMatch[];
}

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
}

export class SearchService {
  private files: Map<string, IndexedFile> = new Map();
  private fuse: Fuse<IndexedFile> | null = null;
  
  private readonly fuseOptions = {
    keys: [
      { name: 'name', weight: 0.3 },
      { name: 'content', weight: 0.7 }
    ],
    includeMatches: true,
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2
  };

  indexFile(file: { name: string; path: string; content: string }): void {
    const lines = file.content.split('\n');
    
    this.files.set(file.path, {
      name: file.name,
      path: file.path,
      content: file.content,
      lines
    });
    
    this.rebuildIndex();
  }

  clearIndex(): void {
    this.files.clear();
    this.rebuildIndex();
  }

  removeFile(path: string): void {
    this.files.delete(path);
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    const files = Array.from(this.files.values());
    this.fuse = new Fuse(files, this.fuseOptions);
  }

  async search(query: string, _fileTree?: FileItem[], _fileService?: FileSystemAccessService | null): Promise<SearchResult[]> {
    // Parameters reserved for future content search implementation
    void _fileTree;
    void _fileService;
    
    if (!query.trim() || !this.fuse) {
      return [];
    }

    const results = this.fuse.search(query);
    const searchResults: SearchResult[] = [];

    for (const result of results) {
      const file = result.item;
      const filePath = file.path;
      const fileName = file.name;
      
      // 收集所有匹配
      const matches: SearchMatch[] = [];
      const resultMatches = result.matches || [];
      
      for (const match of resultMatches) {
        if (match.key === 'content' && match.indices) {
          const indices = match.indices;
          
          // 提取匹配行上下文
          void indices; // Indices used for match highlighting
          const matchIndex = (match as { index?: number }).index ?? 0;
          const charCountBeforeMatch = file.content.substring(0, matchIndex).split('\n').length - 1;
          const lineContent = file.lines[charCountBeforeMatch] || '';
          
          matches.push({
            context: lineContent.trim()
          });
        }
      }
      
      if (matches.length > 0) {
        searchResults.push({
          name: fileName,
          path: filePath,
          matches
        });
      }
    }

    return searchResults.slice(0, 50);
  }

  getIndexedFiles(): string[] {
    return Array.from(this.files.keys());
  }

  clear(): void {
    this.files.clear();
    this.fuse = null;
  }
}

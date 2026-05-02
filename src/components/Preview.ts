// Markdown 预览组件
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

export interface PreviewOptions {
  content: string;
  theme: 'light' | 'dark';
}

class PreviewComponent {
  private container: HTMLElement | null = null;

  async render(container: HTMLElement, options: PreviewOptions): Promise<void> {
    this.container = container;
    
    const html = await this.renderMarkdown(options.content);
    
    container.innerHTML = `
      <div class="markdown-preview" style="color: ${options.theme === 'dark' ? '#c0caf5' : '#1a202c'}">
        ${html}
      </div>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
      <style>
        .katex { font-size: 1.1em; }
        .katex-display { margin: 1em 0; }
      </style>
    `;
  }

  private async renderMarkdown(content: string): Promise<string> {
    try {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex)
        .use(rehypeStringify, { allowDangerousHtml: true });
      
      const result = await processor.process(content);
      return String(result);
    } catch (error) {
      console.error('Markdown render error:', error);
      return `<pre>${this.escapeHtml(content)}</pre>`;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async updateContent(content: string): Promise<void> {
    if (!this.container) return;
    
    const html = await this.renderMarkdown(content);
    const previewEl = this.container.querySelector('.markdown-preview');
    if (previewEl) {
      previewEl.innerHTML = html;
    }
  }
}

export const preview = new PreviewComponent();

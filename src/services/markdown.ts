/* eslint-disable @typescript-eslint/no-explicit-any */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';

export class MarkdownService {

  private processor: any;

  constructor() {
    this.processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkBreaks)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeStringify, { allowDangerousHtml: true })
      // Custom plugin to add IDs to headings and handle links/images
      .use(() => (tree: any) => {
        visit(tree, 'element', (node: any) => {
          if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
            const text = this.getTextContent(node);
            const id = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
            node.properties = node.properties || {};
            node.properties.id = id;
          }
          // Add target="_blank" and rel="noopener noreferrer" to all links
          if (node.tagName === 'a') {
            node.properties = node.properties || {};
            node.properties.target = '_blank';
            node.properties.rel = 'noopener noreferrer';
          }
          // Ensure images have proper attributes
          if (node.tagName === 'img') {
            node.properties = node.properties || {};
            // Add loading="lazy" for better performance
            node.properties.loading = 'lazy';
            // Add referrerpolicy to bypass some hotlink protection
            node.properties.referrerpolicy = 'no-referrer';
            // Add error handling - show placeholder on error
            node.properties.onerror = 'this.onerror=null;this.src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%27%23ddd%27 width=%27100%27 height=%27100%27/%3E%3Ctext fill=%27%23999%27 x=%2750%27 y=%2750%27 text-anchor=%27middle%27 dy=%27.3em%27%3E图片加载失败%3C/text%3E%3C/svg%3E"';
          }
        });
      });
  }
  
   
  private getTextContent(node: any): string {
    if (node.type === 'text') return node.value;
    if (node.children) {
       
      return node.children.map((c: any) => this.getTextContent(c)).join('');
    }
    return '';
  }
  
  private renderFrontmatter(yamlText: string): string {
    const lines = yamlText.split('\n').filter((l) => l.trim());
    const rows = lines.map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return null;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      return { key, value };
    }).filter(Boolean) as Array<{ key: string; value: string }>;
    if (rows.length === 0) return '';
    const rowsHtml = rows.map((row) =>
      `<tr><td class="frontmatter-key">${this.escapeHtml(row.key)}</td><td class="frontmatter-value">${this.escapeHtml(row.value)}</td></tr>`
    ).join('');
    return `<div class="frontmatter-block"><table class="frontmatter-table"><tbody>${rowsHtml}</tbody></table></div>`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async render(markdown: string): Promise<string> {
    try {
      // Extract frontmatter before processing
      const fmMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
      let frontmatterHtml = '';
      let body = markdown;
      if (fmMatch) {
        frontmatterHtml = this.renderFrontmatter(fmMatch[1]);
        body = markdown.slice(fmMatch[0].length);
      }
      const result = await this.processor.process(body);
      return frontmatterHtml + String(result);
    } catch (err) {
      console.error('Markdown render error:', err);
      return `<pre>${markdown}</pre>`;
    }
  }
  
  async renderInline(text: string): Promise<string> {
    try {
      const result = await this.processor.process(text);
      return String(result).trim();
    } catch {
      return text;
    }
  }
  
  // Test method to verify image rendering
  async testImageRender(): Promise<void> {
    const testMarkdown = `![测试图片](https://via.placeholder.com/150)`;
    const html = await this.render(testMarkdown);
    console.log('[MarkdownService] Image test result:', html);
    const hasImg = html.includes('<img');
    console.log('[MarkdownService] Contains img tag:', hasImg);
  }
}

// Initialize markdown renderer
export async function initMarkdownRenderer(): Promise<(markdown: string) => Promise<string>> {
  const service = new MarkdownService();
  // Test image rendering
  await service.testImageRender();
  return (markdown: string) => service.render(markdown);
}

// Sync export
export const renderMarkdown = async (markdown: string): Promise<string> => {
  const renderer = await initMarkdownRenderer();
  return renderer(markdown);
};

// 同步面板组件
export interface SyncPanelState {
  connected: boolean;
  syncing: boolean;
  error: string | null;
}

class SyncPanelComponent {
  private state: SyncPanelState = {
    connected: false,
    syncing: false,
    error: null
  };

  render(container: HTMLElement): void {
    container.innerHTML = this.getHTML();
    this.bindEvents();
  }

  private getHTML(): string {
    return `
      <div class="sync-panel">
        <div class="sync-status-card">
          <div class="status-row">
            <span class="status-indicator large ${this.state.connected ? 'connected' : 'disconnected'}"></span>
            <div class="status-info">
              <strong>${this.state.connected ? '已连接 Syncthing' : '未连接'}</strong>
              ${this.state.error ? `<p class="error-text">${this.state.error}</p>` : ''}
            </div>
          </div>
        </div>
        
        <div class="sync-actions">
          <button class="btn btn-primary" id="btn-sync-connect">
            ${this.state.connected ? '重新连接' : '连接'}
          </button>
          ${this.state.connected ? `
            <button class="btn btn-secondary" id="btn-sync-refresh">
              刷新状态
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    document.getElementById('btn-sync-connect')?.addEventListener('click', () => {
      // 触发连接
    });
    
    document.getElementById('btn-sync-refresh')?.addEventListener('click', () => {
      // 刷新状态
    });
  }

  update(state: Partial<SyncPanelState>): void {
    this.state = { ...this.state, ...state };
  }
}

export const syncPanel = new SyncPanelComponent();

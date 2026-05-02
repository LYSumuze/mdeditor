// P2P Sync Service - 纯 WebRTC P2P 同步引擎
// 不需要任何外部软件，所有同步都在浏览器内完成

export interface PeerDevice {
  id: string;
  name: string;
  lastSeen: number;
  connected: boolean;
}

export interface SyncFile {
  name: string;
  path: string;
  content: string;
  lastModified: number;
  version: number;
  peerId: string;
}

export interface SyncMessage {
  type: 'file' | 'delete' | 'request' | 'response' | 'conflict' | 'ack';
  file?: {
    name: string;
    path: string;
    content: string;
    lastModified: number;
    version: number;
  };
  filename?: string;
  files?: SyncFile[];
  peerId?: string;
  peerName?: string;
  version?: number;
}

export interface SyncConflict {
  filename: string;
  localContent: string;
  remoteContent: string;
  localModified: number;
  remoteModified: number;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
  expanded?: boolean;
  content?: string;
  lastModified?: number;
  isDeleted?: boolean;
}

export type SyncStatus = 'disconnected' | 'connecting' | 'connected';

// 简化的 P2P 连接管理器
class P2PConnectionManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onMessageCallback: ((msg: SyncMessage) => void) | null = null;
  private onStatusChangeCallback: ((connected: boolean) => void) | null = null;
  private localId: string;
  private localName: string;
  private remotePeerId: string = '';
  
  private readonly rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  constructor(localId: string, localName: string) {
    this.localId = localId;
    this.localName = localName;
  }

  // 创建连接 offer（用于发起连接）
  async createOffer(): Promise<{ offer: RTCSessionDescriptionInit; candidate: RTCIceCandidateInit | null }> {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);
    this.setupConnection();

    // 创建数据通道
    this.dataChannel = this.peerConnection.createDataChannel('sync', {
      ordered: true
    });
    this.setupDataChannel();

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // 获取 ICE candidate
    let candidate: RTCIceCandidateInit | null = null;
    await new Promise<void>((resolve) => {
      const handler = (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate) {
          candidate = e.candidate.toJSON();
        } else {
          resolve();
        }
      };
      this.peerConnection!.addEventListener('icecandidate', handler);
      setTimeout(resolve, 3000); // 超时保护
    });

    return { offer: this.peerConnection.localDescription!.toJSON(), candidate };
  }

  // 处理接收到的 offer（用于接收连接）
  async handleOffer(offer: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit): Promise<{ answer: RTCSessionDescriptionInit; candidate: RTCIceCandidateInit | null }> {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);
    this.setupConnection();

    this.peerConnection.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.setupDataChannel();
    };

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    if (candidate) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    // 获取 ICE candidate
    let iceCandidate: RTCIceCandidateInit | null = null;
    await new Promise<void>((resolve) => {
      const handler = (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate) {
          iceCandidate = e.candidate.toJSON();
        } else {
          resolve();
        }
      };
      this.peerConnection!.addEventListener('icecandidate', handler);
      setTimeout(resolve, 3000);
    });

    return { answer: this.peerConnection.localDescription!.toJSON(), candidate: iceCandidate };
  }

  // 处理接收到的 answer
  async handleAnswer(answer: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('No peer connection established');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

    if (candidate) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  // 添加 ICE candidate
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  // 处理手动交换的 offer/answer
  async handleManualExchange(data: { offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<{ type: 'offer' | 'answer'; data: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } | null> {
    if (data.offer) {
      const result = await this.handleOffer(data.offer, data.candidate ?? undefined);
      return { type: 'answer', data: result.answer, candidate: result.candidate ?? undefined };
    } else if (data.answer) {
      await this.handleAnswer(data.answer, data.candidate ?? undefined);
      return null;
    }
    return null;
  }

  private setupConnection(): void {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = () => {
      // ICE candidates 会自动收集
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      const connected = state === 'connected';
      this.onStatusChangeCallback?.(connected);
    };
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.onStatusChangeCallback?.(true);
    };

    this.dataChannel.onclose = () => {
      this.onStatusChangeCallback?.(false);
    };

    this.dataChannel.onmessage = (e) => {
      try {
        const msg: SyncMessage = JSON.parse(e.data);
        this.onMessageCallback?.(msg);
      } catch (err) {
        console.error('Failed to parse sync message:', err);
      }
    };
  }

  // 发送消息
  send(msg: SyncMessage): boolean {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // 设置消息回调
  onMessage(callback: (msg: SyncMessage) => void): void {
    this.onMessageCallback = callback;
  }

  // 设置状态回调
  onStatusChange(callback: (connected: boolean) => void): void {
    this.onStatusChangeCallback = callback;
  }

  // 断开连接
  disconnect(): void {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.dataChannel = null;
    this.peerConnection = null;
  }

  isConnected(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  getRemotePeerId(): string {
    return this.remotePeerId;
  }

  setRemotePeerId(id: string): void {
    this.remotePeerId = id;
  }

  getLocalId(): string {
    return this.localId;
  }
}

// P2P 同步服务
export class P2PSyncService {
  private peerId: string;
  private peerName: string;
  private connections: Map<string, P2PConnectionManager> = new Map();
  private onFileSyncCallback: ((files: FileItem[]) => void) | null = null;
  private onStatusChangeCallback: ((peerId: string, connected: boolean) => void) | null = null;
  private onConflictCallback: ((conflict: SyncConflict) => void) | null = null;
  private pendingOffers: Map<string, { offer: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }> = new Map();

  constructor() {
    // 生成唯一 ID
    this.peerId = localStorage.getItem('p2p_peer_id') || this.generatePeerId();
    this.peerName = localStorage.getItem('p2p_peer_name') || `设备-${this.peerId.substring(0, 6)}`;
    localStorage.setItem('p2p_peer_id', this.peerId);
  }

  private generatePeerId(): string {
    return 'p2p_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  // 获取本设备 ID
  getPeerId(): string {
    return this.peerId;
  }

  // 设置设备名称
  setPeerName(name: string): void {
    this.peerName = name;
    localStorage.setItem('p2p_peer_name', name);
  }

  getPeerName(): string {
    return this.peerName;
  }

  // 获取连接状态
  getConnectedPeers(): string[] {
    const connected: string[] = [];
    this.connections.forEach((conn, peerId) => {
      if (conn.isConnected()) {
        connected.push(peerId);
      }
    });
    return connected;
  }

  // 发起连接
  async connectToPeer(remotePeerId: string, remoteData?: { offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<{ success: boolean; data?: { offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }> {
    if (this.connections.has(remotePeerId)) {
      return { success: true };
    }

    try {
      const conn = new P2PConnectionManager(this.peerId, this.peerName);
      conn.setRemotePeerId(remotePeerId);
      conn.onStatusChange((connected) => {
        this.onStatusChangeCallback?.(remotePeerId, connected);
      });

      this.connections.set(remotePeerId, conn);

      // 如果有远程数据，处理交换
      if (remoteData) {
        const result = await conn.handleManualExchange(remoteData);
        return { success: true, data: result || undefined };
      }

      // 创建新的 offer
      const { offer, candidate } = await conn.createOffer();
      return { success: true, data: { offer, candidate: candidate ?? undefined } };
    } catch (err) {
      console.error('Failed to connect to peer:', err);
      this.connections.delete(remotePeerId);
      return { success: false };
    }
  }

  // 完成连接（处理 answer）
  async completeConnection(remotePeerId: string, data: { offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<{ success: boolean; data?: unknown }> {
    let conn = this.connections.get(remotePeerId);

    if (!conn) {
      conn = new P2PConnectionManager(this.peerId, this.peerName);
      conn.setRemotePeerId(remotePeerId);
      conn.onStatusChange((connected) => {
        this.onStatusChangeCallback?.(remotePeerId, connected);
      });
      this.connections.set(remotePeerId, conn);
    }

    try {
      const result = await conn.handleManualExchange(data);
      return { success: true, data: result };
    } catch (err) {
      console.error('Failed to complete connection:', err);
      return { success: false };
    }
  }

  // 同步文件到所有已连接的设备
  syncFile(file: FileItem): void {
    const msg: SyncMessage = {
      type: 'file',
      file: {
        name: file.name,
        path: file.path,
        content: file.content || '',
        lastModified: file.lastModified ?? Date.now(),
        version: Date.now()
      },
      peerId: this.peerId,
      peerName: this.peerName
    };

    this.connections.forEach((conn) => {
      if (conn.isConnected()) {
        conn.send(msg);
      }
    });
  }

  // 删除文件
  deleteFile(filename: string): void {
    const msg: SyncMessage = {
      type: 'delete',
      filename,
      peerId: this.peerId
    };

    this.connections.forEach((conn) => {
      if (conn.isConnected()) {
        conn.send(msg);
      }
    });
  }

  // 请求同步所有文件
  requestSync(): void {
    const msg: SyncMessage = {
      type: 'request',
      peerId: this.peerId,
      peerName: this.peerName
    };

    this.connections.forEach((conn) => {
      if (conn.isConnected()) {
        conn.send(msg);
      }
    });
  }

  // 响应同步请求
  respondSync(files: FileItem[]): void {
    const now = Date.now();
    const msg: SyncMessage = {
      type: 'response',
      files: files.map(f => ({
        name: f.name,
        path: f.path,
        content: f.content || '',
        lastModified: f.lastModified ?? now,
        version: f.lastModified ?? now,
        peerId: this.peerId
      })),
      peerId: this.peerId,
      peerName: this.peerName
    };

    this.connections.forEach((conn) => {
      if (conn.isConnected()) {
        conn.send(msg);
      }
    });
  }

  // 设置文件同步回调
  onFileSync(callback: (files: FileItem[]) => void): void {
    this.onFileSyncCallback = callback;
  }

  // 设置状态变化回调
  onStatusChange(callback: (peerId: string, connected: boolean) => void): void {
    this.onStatusChangeCallback = callback;
  }

  // 设置冲突回调
  onConflict(callback: (conflict: SyncConflict) => void): void {
    this.onConflictCallback = callback;
  }

  // 断开所有连接
  disconnectAll(): void {
    this.connections.forEach((conn) => conn.disconnect());
    this.connections.clear();
  }

  // 断开指定连接
  disconnect(peerId: string): void {
    this.connections.get(peerId)?.disconnect();
    this.connections.delete(peerId);
  }

  // 获取连接信息
  getConnectionInfo(peerId: string): { connected: boolean; localId: string } | null {
    const conn = this.connections.get(peerId);
    if (!conn) return null;
    return {
      connected: conn.isConnected(),
      localId: conn.getLocalId()
    };
  }

  // 设置消息处理
  setMessageHandler(peerId: string, handler: (msg: SyncMessage) => void): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.onMessage(handler);
    }
  }

  // 初始化连接的消息处理
  private initMessageHandler(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    conn.onMessage((msg) => {
      this.handleMessage(peerId, msg);
    });
  }

  // 处理接收到的消息
  private handleMessage(peerId: string, msg: SyncMessage): void {
    switch (msg.type) {
      case 'file':
        // 处理文件更新
        if (msg.file) {
          const fileItem: FileItem = {
            name: msg.file.name,
            path: msg.file.path,
            lastModified: msg.file.lastModified,
            content: msg.file.content,
            isDirectory: false
          };
          this.onFileSyncCallback?.([fileItem]);
        }
        break;

      case 'delete':
        // 处理文件删除
        if (msg.filename) {
          this.onFileSyncCallback?.([{ name: msg.filename, path: '', lastModified: 0, isDeleted: true, isDirectory: false }]);
        }
        break;

      case 'request':
        // 对方请求同步，响应所有文件
        this.requestSync();
        break;

      case 'response':
        // 处理文件列表响应
        if (msg.files) {
          const fileItems: FileItem[] = msg.files.map(f => ({
            name: f.name,
            path: f.path,
            lastModified: f.lastModified,
            content: f.content,
            isDirectory: false
          }));
          this.onFileSyncCallback?.(fileItems);
        }
        break;

      case 'conflict':
        // 处理冲突
        if (msg.file && msg.peerId) {
          this.onConflictCallback?.({
            filename: msg.file.name,
            localContent: '',
            remoteContent: msg.file.content,
            localModified: 0,
            remoteModified: msg.file.lastModified
          });
        }
        break;

      case 'ack':
        // 确认收到
        break;
    }
  }
}

// 导出单例
export const p2pSync = new P2PSyncService();

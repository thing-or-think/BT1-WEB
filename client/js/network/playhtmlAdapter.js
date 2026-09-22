/**
 * PlayhtmlAdapter (Serverless P2P Real-Time Engine):
 * Kết hợp WebRTC DataChannel (PeerJS) và BroadcastChannel cho phép kết nối thời gian thực
 * giữa 2 MÁY KHÁC NHAU trên toàn cầu mà KHÔNG CẦN backend server!
 */
class PlayhtmlAdapter {
  constructor() {
    this.roomId = null;
    this.clientId = 'client_' + Math.random().toString(36).substring(2, 9);
    this.playerName = 'Người chơi';
    this.role = null;      // 'HOST' | 'GUEST' | 'SPECTATOR'
    this.mySide = null;    // 'RED' | 'BLUE' | null
    this.isInitialized = false;
    this.eventListeners = new Map();
    this.roomState = null;
    this.storageKey = null;

    // WebRTC PeerJS & BroadcastChannel
    this.peer = null;
    this.hostConnection = null;       // Dành cho Guest/Spectator nối tới Host
    this.guestConnections = new Map(); // Dành cho Host quản lý các client kết nối tới
    this.broadcastChannel = null;
    this.peerPrefix = 'ottv2_match_';
  }

  /**
   * Khởi tạo và tham gia vào phòng chơi Serverless đa máy
   * @param {string} roomId - Mã phòng (VD: ott-1234)
   * @param {string} playerName - Tên người chơi
   * @param {boolean} isHost - Người tạo phòng (true) hay Người tham gia (false)
   * @param {Object} [options] - Cấu hình phòng
   */
  async init(roomId, playerName, isHost = false, options = {}) {
    this.roomId = roomId.trim().toLowerCase();
    this.playerName = playerName || (isHost ? 'Chủ phòng' : 'Người chơi');
    this.storageKey = `ottv2_room_state_${this.roomId}`;

    // 1. Khởi tạo BroadcastChannel (cho cùng máy / đa tab)
    this._initBroadcastChannel();

    // 2. Khởi tạo WebRTC PeerJS (cho 2 máy khác nhau qua Internet)
    if (isHost) {
      await this._initAsHost(options);
    } else {
      await this._initAsGuest();
    }

    this.isInitialized = true;
    return {
      roomId: this.roomId,
      role: this.role,
      mySide: this.mySide,
      roomState: this.roomState
    };
  }

  // --- 1. KHỞI TẠO VAI TRÒ CHỦ PHÒNG (HOST - PHE ĐỎ) ---
  async _initAsHost(options = {}) {
    this.role = 'HOST';
    this.mySide = 'RED';

    this.roomState = {
      roomId: this.roomId,
      roomName: options.roomName || `Phòng #${this.roomId.slice(-4).toUpperCase()}`,
      timePerTurn: parseInt(options.timePerTurn, 10) || 30,
      status: 'WAITING', // 'WAITING' | 'PLAYING' | 'FINISHED'
      hostId: this.clientId,
      hostName: this.playerName,
      guestId: null,
      guestName: null,
      spectators: [],
      board: options.initialBoard || [],
      currentTurn: 'RED',
      turnStartTime: Date.now(),
      createdAt: Date.now(),
      gameStartedAt: null,
      finishedAt: null,
      lastMove: null,
      moveHistory: [],
      scores: { red: 0, blue: 0 },
      rematchVotes: [],
      version: 1,
      updatedAt: Date.now()
    };

    this._saveLocalState();
    this._publishRoomBeacon();
    this._startHeartbeat();
    this._trigger('room:ready', {
      roomId: this.roomId,
      role: this.role,
      mySide: this.mySide,
      roomState: this.roomState,
      shareUrl: this.getShareUrl()
    });

    // Khởi tạo PeerJS với ID cố định theo mã phòng
    if (typeof Peer !== 'undefined') {
      try {
        if (this.peer) this.peer.destroy();
        const targetPeerId = this.peerPrefix + this.roomId;
        this.peer = new Peer(targetPeerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          console.log('✅ WebRTC Host Ready! Peer ID:', id);
          this._trigger('network:status', { status: 'ONLINE_HOST', peerId: id });
        });

        this.peer.on('connection', (conn) => {
          console.log('🔗 Client connected to Host:', conn.peer);
          this._handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.warn('Host Peer warning:', err.type, err);
          if (err.type === 'unavailable-id') {
            // Phòng đã có host trước đó -> Tự động chuyển sang Guest
            console.log('Room already hosted, connecting as Guest...');
            this._initAsGuest();
          }
        });
      } catch (e) {
        console.warn('PeerJS init failed (falling back to local channel):', e);
      }
    }
  }

  // --- 2. KHỞI TẠO VAI TRÒ KHÁCH (GUEST / SPECTATOR) ---
  async _initAsGuest() {
    this.role = 'GUEST';
    this.mySide = 'BLUE';

    // Tạo state tạm thời trong lúc chờ kết nối với Host
    const local = this._loadLocalState();
    const fallbackTimePerTurn = 30;
    this.roomState = local || {
      roomId: this.roomId,
      roomName: `Phòng #${this.roomId.slice(-4).toUpperCase()}`,
      timePerTurn: fallbackTimePerTurn,
      status: 'WAITING',
      hostId: null,
      hostName: 'Chủ phòng',
      guestId: this.clientId,
      guestName: this.playerName,
      spectators: [],
      board: [],
      currentTurn: 'RED',
      turnStartTime: Date.now(),
      lastMove: null,
      moveHistory: [],
      scores: { red: 0, blue: 0 },
      rematchVotes: [],
      version: 1,
      updatedAt: Date.now()
    };

    if (this.roomState && Number(this.roomState.timePerTurn) <= 0) {
      this.roomState.timePerTurn = fallbackTimePerTurn;
    }

    // Khởi tạo PeerJS kết nối tới Host
    if (typeof Peer !== 'undefined') {
      try {
        if (this.peer) this.peer.destroy();
        this.peer = new Peer({
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        this.peer.on('open', (myPeerId) => {
          console.log('✅ WebRTC Guest Ready! My ID:', myPeerId);
          const targetHostId = this.peerPrefix + this.roomId;
          const conn = this.peer.connect(targetHostId, { reliable: true });
          this.hostConnection = conn;

          conn.on('open', () => {
            console.log('🔗 Connected to Host successfully!');
            this._trigger('network:status', { status: 'CONNECTED_TO_HOST' });
            // Gửi yêu cầu gia nhập
            conn.send({
              type: 'CLIENT_JOIN',
              clientId: this.clientId,
              playerName: this.playerName
            });
          });

          conn.on('data', (packet) => {
            this._handleIncomingPacket(packet);
          });

          conn.on('close', () => {
            console.warn('Disconnected from Host');
            this._trigger('network:status', { status: 'HOST_DISCONNECTED' });
          });
        });

        this.peer.on('error', (err) => {
          console.warn('Guest Peer error:', err);
        });
      } catch (e) {
        console.warn('PeerJS Guest connect error:', e);
      }
    }

    // Gửi thông báo gia nhập qua BroadcastChannel (cho đa tab cùng máy)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'CLIENT_JOIN',
          clientId: this.clientId,
          playerName: this.playerName
        });
      } catch (e) {}
    }

    this._trigger('room:ready', {
      roomId: this.roomId,
      role: this.role,
      mySide: this.mySide,
      roomState: this.roomState,
      shareUrl: this.getShareUrl()
    });
  }

  // --- 3. XỬ LÝ KẾT NỐI VÀ GÓI TIN ĐẾN ---
  _handleIncomingConnection(conn) {
    this.guestConnections.set(conn.peer, conn);

    conn.on('open', () => {
      // Gửi trạng thái hiện tại của phòng cho client mới
      conn.send({
        type: 'SYNC_STATE',
        state: this.roomState
      });
    });

    conn.on('data', (packet) => {
      if (!packet) return;

      if (packet.type === 'CLIENT_JOIN') {
        // Có người mới vào phòng
        if (!this.roomState.guestId || this.roomState.guestId === packet.clientId) {
          this.roomState.guestId = packet.clientId;
          this.roomState.guestName = packet.playerName;
          this.roomState.status = 'PLAYING';
          this.roomState.gameStartedAt = this.roomState.gameStartedAt || Date.now();
          this.roomState.turnStartTime = Date.now();
        } else {
          if (!this.roomState.spectators.some(s => s.id === packet.clientId)) {
            this.roomState.spectators.push({ id: packet.clientId, name: packet.playerName });
          }
        }
        this.syncState(this.roomState);
      } else if (packet.type === 'SYNC_STATE') {
        this._handleIncomingState(packet.state);
        // Chuyển tiếp tới các client khác nếu là Host
        this._broadcastToOtherGuests(packet, conn.peer);
      } else if (packet.type === 'CHAT_MSG') {
        this._trigger('chat:receive', packet.chat);
        this._broadcastToOtherGuests(packet, conn.peer);
      }
    });

    conn.on('close', () => {
      this.guestConnections.delete(conn.peer);
      console.log('Client disconnected:', conn.peer);
    });
  }

  _handleIncomingPacket(packet) {
    if (!packet) return;
    if (packet.type === 'SYNC_STATE') {
      this._handleIncomingState(packet.state);
    } else if (packet.type === 'CHAT_MSG') {
      this._trigger('chat:receive', packet.chat);
    }
  }

  _broadcastToOtherGuests(packet, excludePeerId) {
    for (const [peerId, conn] of this.guestConnections.entries()) {
      if (peerId !== excludePeerId && conn.open) {
        try {
          conn.send(packet);
        } catch (e) {}
      }
    }
  }

  // --- 4. ĐỒNG BỘ TRẠNG THÁI PHÒNG (SYNC STATE) ---
  syncState(newState) {
    newState.version = (this.roomState?.version || 0) + 1;
    newState.updatedAt = Date.now();
    this.roomState = newState;
    this._saveLocalState();

    const packet = {
      type: 'SYNC_STATE',
      state: this.roomState
    };

    // 1. Gửi qua WebRTC tới Host hoặc các Guests
    if (this.role === 'HOST') {
      for (const conn of this.guestConnections.values()) {
        if (conn.open) {
          try { conn.send(packet); } catch (e) {}
        }
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      try { this.hostConnection.send(packet); } catch (e) {}
    }

    // 2. Gửi qua BroadcastChannel (cho đa tab cùng máy)
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    // 3. Cập nhật Discovery Beacon cho sảnh chờ
    this._publishRoomBeacon();

    // 4. Kích hoạt sự kiện nội bộ
    this._trigger('state:updated', {
      roomState: this.roomState,
      mySide: this.mySide,
      role: this.role
    });
  }

  _handleIncomingState(newState) {
    if (!newState) return;
    if (this.roomState && newState.version <= this.roomState.version && newState.updatedAt <= this.roomState.updatedAt) {
      return;
    }

    const previousState = this.roomState;
    this.roomState = newState;
    this._saveLocalState();

    // Tự động xác định vai trò nếu là GUEST
    if (this.role === 'GUEST' && this.roomState.guestId && this.roomState.guestId !== this.clientId) {
      // Đã có khách khác -> Trở thành khán giả
      this.role = 'SPECTATOR';
      this.mySide = null;
    }

    this._trigger('state:updated', {
      roomState: this.roomState,
      previousState,
      mySide: this.mySide,
      role: this.role
    });
  }

  // --- 5. CÁC HÀNH ĐỘNG GAME (GAME ACTIONS) ---
  sendMove(from, to, newBoardGrid, capturedPiece, notation, nextTurn) {
    if (!this.roomState) return;

    const moveRecord = {
      index: (this.roomState.moveHistory ? this.roomState.moveHistory.length : 0) + 1,
      from,
      to,
      side: this.mySide,
      capturedPiece: capturedPiece ? { type: capturedPiece.type, side: capturedPiece.side } : null,
      notation,
      timestamp: Date.now()
    };

    const newHistory = [...(this.roomState.moveHistory || []), moveRecord];

    const updated = {
      ...this.roomState,
      board: newBoardGrid,
      currentTurn: nextTurn,
      turnStartTime: Date.now(),
      lastMove: moveRecord,
      moveHistory: newHistory
    };

    this.syncState(updated);
  }

  notifyGameOver(winner, message) {
    if (!this.roomState) return;

    const scores = { ...(this.roomState.scores || { red: 0, blue: 0 }) };
    if (winner === 'RED') scores.red = (scores.red || 0) + 1;
    if (winner === 'BLUE') scores.blue = (scores.blue || 0) + 1;

    const updated = {
      ...this.roomState,
      status: 'FINISHED',
      scores,
      gameOver: {
        winner,
        message,
        timestamp: Date.now()
      }
    };

    this.syncState(updated);
  }

  sendChat(message) {
    if (!message || !message.trim()) return;

    const chatData = {
      sender: this.playerName,
      side: this.mySide || 'SPECTATOR',
      message: message.trim().slice(0, 150),
      timestamp: Date.now()
    };

    const packet = { type: 'CHAT_MSG', chat: chatData };

    if (this.role === 'HOST') {
      for (const conn of this.guestConnections.values()) {
        if (conn.open) {
          try { conn.send(packet); } catch (e) {}
        }
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      try { this.hostConnection.send(packet); } catch (e) {}
    }

    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    this._trigger('chat:receive', chatData);
  }

  requestRematch(freshBoardGrid) {
    if (!this.roomState) return;

    const votes = new Set(this.roomState.rematchVotes || []);
    votes.add(this.clientId);

    const hasHostVoted = votes.has(this.roomState.hostId);
    const hasGuestVoted = votes.has(this.roomState.guestId);

    if (hasHostVoted && hasGuestVoted) {
      const updated = {
        ...this.roomState,
        status: 'PLAYING',
        board: freshBoardGrid,
        currentTurn: 'RED',
        turnStartTime: Date.now(),
        lastMove: null,
        moveHistory: [],
        rematchVotes: [],
        gameOver: null
      };

      this.syncState(updated);
      this._trigger('game:reset', updated);
    } else {
      const updated = {
        ...this.roomState,
        rematchVotes: Array.from(votes)
      };

      this.syncState(updated);
      this._trigger('rematch:waiting', {
        message: 'Đã gửi yêu cầu đấu lại! Đang chờ đối thủ đồng ý...'
      });
    }
  }

  leaveRoom() {
    if (!this.roomState) return;

    if (this.roomState.status === 'PLAYING' && (this.role === 'HOST' || this.role === 'GUEST')) {
      const winner = this.mySide === 'RED' ? 'BLUE' : 'RED';
      this.notifyGameOver(winner, `Phe ${this.mySide === 'RED' ? 'Đỏ' : 'Xanh'} đã thoát phòng!`);
    }

    this._stopHeartbeat();
    if (this.role === 'HOST') {
      this._unpublishRoomBeacon();
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch (e) {}
      this.broadcastChannel = null;
    }

    this.roomId = null;
    this.roomState = null;
    this.isInitialized = false;
  }

  // --- 6. HỖ TRỢ ĐA TAB & LOCAL STORAGE ---
  _initBroadcastChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        if (this.broadcastChannel) this.broadcastChannel.close();
        this.broadcastChannel = new BroadcastChannel(`ottv2_chan_${this.roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (!event.data) return;
          if (event.data.type === 'SYNC_STATE') {
            this._handleIncomingState(event.data.state);
          } else if (event.data.type === 'CHAT_MSG') {
            this._trigger('chat:receive', event.data.chat);
          } else if (event.data.type === 'CLIENT_JOIN' && this.role === 'HOST') {
            if (!this.roomState.guestId || this.roomState.guestId === event.data.clientId) {
              this.roomState.guestId = event.data.clientId;
              this.roomState.guestName = event.data.playerName;
              this.roomState.status = 'PLAYING';
              this.roomState.gameStartedAt = this.roomState.gameStartedAt || Date.now();
              this.roomState.turnStartTime = Date.now();
            }
            this.syncState(this.roomState);
          }
        };
      }
    } catch (e) {}
  }

  _saveLocalState() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.roomState));
    } catch (e) {}
  }

  _loadLocalState() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    return url.toString();
  }

  // --- 7. GLOBAL ROOM DISCOVERY BEACON (SẢNH CHỜ TOÀN CỤC & ĐA MÁY) ---
  _publishRoomBeacon() {
    if (!this.roomState || !this.roomId) return;
    try {
      const now = Date.now();
      const summary = {
        id: this.roomId,
        name: this.roomState.roomName || `Phòng #${this.roomId.slice(-4).toUpperCase()}`,
        status: this.roomState.status || 'WAITING',
        playerCount: (this.roomState.hostId ? 1 : 0) + (this.roomState.guestId ? 1 : 0),
        maxPlayers: 2,
        spectatorCount: (this.roomState.spectators || []).length,
        playerRed: this.roomState.hostName ? { name: this.roomState.hostName, score: this.roomState.scores?.red || 0 } : null,
        playerBlue: this.roomState.guestName ? { name: this.roomState.guestName, score: this.roomState.scores?.blue || 0 } : null,
        timePerTurn: this.roomState.timePerTurn || 30,
        currentTurn: this.roomState.currentTurn || 'RED',
        createdAt: this.roomState.createdAt || now,
        gameStartedAt: this.roomState.gameStartedAt || null,
        finishedAt: this.roomState.finishedAt || null,
        moveCount: (this.roomState.moveHistory || []).length,
        scores: this.roomState.scores || { red: 0, blue: 0 },
        heartbeat: now
      };

      // 1. Lưu vào LocalStorage (Cùng trình duyệt/đa tab)
      const registryRaw = localStorage.getItem('ottv2_global_rooms');
      const registry = registryRaw ? JSON.parse(registryRaw) : {};
      registry[this.roomId] = summary;
      localStorage.setItem('ottv2_global_rooms', JSON.stringify(registry));

      // 2. Broadcast qua Channel discovery (Cùng máy)
      if (typeof BroadcastChannel !== 'undefined') {
        const discChannel = new BroadcastChannel('ottv2_lobby_discovery');
        discChannel.postMessage({ type: 'ROOM_ANNOUNCE', room: summary });
        discChannel.close();
      }

      // 3. Đồng bộ lên Central Server (Cho máy khác / Đa thiết bị qua Internet/LAN)
      fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary)
      }).catch(() => {});
    } catch (e) {}
  }

  _unpublishRoomBeacon() {
    if (!this.roomId) return;
    try {
      const registryRaw = localStorage.getItem('ottv2_global_rooms');
      if (registryRaw) {
        const registry = JSON.parse(registryRaw);
        delete registry[this.roomId];
        localStorage.setItem('ottv2_global_rooms', JSON.stringify(registry));
      }
      if (typeof BroadcastChannel !== 'undefined') {
        const discChannel = new BroadcastChannel('ottv2_lobby_discovery');
        discChannel.postMessage({ type: 'ROOM_CLOSED', roomId: this.roomId });
        discChannel.close();
      }

      // Xoá trên Central Server để máy khác thấy phòng đóng ngay lập tức
      fetch(`/api/rooms/${encodeURIComponent(this.roomId)}`, {
        method: 'DELETE'
      }).catch(() => {});
    } catch (e) {}
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.role === 'HOST' && this.roomState && this.roomId) {
        this._publishRoomBeacon();

        // Gửi nhịp tim riêng lên Server
        fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: this.roomId,
            name: this.roomState.roomName,
            status: this.roomState.status,
            hostName: this.roomState.hostName,
            guestName: this.roomState.guestName,
            spectatorCount: (this.roomState.spectators || []).length,
            timePerTurn: this.roomState.timePerTurn,
            gameStartedAt: this.roomState.gameStartedAt,
            finishedAt: this.roomState.finishedAt,
            scores: this.roomState.scores
          })
        }).catch(() => {});
      }
    }, 3500);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Lấy danh sách phòng Serverless P2P đã phát hiện
   * @returns {Array<Object>}
   */
  static getDiscoveredRooms() {
    try {
      const registryRaw = localStorage.getItem('ottv2_global_rooms');
      if (!registryRaw) return [];
      const registry = JSON.parse(registryRaw);
      const now = Date.now();
      const validRooms = [];
      let hasExpired = false;

      for (const [roomId, room] of Object.entries(registry)) {
        // Phòng có heartbeat trong vòng 45 giây gần nhất được coi là active
        if (now - (room.heartbeat || 0) < 45000) {
          let elapsedTimeMs = 0;
          if (room.status === 'PLAYING' && room.gameStartedAt) {
            elapsedTimeMs = Math.max(0, now - room.gameStartedAt);
          } else if (room.status === 'FINISHED' && room.gameStartedAt) {
            elapsedTimeMs = Math.max(0, (room.finishedAt || now) - room.gameStartedAt);
          }
          const waitingTimeMs = room.status === 'WAITING' ? Math.max(0, now - (room.createdAt || now)) : 0;

          validRooms.push({
            ...room,
            elapsedTimeMs,
            waitingTimeMs
          });
        } else {
          delete registry[roomId];
          hasExpired = true;
        }
      }

      if (hasExpired) {
        localStorage.setItem('ottv2_global_rooms', JSON.stringify(registry));
      }

      return validRooms.sort((a, b) => {
        if (a.status === 'WAITING' && b.status !== 'WAITING') return -1;
        if (a.status !== 'WAITING' && b.status === 'WAITING') return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    } catch (e) {
      return [];
    }
  }

  // --- EVENT EMITTER ---
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  _trigger(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(cb => {
        try { cb(data); } catch (err) { console.error(`Error in ${event}:`, err); }
      });
    }
  }
}

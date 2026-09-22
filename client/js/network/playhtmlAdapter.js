/**
 * PlayhtmlAdapter: Quản lý đồng bộ trạng thái phòng chơi OTTv2 thời gian thực không cần Server
 * Hỗ trợ WebRTC P2P (PeerJS) kết nối trực tiếp qua Internet giữa 2 máy tính / điện thoại bất kỳ,
 * kèm BroadcastChannel và LocalStorage làm dự phòng tức thì cho cùng máy.
 */
class PlayhtmlAdapter {
  constructor() {
    this.roomId = null;
    this.isHost = false;
    this.mySide = null; // 'RED' (Host) hoặc 'BLUE' (Guest)
    this.playerName = 'Người chơi';
    this.isInitialized = false;
    this.eventListeners = new Map();
    this.roomState = null;
    this.broadcastChannel = null;
    this.storageKey = null;

    // WebRTC P2P (PeerJS)
    this.peer = null;
    this.activeConnection = null;
    this.isP2PConnected = false;
  }

  /**
   * Khởi tạo phòng chơi P2P Serverless
   * @param {string} roomId Mã định danh phòng
   * @param {string} playerName Tên người chơi
   * @param {boolean} isHost Người tạo phòng (true) hay Người vào phòng (false)
   * @param {Array} initialBoard Ma trận bàn cờ 9x9 ban đầu
   */
  async init(roomId, playerName, isHost = false, initialBoard = null) {
    this.destroy(); // Dọn dẹp kết nối cũ nếu có

    this.roomId = roomId;
    this.isHost = isHost;
    this.mySide = isHost ? 'RED' : 'BLUE';
    this.playerName = playerName;
    this.storageKey = `ottv2_room_${roomId}`;

    // 1. Khởi tạo BroadcastChannel để đồng bộ tức thì nếu mở nhiều tab cùng máy
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`ottv2_${roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'SYNC_STATE') {
            this._handleIncomingState(event.data.state);
          } else if (event.data && event.data.type === 'CHAT_MSG') {
            this._trigger('chat:receive', event.data.chat);
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported:', e);
    }

    // 2. Lắng nghe sự kiện storage cho tab
    window.addEventListener('storage', (e) => {
      if (e.key === this.storageKey && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          this._handleIncomingState(parsed);
        } catch (err) {}
      }
    });

    // 3. Khởi tạo trạng thái ban đầu
    if (isHost || !this.roomState) {
      this.roomState = {
        roomId: this.roomId,
        hostName: this.playerName,
        guestName: isHost ? 'Đang chờ đối thủ...' : this.playerName,
        board: initialBoard || [],
        currentTurn: 'RED',
        lastMove: null,
        scores: { red: 0, blue: 0 },
        version: 1,
        updatedAt: Date.now()
      };
      this._saveLocalState();
    } else {
      this._loadLocalState();
    }

    // 4. Khởi tạo WebRTC P2P (PeerJS) kết nối qua Internet giữa 2 máy
    const cleanRoomCode = roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
    this._initPeerJSSync(cleanRoomCode, isHost);

    this.isInitialized = true;
    this._trigger('room:ready', {
      roomId: this.roomId,
      mySide: this.mySide,
      isHost: this.isHost,
      roomState: this.roomState,
      shareUrl: this.getShareUrl()
    });

    // Thông báo cục bộ
    if (!isHost) {
      this.roomState.guestName = this.playerName;
      this.syncState(this.roomState);
    }
  }

  /**
   * Khởi tạo kết nối WebRTC P2P qua PeerJS
   */
  _initPeerJSSync(cleanRoomCode, isHost) {
    if (typeof Peer === 'undefined') {
      console.warn('[P2P] Thư viện PeerJS chưa sẵn sàng.');
      return;
    }

    const peerConfig = {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    };

    const hostPeerId = `ottv2-${cleanRoomCode}`;

    if (isHost) {
      // Máy Host: Đăng ký Peer với ID phòng
      try {
        this.peer = new Peer(hostPeerId, peerConfig);

        this.peer.on('open', (id) => {
          console.log('[P2P] Chủ phòng đã mở PeerID:', id);
          this._trigger('p2p:ready', { peerId: id, isHost: true });
        });

        this.peer.on('connection', (conn) => {
          console.log('[P2P] Đối thủ đã kết nối vào phòng của Host');
          this.activeConnection = conn;
          this._setupConnection(conn, true);
        });

        this.peer.on('error', (err) => {
          console.warn('[P2P] Lỗi Peer Host:', err);
          if (err.type === 'unavailable-id') {
            this._trigger('p2p:error', {
              message: 'Mã phòng này đang có người sử dụng. Hãy thử tạo mã phòng mới!'
            });
          }
        });
      } catch (e) {
        console.warn('[P2P] Lỗi khởi tạo Host:', e);
      }
    } else {
      // Máy Guest: Tạo Peer ngẫu nhiên và kết nối tới Host
      try {
        this.peer = new Peer(null, peerConfig);

        this.peer.on('open', (id) => {
          console.log('[P2P] Khách đã mở PeerID:', id, 'đang kết nối tới Host:', hostPeerId);
          const conn = this.peer.connect(hostPeerId, { reliable: true });
          this.activeConnection = conn;
          this._setupConnection(conn, false);
        });

        this.peer.on('error', (err) => {
          console.warn('[P2P] Lỗi Peer Guest:', err);
          this._trigger('p2p:error', {
            message: 'Không tìm thấy hoặc không thể kết nối tới phòng của Host. Vui lòng kiểm tra mã phòng!'
          });
        });
      } catch (e) {
        console.warn('[P2P] Lỗi khởi tạo Guest:', e);
      }
    }
  }

  /**
   * Thiết lập các sự kiện trên DataChannel P2P
   */
  _setupConnection(conn, isHost) {
    conn.on('open', () => {
      console.log('[P2P] WebRTC DataChannel đã mở thành công!');
      this.isP2PConnected = true;

      if (!isHost) {
        // Khách gửi thông tin tham gia
        conn.send({
          type: 'PLAYER_JOIN',
          guestName: this.playerName
        });
      } else {
        // Chủ phòng gửi trạng thái bàn cờ hiện tại
        conn.send({
          type: 'SYNC_STATE',
          state: this.roomState
        });
      }

      this._trigger('p2p:connected', { isHost });
    });

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'PLAYER_JOIN':
          if (isHost) {
            this.roomState.guestName = data.guestName || 'Đối thủ (Xanh)';
            this.syncState(this.roomState);
            this._trigger('player:joined', { guestName: data.guestName });
          }
          break;

        case 'SYNC_STATE':
          this._handleIncomingState(data.state);
          break;

        case 'CHAT_MSG':
          this._trigger('chat:receive', data.chat);
          break;

        case 'GAME_RESET':
          this._handleIncomingState(data.state);
          this._trigger('game:reset', data.state);
          break;
      }
    });

    conn.on('close', () => {
      console.log('[P2P] Kết nối P2P đã đóng');
      this.isP2PConnected = false;
      this._trigger('p2p:disconnected', {});
    });

    conn.on('error', (err) => {
      console.warn('[P2P] DataChannel error:', err);
    });
  }

  /**
   * Đồng bộ trạng thái mới sang người chơi khác
   */
  syncState(newState) {
    newState.version = (this.roomState?.version || 0) + 1;
    newState.updatedAt = Date.now();
    this.roomState = newState;

    this._saveLocalState();

    // 1. Đồng bộ qua WebRTC P2P (giữa 2 máy tính / điện thoại qua Internet)
    if (this.activeConnection && this.activeConnection.open) {
      try {
        this.activeConnection.send({
          type: 'SYNC_STATE',
          state: this.roomState
        });
      } catch (e) {
        console.warn('[P2P] Gửi state thất bại:', e);
      }
    }

    // 2. Đồng bộ qua BroadcastChannel (cho cùng máy / đa tab)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'SYNC_STATE',
          state: this.roomState
        });
      } catch (e) {}
    }
  }

  _saveLocalState() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.roomState));
    } catch (e) {}
  }

  _loadLocalState() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.roomState = JSON.parse(raw);
      }
    } catch (e) {}
  }

  _handleIncomingState(newState) {
    if (!newState) return;
    if (this.roomState && newState.version <= this.roomState.version && newState.updatedAt <= this.roomState.updatedAt) {
      return;
    }

    const previousState = this.roomState;
    this.roomState = newState;
    this._saveLocalState();

    // Kích hoạt sự kiện cập nhật giao diện
    this._trigger('state:updated', {
      roomState: this.roomState,
      previousState
    });
  }

  /**
   * Gửi nước đi mới
   */
  sendMove(from, to, newBoardGrid, capturedPiece, notation, nextTurn) {
    if (!this.roomState) return;

    const updated = {
      ...this.roomState,
      board: newBoardGrid,
      currentTurn: nextTurn,
      lastMove: {
        from,
        to,
        capturedPiece,
        notation,
        side: this.mySide
      }
    };

    this.syncState(updated);
  }

  /**
   * Gửi tin nhắn Chat
   */
  sendChat(message) {
    const chatData = {
      sender: this.playerName,
      side: this.mySide,
      message: message,
      timestamp: Date.now()
    };

    if (this.activeConnection && this.activeConnection.open) {
      try {
        this.activeConnection.send({
          type: 'CHAT_MSG',
          chat: chatData
        });
      } catch (e) {}
    }

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'CHAT_MSG',
          chat: chatData
        });
      } catch (e) {}
    }

    this._trigger('chat:receive', chatData);
  }

  /**
   * Bắt đầu lại ván đấu (Rematch)
   */
  resetGame(initialBoard) {
    if (!this.roomState) return;

    const updated = {
      ...this.roomState,
      board: initialBoard,
      currentTurn: 'RED',
      lastMove: null,
      gameOver: null
    };

    this.syncState(updated);

    if (this.activeConnection && this.activeConnection.open) {
      try {
        this.activeConnection.send({
          type: 'GAME_RESET',
          state: updated
        });
      } catch (e) {}
    }

    this._trigger('game:reset', updated);
  }

  /**
   * Lấy URL liên kết để chia sẻ cho đối thủ
   */
  getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    return url.toString();
  }

  /**
   * Hủy kết nối P2P và dọn dẹp tài nguyên
   */
  destroy() {
    if (this.activeConnection) {
      try { this.activeConnection.close(); } catch (e) {}
      this.activeConnection = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch (e) {}
      this.broadcastChannel = null;
    }
    this.isP2PConnected = false;
  }

  // --- HỆ THỐNG EVENT EMITTER ---
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
        try {
          cb(data);
        } catch (e) {
          console.error(`Lỗi listener cho sự kiện ${event}:`, e);
        }
      });
    }
  }
}

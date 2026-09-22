/**
 * Main Controller: Điều phối toàn bộ ứng dụng OTTv2 Web
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. KHỞI TẠO CÁC MODULE
  const board = new ClientBoard();
  const boardContainer = document.getElementById('board-container');
  let renderer = null;
  let controls = null;
  const socketClient = new SocketClient();
  const playfullAdapter = new PlayfullAdapter(window);
  const playhtmlAdapter = new PlayhtmlAdapter();

  // Trạng thái cục bộ
  let currentMode = CONFIG.GAME_MODES.OFFLINE_2P;
  let mySide = GameRules.SIDES.RED;
  let currentTurn = GameRules.SIDES.RED;
  let currentRoomId = null;
  let localTimerInterval = null;
  let localTimeRemaining = CONFIG.DEFAULT_TURN_TIME;
  let playerRedName = 'Người chơi 1 (Đỏ)';
  let playerBlueName = 'Người chơi 2 (Xanh)';
  let scoreRed = 0;
  let scoreBlue = 0;

  // DOM Elements
  const lobbyView = document.getElementById('lobby-view');
  const arenaView = document.getElementById('arena-view');
  const connectionStatus = document.getElementById('connection-status');
  const userNicknameInput = document.getElementById('user-nickname');

  const pRedNameEl = document.getElementById('player-red-name');
  const pBlueNameEl = document.getElementById('player-blue-name');
  const pRedScoreEl = document.getElementById('player-red-score');
  const pBlueScoreEl = document.getElementById('player-blue-score');
  const turnIndicatorEl = document.getElementById('turn-indicator');
  const timerCountdownEl = document.getElementById('timer-countdown');
  const moveHistoryListEl = document.getElementById('move-history-list');
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatInputEl = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('btn-chat-send');

  // Modals
  const createRoomModal = document.getElementById('create-room-modal');
  const gameOverModal = document.getElementById('game-over-modal');
  const rulesModal = document.getElementById('rules-modal');

  // Khởi tạo renderer và controls
  renderer = new BoardRenderer(boardContainer, (row, col) => {
    controls.handleCellClick(row, col);
  });

  controls = new BoardControls(board, renderer, (from, to, moveInfo) => {
    handleMoveExecution(from, to, moveInfo);
  });

  // 2. HỆ THỐNG TOAST THÔNG BÁO
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  // 3. CHUYỂN ĐỔI GIAO DIỆN
  function showView(viewName) {
    const shareBar = document.getElementById('room-share-bar');
    if (viewName === 'lobby') {
      lobbyView.classList.add('active');
      arenaView.classList.remove('active');
      stopLocalTimer();
      if (shareBar) shareBar.style.display = 'none';
    } else if (viewName === 'arena') {
      lobbyView.classList.remove('active');
      arenaView.classList.add('active');
      renderer.renderBoard(board.grid);
      if (shareBar) {
        shareBar.style.display = (currentMode === CONFIG.GAME_MODES.PLAYHTML) ? 'flex' : 'none';
      }
    }
  }

  // 4. XỬ LÝ LƯỢT ĐI (MOVE EXECUTION)
  function handleMoveExecution(from, to, moveInfo) {
    if (currentMode === CONFIG.GAME_MODES.ONLINE) {
      // Chế độ Online Socket.io -> Gửi lên Server xác thực
      socketClient.sendMove(from, to);
    } else if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
      // Chế độ Serverless Room (playhtml)
      const moveResult = board.applyMove(from, to);

      if (moveResult.capturedPiece) {
        sounds.playCapture();
      } else {
        sounds.playMove();
      }

      renderer.renderBoard(board.grid);
      renderer.highlightLastMove(from, to);

      const notationFrom = GameRules.posToNotation(from.row, from.col);
      const notationTo = GameRules.posToNotation(to.row, to.col);
      const isSpecial = GameRules.isSpecialCell && GameRules.isSpecialCell(to.row, to.col);
      const notation = `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}${isSpecial ? ' ⚡[Ô Thần Lực]' : ''}`;
      addMoveToHistory(currentTurn, notation);

      if (isSpecial) {
        showToast(`⚡ ${currentTurn === GameRules.SIDES.RED ? 'Phe Đỏ' : 'Phe Xanh'} đã chiếm Ô Thần Lực (e5)! Quân cờ có thể ăn mọi loại quân!`, 'warning');
      }

      const nextSide = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
      const gameOverResult = ClientRules.checkGameOver(board.grid, nextSide);

      if (gameOverResult.isGameOver) {
        handleGameOver(gameOverResult.winner, gameOverResult.message);
      }

      currentTurn = nextSide;
      updateTurnUI();
      startLocalTimer();

      // Đồng bộ nước đi sang cho đối thủ
      playhtmlAdapter.sendMove(from, to, board.grid, moveResult.capturedPiece, notation, nextSide);
      controls.setGameState(currentTurn, mySide, currentTurn === mySide);
    } else {
      // Chế độ Offline / AI -> Xử lý trực tiếp tại Client
      const moveResult = board.applyMove(from, to);

      if (moveResult.capturedPiece) {
        sounds.playCapture();
      } else {
        sounds.playMove();
      }

      renderer.renderBoard(board.grid);
      renderer.highlightLastMove(from, to);

      // Ghi lịch sử
      const notationFrom = GameRules.posToNotation(from.row, from.col);
      const notationTo = GameRules.posToNotation(to.row, to.col);
      const isSpecial = GameRules.isSpecialCell && GameRules.isSpecialCell(to.row, to.col);
      addMoveToHistory(currentTurn, `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}${isSpecial ? ' ⚡[Ô Thần Lực]' : ''}`);

      if (isSpecial) {
        showToast(`⚡ ${currentTurn === GameRules.SIDES.RED ? 'Phe Đỏ' : 'Phe Xanh'} đã chiếm Ô Thần Lực (e5)! Quân cờ có thể ăn mọi loại quân!`, 'warning');
      }

      // Kiểm tra thắng thua
      const nextSide = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
      const gameOverResult = ClientRules.checkGameOver(board.grid, nextSide);

      if (gameOverResult.isGameOver) {
        handleGameOver(gameOverResult.winner, gameOverResult.message);
        return;
      }

      // Đổi lượt
      currentTurn = nextSide;
      updateTurnUI();
      startLocalTimer();

      // Nếu là chế độ AI và đến lượt Bot (BLUE)
      if (currentMode === CONFIG.GAME_MODES.AI && currentTurn === GameRules.SIDES.BLUE) {
        controls.setGameState(currentTurn, mySide, false); // Khóa tương tác người chơi
        setTimeout(executeAiTurn, 600);
      } else {
        controls.setGameState(currentTurn, currentMode === CONFIG.GAME_MODES.OFFLINE_2P ? null : mySide, true);
      }
    }
  }

  // 5. THỰC THI NƯỚC ĐI CỦA BOT AI
  function executeAiTurn() {
    const bestMove = ClientRules.getBestAiMove(board.grid, GameRules.SIDES.BLUE);
    if (!bestMove) {
      handleGameOver(GameRules.SIDES.RED, 'Bot AI không còn nước đi hợp lệ! Bạn đã chiến thắng!');
      return;
    }

    const moveResult = board.applyMove(bestMove.from, bestMove.to);
    if (moveResult.capturedPiece) {
      sounds.playCapture();
    } else {
      sounds.playMove();
    }

    renderer.renderBoard(board.grid);
    renderer.highlightLastMove(bestMove.from, bestMove.to);

    const notationFrom = GameRules.posToNotation(bestMove.from.row, bestMove.from.col);
    const notationTo = GameRules.posToNotation(bestMove.to.row, bestMove.to.col);
    const isSpecial = GameRules.isSpecialCell && GameRules.isSpecialCell(bestMove.to.row, bestMove.to.col);
    addMoveToHistory(GameRules.SIDES.BLUE, `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}${isSpecial ? ' ⚡[Ô Thần Lực]' : ''}`);

    if (isSpecial) {
      showToast('⚡ Bot AI đã chiếm được Ô Thần Lực (e5)! Hãy cẩn thận!', 'warning');
    }

    // Kiểm tra kết thúc sau nước đi của AI
    const gameOverResult = ClientRules.checkGameOver(board.grid, GameRules.SIDES.RED);
    if (gameOverResult.isGameOver) {
      handleGameOver(gameOverResult.winner, gameOverResult.message);
      return;
    }

    currentTurn = GameRules.SIDES.RED;
    updateTurnUI();
    startLocalTimer();
    controls.setGameState(currentTurn, mySide, true); // Mở lại tương tác
  }

  // 6. ĐỒNG HỒ ĐẾM NGƯỢC CỤC BỘ (CHO OFFLINE / AI)
  function startLocalTimer() {
    stopLocalTimer();
    localTimeRemaining = CONFIG.DEFAULT_TURN_TIME;
    updateTimerDisplay(localTimeRemaining);

    localTimerInterval = setInterval(() => {
      localTimeRemaining--;
      updateTimerDisplay(localTimeRemaining);

      if (localTimeRemaining <= 5 && localTimeRemaining > 0) {
        sounds.playWarning();
      }

      if (localTimeRemaining <= 0) {
        stopLocalTimer();
        const winner = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
        handleGameOver(winner, `Phe ${currentTurn === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} hết thời gian lượt đi!`);
      }
    }, 1000);
  }

  function stopLocalTimer() {
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }
  }

  function updateTimerDisplay(seconds) {
    if (!timerCountdownEl) return;
    timerCountdownEl.textContent = seconds < 10 ? `0${seconds}` : seconds;
    if (seconds <= 5) {
      timerCountdownEl.classList.add('warning');
    } else {
      timerCountdownEl.classList.remove('warning');
    }
  }

  // 7. CẬP NHẬT UI TRẬN ĐẤU
  function updateTurnUI() {
    if (turnIndicatorEl) {
      turnIndicatorEl.textContent = `LƯỢT: ${currentTurn === GameRules.SIDES.RED ? 'PHE ĐỎ' : 'PHE XANH'}`;
      turnIndicatorEl.style.color = currentTurn === GameRules.SIDES.RED ? '#ef4444' : '#3b82f6';
    }
  }

  function addMoveToHistory(side, text) {
    if (!moveHistoryListEl) return;
    const item = document.createElement('div');
    item.className = `history-item ${side.toLowerCase()}`;
    item.innerHTML = `<span>#${moveHistoryListEl.children.length + 1} [${side === GameRules.SIDES.RED ? 'ĐỎ' : 'XANH'}]</span> <span>${text}</span>`;
    moveHistoryListEl.appendChild(item);
    moveHistoryListEl.scrollTop = moveHistoryListEl.scrollHeight;
  }

  function handleGameOver(winner, message) {
    stopLocalTimer();
    sounds.playWin();

    if (winner === GameRules.SIDES.RED) scoreRed++;
    if (winner === GameRules.SIDES.BLUE) scoreBlue++;
    updateScores();

    const titleEl = document.getElementById('game-over-title');
    const msgEl = document.getElementById('game-over-message');

    if (titleEl) {
      titleEl.textContent = winner === mySide ? '🎉 BẠN ĐÃ CHIẾN THẮNG!' : `🏆 PHE ${winner === GameRules.SIDES.RED ? 'ĐỎ' : 'XANH'} THẮNG!`;
      titleEl.style.color = winner === GameRules.SIDES.RED ? '#ef4444' : '#3b82f6';
    }
    if (msgEl) msgEl.textContent = message;

    gameOverModal.classList.add('active');
    playfullAdapter.notifyGameOver(winner, message);
  }

  function updateScores() {
    if (pRedScoreEl) pRedScoreEl.textContent = `Điểm: ${scoreRed}`;
    if (pBlueScoreEl) pBlueScoreEl.textContent = `Điểm: ${scoreBlue}`;
  }

  function resetGameBoard() {
    board.reset();
    currentTurn = GameRules.SIDES.RED;
    if (moveHistoryListEl) moveHistoryListEl.innerHTML = '';
    renderer.renderBoard(board.grid);
    renderer.clearHighlights();
    updateTurnUI();
    controls.setGameState(currentTurn, currentMode === CONFIG.GAME_MODES.OFFLINE_2P ? null : mySide, true);
  }

  // 8. KHỞI CHẠY CÁC CHẾ ĐỘ CHƠI
  function startOffline2P() {
    currentMode = CONFIG.GAME_MODES.OFFLINE_2P;
    mySide = GameRules.SIDES.RED;
    playerRedName = 'Người chơi 1 (Đỏ)';
    playerBlueName = 'Người chơi 2 (Xanh)';
    pRedNameEl.textContent = playerRedName;
    pBlueNameEl.textContent = playerBlueName;
    resetGameBoard();
    showView('arena');
    startLocalTimer();
    showToast('Bắt đầu chế độ 2 người chơi trên cùng máy (Pass & Play)', 'success');
  }

  function startAiMode() {
    currentMode = CONFIG.GAME_MODES.AI;
    mySide = GameRules.SIDES.RED;
    playerRedName = (userNicknameInput.value.trim() || 'Bạn') + ' (Đỏ)';
    playerBlueName = 'Bot AI Thông Minh (Xanh)';
    pRedNameEl.textContent = playerRedName;
    pBlueNameEl.textContent = playerBlueName;
    resetGameBoard();
    showView('arena');
    startLocalTimer();
    showToast('Bắt đầu trận đấu với Máy (AI Bot)', 'success');
  }

  function startPlayhtmlRoom(roomId, isHost = false) {
    currentMode = CONFIG.GAME_MODES.PLAYHTML;
    currentRoomId = roomId;
    mySide = isHost ? GameRules.SIDES.RED : GameRules.SIDES.BLUE;

    const nickname = userNicknameInput.value.trim() || (isHost ? 'Chủ phòng' : 'Khách');
    playerRedName = (isHost ? nickname : 'Chủ phòng') + ' (Đỏ)';
    playerBlueName = (!isHost ? nickname : 'Đang chờ khách...') + ' (Xanh)';

    pRedNameEl.textContent = playerRedName;
    pBlueNameEl.textContent = playerBlueName;

    resetGameBoard();
    showView('arena');

    // Khởi tạo playhtml adapter
    playhtmlAdapter.init(roomId, nickname, isHost, board.grid);

    // Cập nhật link chia sẻ trên giao diện
    const shareInput = document.getElementById('share-room-url');
    if (shareInput) {
      shareInput.value = playhtmlAdapter.getShareUrl();
    }

    startLocalTimer();
    controls.setGameState(currentTurn, mySide, currentTurn === mySide);

    if (isHost) {
      showToast('Đã tạo phòng Serverless! Hãy bấm "Sao Chép Link" để gửi cho bạn bè.', 'success');
    } else {
      showToast(`Đã vào phòng Serverless #${roomId} (Phe Xanh)!`, 'success');
    }
  }

  // 8.1 LẮNG NGHE SỰ KIỆN TỪ PLAYHTML ADAPTER
  playhtmlAdapter.on('state:updated', ({ roomState }) => {
    if (currentMode !== CONFIG.GAME_MODES.PLAYHTML) return;

    if (roomState.board && roomState.board.length > 0) {
      board.setState(roomState.board);
      renderer.renderBoard(board.grid);
    }

    if (roomState.lastMove) {
      renderer.highlightLastMove(roomState.lastMove.from, roomState.lastMove.to);
      if (roomState.lastMove.capturedPiece) {
        sounds.playCapture();
      } else {
        sounds.playMove();
      }
      addMoveToHistory(roomState.lastMove.side, roomState.lastMove.notation);
    }

    if (roomState.hostName && pRedNameEl) {
      pRedNameEl.textContent = roomState.hostName + ' (Đỏ)';
    }
    if (roomState.guestName && pBlueNameEl) {
      pBlueNameEl.textContent = roomState.guestName + ' (Xanh)';
    }

    currentTurn = roomState.currentTurn || GameRules.SIDES.RED;
    updateTurnUI();
    startLocalTimer();

    const gameOverResult = ClientRules.checkGameOver(board.grid, currentTurn);
    if (gameOverResult.isGameOver) {
      handleGameOver(gameOverResult.winner, gameOverResult.message);
      return;
    }

    controls.setGameState(currentTurn, mySide, currentTurn === mySide);
  });

  playhtmlAdapter.on('chat:receive', (data) => {
    if (!chatMessagesEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `<div class="chat-sender ${data.side.toLowerCase()}">${data.sender}</div><div>${data.message}</div>`;
    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });

  playhtmlAdapter.on('game:reset', (data) => {
    if (data.board) board.setState(data.board);
    currentTurn = data.currentTurn || GameRules.SIDES.RED;
    resetGameBoard();
    gameOverModal.classList.remove('active');
    startLocalTimer();
    controls.setGameState(currentTurn, mySide, currentTurn === mySide);
    showToast('Phòng chơi đã được làm mới để bắt đầu ván mới!', 'success');
  });

  playhtmlAdapter.on('p2p:connected', ({ isHost }) => {
    showToast(isHost ? '🎉 Đối thủ đã kết nối P2P vào phòng của bạn!' : '🎉 Đã kết nối thành công với chủ phòng P2P!', 'success');
  });

  playhtmlAdapter.on('player:joined', ({ guestName }) => {
    showToast(`👋 ${guestName} đã vào phòng thi đấu!`, 'info');
  });

  playhtmlAdapter.on('p2p:disconnected', () => {
    showToast('⚠️ Đối thủ đã ngắt kết nối hoặc đóng trang!', 'warning');
  });

  playhtmlAdapter.on('p2p:error', ({ message }) => {
    showToast(message, 'error');
  });

  // 9. LẮNG NGHE SỰ KIỆN TỪ SOCKET.IO
  socketClient.on('connection_change', ({ isConnected }) => {
    if (connectionStatus) {
      if (isConnected) {
        connectionStatus.textContent = 'Trực tuyến (Online)';
        connectionStatus.className = 'status-indicator';
      } else {
        connectionStatus.textContent = 'Ngoại tuyến (Offline)';
        connectionStatus.className = 'status-indicator offline';
      }
    }
  });

  socketClient.on('room:list', (rooms) => {
    renderRoomList(rooms);
  });

  socketClient.on('room:joined', (data) => {
    currentMode = CONFIG.GAME_MODES.ONLINE;
    currentRoomId = data.roomId;
    mySide = data.side || 'SPECTATOR';

    playerRedName = data.room.playerRed ? data.room.playerRed.name : 'Chờ người chơi...';
    playerBlueName = data.room.playerBlue ? data.room.playerBlue.name : 'Chờ người chơi...';
    pRedNameEl.textContent = playerRedName;
    pBlueNameEl.textContent = playerBlueName;

    board.setState(data.room.board);
    currentTurn = data.room.currentTurn;
    renderer.renderBoard(board.grid);
    updateTurnUI();

    controls.setGameState(currentTurn, mySide === 'SPECTATOR' ? null : mySide, mySide !== 'SPECTATOR');
    showView('arena');
    createRoomModal.classList.remove('active');
    showToast(`Đã tham gia phòng #${data.roomId} (${data.role}: ${mySide || 'Khán giả'})`, 'success');
  });

  socketClient.on('game:start', (data) => {
    board.setState(data.room.board);
    currentTurn = data.room.currentTurn;
    renderer.renderBoard(board.grid);
    updateTurnUI();
    controls.setGameState(currentTurn, mySide === 'SPECTATOR' ? null : mySide, mySide !== 'SPECTATOR');
    showToast(data.message, 'success');
  });

  socketClient.on('game:tick', ({ turnTimeRemaining, currentTurn: serverTurn }) => {
    currentTurn = serverTurn;
    updateTurnUI();
    updateTimerDisplay(turnTimeRemaining);
    if (turnTimeRemaining <= 5 && turnTimeRemaining > 0) {
      sounds.playWarning();
    }
  });

  socketClient.on('game:move_success', (data) => {
    const { moveRecord, board: serverBoard, nextTurn, turnTimeRemaining } = data;
    board.setState(serverBoard);
    renderer.renderBoard(board.grid);
    renderer.highlightLastMove(moveRecord.from, moveRecord.to);

    if (moveRecord.capturedPiece) {
      sounds.playCapture();
    } else {
      sounds.playMove();
    }

    addMoveToHistory(moveRecord.side, moveRecord.notation);
    if (GameRules.isSpecialCell && GameRules.isSpecialCell(moveRecord.to.row, moveRecord.to.col)) {
      showToast(`⚡ ${moveRecord.side === GameRules.SIDES.RED ? 'Phe Đỏ' : 'Phe Xanh'} đã chiếm Ô Thần Lực (e5)!`, 'warning');
    }
    currentTurn = nextTurn;
    updateTurnUI();
    updateTimerDisplay(turnTimeRemaining);
    controls.setGameState(currentTurn, mySide === 'SPECTATOR' ? null : mySide, mySide !== 'SPECTATOR');
  });

  socketClient.on('game:over', (data) => {
    handleGameOver(data.winner, data.message);
  });

  socketClient.on('game:rematch_response', (data) => {
    showToast(data.message, 'info');
  });

  socketClient.on('game:rematch_start', (data) => {
    board.setState(data.room.board);
    currentTurn = data.room.currentTurn;
    renderer.renderBoard(board.grid);
    renderer.clearHighlights();
    updateTurnUI();
    gameOverModal.classList.remove('active');
    showToast(data.message, 'success');
  });

  socketClient.on('chat:receive', (data) => {
    if (!chatMessagesEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `<div class="chat-sender ${data.side.toLowerCase()}">${data.sender}</div><div>${data.message}</div>`;
    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });

  socketClient.on('error:message', (err) => {
    showToast(err.message, 'error');
  });

  // Render danh sách phòng trong Lobby
  function renderRoomList(rooms) {
    const roomListContainer = document.getElementById('room-list');
    if (!roomListContainer) return;
    roomListContainer.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      roomListContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1;">Chưa có phòng nào đang mở. Hãy tạo phòng mới ngay!</div>';
      return;
    }

    rooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'room-card';
      const isFull = r.playerCount >= 2;

      card.innerHTML = `
        <div class="room-card-header">
          <span class="room-name">${r.name}</span>
          <span class="room-badge ${r.status.toLowerCase()}">${r.status === 'WAITING' ? 'Chờ' : 'Đang đấu'}</span>
        </div>
        <div class="room-players">
          ${r.playerRed || 'Trống'} (Đỏ) VS ${r.playerBlue || 'Trống'} (Xanh)
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
          <span style="font-size: 0.75rem; color: var(--text-muted);">${r.hasPassword ? '🔒 Có mật khẩu' : '🔓 Công khai'}</span>
          <button class="btn btn-primary" style="padding: 4px 12px; font-size: 0.8rem;" data-room-id="${r.id}">
            ${isFull ? 'Xem (Spectate)' : 'Vào Chơi'}
          </button>
        </div>
      `;

      card.querySelector('button').addEventListener('click', () => {
        const playerName = userNicknameInput.value.trim() || 'Người chơi';
        let password = '';
        if (r.hasPassword) {
          password = prompt('Nhập mật khẩu phòng:') || '';
        }
        socketClient.joinRoom(r.id, playerName, password);
      });

      roomListContainer.appendChild(card);
    });
  }

  // 10. GÁN SỰ KIỆN CHO CÁC NÚT BẤM (BUTTON LISTENERS)
  document.getElementById('btn-mode-offline')?.addEventListener('click', startOffline2P);
  document.getElementById('btn-mode-ai')?.addEventListener('click', startAiMode);

  // Tạo phòng Serverless (playhtml)
  document.getElementById('btn-mode-playhtml')?.addEventListener('click', () => {
    const randomCode = 'ott-' + Math.random().toString(36).substring(2, 8);
    startPlayhtmlRoom(randomCode, true);
  });

  // Tham gia phòng bằng mã hoặc link
  document.getElementById('btn-join-room-code')?.addEventListener('click', () => {
    const inputVal = document.getElementById('input-join-room-code')?.value.trim();
    if (!inputVal) {
      showToast('Vui lòng nhập mã phòng hoặc dán link mời!', 'warning');
      return;
    }

    let roomId = inputVal;
    if (inputVal.includes('?room=')) {
      try {
        const url = new URL(inputVal.startsWith('http') ? inputVal : `http://${inputVal}`);
        roomId = url.searchParams.get('room') || inputVal;
      } catch (e) {}
    }

    startPlayhtmlRoom(roomId, false);
  });

  // Sao chép link phòng
  document.getElementById('btn-copy-room-link')?.addEventListener('click', () => {
    const shareInput = document.getElementById('share-room-url');
    if (shareInput && shareInput.value) {
      navigator.clipboard.writeText(shareInput.value).then(() => {
        showToast('📋 Đã sao chép link mời bạn bè vào bộ nhớ tạm!', 'success');
      }).catch(() => {
        shareInput.select();
        document.execCommand('copy');
        showToast('📋 Đã sao chép link mời bạn bè!', 'success');
      });
    }
  });

  document.getElementById('btn-quick-match')?.addEventListener('click', () => {
    if (!socketClient.isConnected) {
      showToast('Không có kết nối tới máy chủ Online. Hãy dùng nút "Tạo Phòng Serverless" hoặc chơi Offline/AI!', 'error');
      return;
    }
    const playerName = userNicknameInput.value.trim() || 'Người chơi';
    socketClient.quickMatch(playerName);
  });

  document.getElementById('btn-open-create-modal')?.addEventListener('click', () => {
    if (!socketClient.isConnected) {
      showToast('Không có kết nối tới máy chủ Node.js. Hãy dùng nút "Tạo Phòng Serverless" trên sảnh!', 'error');
      return;
    }
    createRoomModal.classList.add('active');
  });

  document.getElementById('btn-close-create-modal')?.addEventListener('click', () => {
    createRoomModal.classList.remove('active');
  });

  document.getElementById('form-create-room')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('input-room-name').value.trim();
    const password = document.getElementById('input-room-password').value.trim();
    const timePerTurn = parseInt(document.getElementById('select-time-turn').value, 10) || 30;
    const playerName = userNicknameInput.value.trim() || 'Chủ phòng';

    socketClient.createRoom(roomName, playerName, password, timePerTurn);
  });

  document.getElementById('btn-surrender')?.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn đầu hàng ván đấu này?')) {
      if (currentMode === CONFIG.GAME_MODES.ONLINE) {
        socketClient.surrender();
      } else if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
        const winner = mySide === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
        handleGameOver(winner, `Phe ${mySide === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} đã chủ động đầu hàng!`);
      } else {
        const winner = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
        handleGameOver(winner, `Phe ${currentTurn === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} đã chủ động đầu hàng!`);
      }
    }
  });

  document.getElementById('btn-leave-arena')?.addEventListener('click', () => {
    if (confirm('Rời khỏi trận đấu và quay về sảnh chính?')) {
      if (currentMode === CONFIG.GAME_MODES.ONLINE) {
        socketClient.leaveRoom();
      }
      stopLocalTimer();
      showView('lobby');
    }
  });

  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    if (currentMode === CONFIG.GAME_MODES.ONLINE) {
      socketClient.requestRematch();
      showToast('Đã gửi yêu cầu đấu lại tới đối thủ!', 'info');
    } else if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
      const freshBoard = new ClientBoard();
      playhtmlAdapter.resetGame(freshBoard.grid);
    } else {
      gameOverModal.classList.remove('active');
      resetGameBoard();
      startLocalTimer();
    }
  });

  document.getElementById('btn-close-game-over')?.addEventListener('click', () => {
    gameOverModal.classList.remove('active');
    showView('lobby');
  });

  document.getElementById('btn-sound-toggle')?.addEventListener('click', (e) => {
    const isMuted = sounds.toggleMute();
    e.currentTarget.textContent = isMuted ? '🔇 Tắt tiếng' : '🔊 Âm thanh';
  });

  document.getElementById('btn-rules-modal')?.addEventListener('click', () => {
    rulesModal.classList.add('active');
  });

  document.getElementById('btn-close-rules')?.addEventListener('click', () => {
    rulesModal.classList.remove('active');
  });

  // Chat message send
  const sendChatMessage = () => {
    const text = chatInputEl.value.trim();
    if (!text) return;
    if (currentMode === CONFIG.GAME_MODES.ONLINE) {
      socketClient.sendChat(text);
    } else if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
      playhtmlAdapter.sendChat(text);
    } else {
      // Local chat echo
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.innerHTML = `<div class="chat-sender red">Bạn</div><div>${text}</div>`;
      chatMessagesEl.appendChild(bubble);
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
    chatInputEl.value = '';
  };

  chatSendBtn?.addEventListener('click', sendChatMessage);
  chatInputEl?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // Tự động tham gia nếu URL có chứa ?room=
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    setTimeout(() => {
      startPlayhtmlRoom(roomParam, false);
    }, 200);
  }

  // Kết nối socket lúc khởi động
  socketClient.connect();
});

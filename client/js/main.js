/**
 * Main Controller: Điều phối toàn bộ ứng dụng OTTv2 Web
 * Chạy trên nền tảng Serverless thuần túy qua playhtml (PartyKit & Yjs CRDT).
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. KHỞI TẠO CÁC MODULE CỐT LÕI
  const board = new ClientBoard();
  const boardContainer = document.getElementById('board-container');
  let renderer = null;
  let controls = null;
  const playhtmlAdapter = new PlayhtmlAdapter();
  const playfullAdapter = new PlayfullAdapter(window);

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
  const userNicknameInput = document.getElementById('user-nickname');
  const connectionStatus = document.getElementById('connection-status');

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

  // 4. XỬ LÝ NƯỚC ĐI (MOVE EXECUTION)
  function handleMoveExecution(from, to, moveInfo) {
    if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
      // Chế độ Online Serverless (playhtml)
      if (currentTurn !== mySide) {
        showToast('Chưa tới lượt đi của bạn!', 'warning');
        return;
      }

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
      const notation = `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}`;
      addMoveToHistory(currentTurn, notation);

      const nextSide = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
      const gameOverResult = ClientRules.checkGameOver(board.grid, nextSide);

      if (gameOverResult.isGameOver) {
        handleGameOver(gameOverResult.winner, gameOverResult.message);
        playhtmlAdapter.notifyGameOver(gameOverResult.winner, gameOverResult.message);
      }

      currentTurn = nextSide;
      updateTurnUI();
      startLocalTimer();

      // Đồng bộ nước đi cho đối thủ
      playhtmlAdapter.sendMove(from, to, board.grid, moveResult.capturedPiece, notation, nextSide);
      controls.setGameState(currentTurn, mySide, currentTurn === mySide);
    } else {
      // Chế độ Offline Pass & Play / AI Bot
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
      addMoveToHistory(currentTurn, `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}`);

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
    addMoveToHistory(GameRules.SIDES.BLUE, `${notationFrom} ➔ ${notationTo}${moveResult.capturedPiece ? ' (Ăn quân)' : ''}`);

    const gameOverResult = ClientRules.checkGameOver(board.grid, GameRules.SIDES.RED);
    if (gameOverResult.isGameOver) {
      handleGameOver(gameOverResult.winner, gameOverResult.message);
      return;
    }

    currentTurn = GameRules.SIDES.RED;
    updateTurnUI();
    startLocalTimer();
    controls.setGameState(currentTurn, mySide, true);
  }

  // 6. ĐỒNG HỒ ĐẾM NGƯỢC LƯỢT ĐI (TURN TIMER)
  function startLocalTimer(timeLimit) {
    stopLocalTimer();

    const roomTimeLimit = currentMode === CONFIG.GAME_MODES.PLAYHTML
      ? playhtmlAdapter.roomState?.timePerTurn
      : null;
    const resolvedLimit = Number(timeLimit ?? roomTimeLimit ?? CONFIG.DEFAULT_TURN_TIME);
    localTimeRemaining = Number.isFinite(resolvedLimit) && resolvedLimit > 0
      ? resolvedLimit
      : CONFIG.DEFAULT_TURN_TIME;

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
        const msg = `Phe ${currentTurn === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} đã hết thời gian lượt đi!`;
        handleGameOver(winner, msg);

        if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
          playhtmlAdapter.notifyGameOver(winner, msg);
        }
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
    const s = Math.max(0, seconds);
    timerCountdownEl.textContent = s < 10 ? `0${s}` : s;
    if (s <= 5) {
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
      if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
        titleEl.textContent = winner === mySide ? '🎉 BẠN ĐÃ CHIẾN THẮNG!' : (mySide ? '💔 BẠN ĐÃ THUA TRẬN!' : `🏆 PHE ${winner === GameRules.SIDES.RED ? 'ĐỎ' : 'XANH'} THẮNG!`);
      } else {
        titleEl.textContent = `🏆 PHE ${winner === GameRules.SIDES.RED ? 'ĐỎ' : 'XANH'} THẮNG!`;
      }
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

  // 8. KHỞI TẠO VÀ ĐIỀU PHỐI CÁC CHẾ ĐỘ CHƠI

  // 8.1. Chế độ 2 Người Offline (Pass & Play)
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

  // 8.2. Chế độ Đấu với Máy (AI Bot)
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

  // 8.3. Chế độ Online Serverless (playhtml)
  async function startPlayhtmlRoom(roomId, isHost = false, options = {}) {
    currentMode = CONFIG.GAME_MODES.PLAYHTML;
    currentRoomId = roomId;

    const nickname = userNicknameInput.value.trim() || (isHost ? 'Chủ phòng' : 'Khách');
    resetGameBoard();
    showView('arena');

    // Khởi tạo adapter
    const joinResult = await playhtmlAdapter.init(roomId, nickname, isHost, {
      ...options,
      initialBoard: board.grid
    });

    mySide = joinResult.mySide;
    const roomState = joinResult.roomState;

    // Cập nhật thông tin phòng trên thanh chia sẻ
    const shareInput = document.getElementById('share-room-url');
    const badgeEl = document.getElementById('room-code-badge');
    if (shareInput) shareInput.value = playhtmlAdapter.getShareUrl();
    if (badgeEl) badgeEl.textContent = `Mã: ${roomId}`;

    // Cập nhật tên người chơi
    playerRedName = (roomState.hostName || 'Chủ phòng') + ' (Đỏ)';
    playerBlueName = (roomState.guestName || 'Đang chờ đối thủ...') + ' (Xanh)';
    pRedNameEl.textContent = playerRedName;
    pBlueNameEl.textContent = playerBlueName;

    // Phân quyền tương tác
    const isMyTurn = (currentTurn === mySide) && (mySide !== null);
    controls.setGameState(currentTurn, mySide, isMyTurn);

    if (isHost) {
      showToast(`🎉 Đã tạo phòng #${roomId}! Hãy sao chép link mời gửi cho bạn bè.`, 'success');
    } else {
      showToast(`Đã tham gia phòng #${roomId} (${joinResult.role}: ${mySide || 'Khán giả'})!`, 'success');
    }

    if (roomState.status === 'PLAYING') {
      startLocalTimer(roomState.timePerTurn);
    }
  }

  // 9. LẮNG NGHE SỰ KIỆN TỪ PLAYHTML ADAPTER
  playhtmlAdapter.on('state:updated', ({ roomState, mySide: updatedSide, role }) => {
    if (currentMode !== CONFIG.GAME_MODES.PLAYHTML) return;

    // Cập nhật bàn cờ
    if (roomState.board && roomState.board.length > 0) {
      board.setState(roomState.board);
      renderer.renderBoard(board.grid);
    }

    // Hiển thị highlight nước đi vừa thực hiện
    if (roomState.lastMove) {
      renderer.highlightLastMove(roomState.lastMove.from, roomState.lastMove.to);
      if (roomState.lastMove.capturedPiece) {
        sounds.playCapture();
      } else {
        sounds.playMove();
      }
      if (moveHistoryListEl && moveHistoryListEl.children.length === 0 && roomState.moveHistory) {
        // Tái tạo lịch sử nếu mới vào phòng
        roomState.moveHistory.forEach(m => addMoveToHistory(m.side, m.notation));
      }
    }

    // Cập nhật tên người chơi
    if (roomState.hostName && pRedNameEl) {
      pRedNameEl.textContent = roomState.hostName + ' (Đỏ)';
    }
    if (pBlueNameEl) {
      pBlueNameEl.textContent = (roomState.guestName || 'Đang chờ đối thủ...') + ' (Xanh)';
    }

    // Cập nhật điểm số
    if (roomState.scores) {
      scoreRed = roomState.scores.red || 0;
      scoreBlue = roomState.scores.blue || 0;
      updateScores();
    }

    // Lượt đi
    currentTurn = roomState.currentTurn || GameRules.SIDES.RED;
    updateTurnUI();

    // Đồng hồ
    if (roomState.status === 'PLAYING') {
      startLocalTimer(roomState.timePerTurn);
    } else if (roomState.status === 'FINISHED') {
      stopLocalTimer();
      if (roomState.gameOver) {
        handleGameOver(roomState.gameOver.winner, roomState.gameOver.message);
      }
    } else {
      const waitingTime = Number(roomState.timePerTurn) || CONFIG.DEFAULT_TURN_TIME;
      updateTimerDisplay(waitingTime);
    }

    // Phân quyền click
    mySide = updatedSide;
    const canMove = (currentTurn === mySide) && (mySide !== null) && (roomState.status === 'PLAYING');
    controls.setGameState(currentTurn, mySide, canMove);
  });

  playhtmlAdapter.on('chat:receive', (data) => {
    if (!chatMessagesEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `<div class="chat-sender ${data.side ? data.side.toLowerCase() : 'spectator'}">${data.sender}</div><div>${data.message}</div>`;
    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });

  playhtmlAdapter.on('game:reset', (data) => {
    if (data.board) board.setState(data.board);
    currentTurn = data.currentTurn || GameRules.SIDES.RED;
    resetGameBoard();
    gameOverModal.classList.remove('active');
    startLocalTimer(data.timePerTurn ?? playhtmlAdapter.roomState?.timePerTurn ?? CONFIG.DEFAULT_TURN_TIME);
    const canMove = (currentTurn === mySide) && (mySide !== null);
    controls.setGameState(currentTurn, mySide, canMove);
    showToast('Ván đấu mới đã bắt đầu!', 'success');
  });

  playhtmlAdapter.on('rematch:waiting', (data) => {
    showToast(data.message, 'info');
  });

  playhtmlAdapter.on('network:status', (data) => {
    if (data.status === 'CONNECTED_TO_HOST') {
      showToast('🔗 Đã kết nối P2P thành công với Chủ phòng!', 'success');
    } else if (data.status === 'HOST_DISCONNECTED') {
      showToast('⚠️ Chủ phòng đã ngắt kết nối!', 'warning');
    }
  });

  // 10. GIAO DIỆN SẢNH CHỜ TRỰC TIẾP & GIÁM SÁT PHÒNG (LIVE ROOM HUB)
  let activeRoomFilter = 'ALL';
  let roomSearchKeyword = '';
  let cachedLobbyRooms = [];
  let roomLiveTickerInterval = null;
  let roomRefreshPollInterval = null;

  function formatDuration(ms) {
    if (!ms || ms < 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0) {
      const hh = String(hours).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }

  async function fetchAndRenderLobbyRooms() {
    let serverlessRooms = PlayhtmlAdapter.getDiscoveredRooms() || [];
    let serverRooms = [];

    try {
      const res = await fetch('/api/rooms', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.rooms) {
          serverRooms = data.rooms;
        }
      }
    } catch (e) {
      // Chế độ static offline
    }

    const roomMap = new Map();
    serverlessRooms.forEach(r => roomMap.set(r.id, r));
    serverRooms.forEach(r => roomMap.set(r.id, r));

    cachedLobbyRooms = Array.from(roomMap.values()).sort((a, b) => {
      if (a.status === 'WAITING' && b.status !== 'WAITING') return -1;
      if (a.status !== 'WAITING' && b.status === 'WAITING') return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    updateLobbyStatsBar(cachedLobbyRooms);
    renderLobbyRoomGrid();
  }

  function updateLobbyStatsBar(rooms) {
    const totalRooms = rooms.length;
    let waitingRooms = 0;
    let playingRooms = 0;
    let totalUsers = 0;

    rooms.forEach(r => {
      if (r.status === 'WAITING') waitingRooms++;
      else if (r.status === 'PLAYING') playingRooms++;
      totalUsers += (r.playerCount || 0) + (r.spectatorCount || 0);
    });

    const elTotal = document.getElementById('stat-total-rooms');
    const elWaiting = document.getElementById('stat-waiting-rooms');
    const elPlaying = document.getElementById('stat-playing-rooms');
    const elUsers = document.getElementById('stat-total-users');

    if (elTotal) elTotal.textContent = totalRooms;
    if (elWaiting) elWaiting.textContent = waitingRooms;
    if (elPlaying) elPlaying.textContent = playingRooms;
    if (elUsers) elUsers.textContent = totalUsers;

    const countAll = document.getElementById('count-filter-all');
    const countWait = document.getElementById('count-filter-waiting');
    const countPlay = document.getElementById('count-filter-playing');
    const countSpec = document.getElementById('count-filter-spectate');

    if (countAll) countAll.textContent = totalRooms;
    if (countWait) countWait.textContent = waitingRooms;
    if (countPlay) countPlay.textContent = playingRooms;
    if (countSpec) countSpec.textContent = playingRooms;
  }

  function renderLobbyRoomGrid() {
    const grid = document.getElementById('room-list-grid');
    if (!grid) return;

    // Áp dụng bộ lọc
    const filtered = cachedLobbyRooms.filter(r => {
      // 1. Lọc theo tab
      if (activeRoomFilter === 'WAITING' && r.status !== 'WAITING') return false;
      if (activeRoomFilter === 'PLAYING' && r.status !== 'PLAYING') return false;
      if (activeRoomFilter === 'SPECTATE' && r.status !== 'PLAYING' && r.status !== 'FINISHED') return false;

      // 2. Lọc theo từ khoá tìm kiếm
      if (roomSearchKeyword) {
        const kw = roomSearchKeyword.toLowerCase();
        const matchName = (r.name || '').toLowerCase().includes(kw);
        const matchId = (r.id || '').toLowerCase().includes(kw);
        const matchRed = (r.playerRed?.name || '').toLowerCase().includes(kw);
        const matchBlue = (r.playerBlue?.name || '').toLowerCase().includes(kw);
        if (!matchName && !matchId && !matchRed && !matchBlue) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      let emptyMsg = 'Chưa có phòng nào đang mở trên hệ thống.';
      if (activeRoomFilter === 'WAITING') emptyMsg = 'Hiện không có phòng nào đang chờ người.';
      if (activeRoomFilter === 'PLAYING') emptyMsg = 'Hiện chưa có trận đấu nào đang diễn ra.';
      if (roomSearchKeyword) emptyMsg = `Không tìm thấy phòng nào phù hợp với "${roomSearchKeyword}".`;

      grid.innerHTML = `
        <div class="room-empty-state">
          <div class="room-empty-icon">🎲</div>
          <h4>${emptyMsg}</h4>
          <p>Hãy bấm "Tạo Phòng Mới" để mở phòng và mời bạn bè vào tranh tài!</p>
          <button class="btn btn-success" id="btn-empty-create-room" style="padding: 9px 20px; font-weight: 700;">
            ➕ Tạo Phòng Mới Ngay
          </button>
        </div>
      `;

      document.getElementById('btn-empty-create-room')?.addEventListener('click', () => {
        createRoomModal.classList.add('active');
      });
      return;
    }

    const now = Date.now();
    grid.innerHTML = filtered.map(r => {
      const isWaiting = r.status === 'WAITING';
      const isPlaying = r.status === 'PLAYING';
      const isFinished = r.status === 'FINISHED';

      // Badge trạng thái
      let statusBadgeHtml = '';
      if (isWaiting) {
        statusBadgeHtml = `<span class="room-status-badge waiting">🟢 Đang Chờ (1/2)</span>`;
      } else if (isPlaying) {
        statusBadgeHtml = `<span class="room-status-badge playing">🔴 Đang Thi Đấu (2/2)</span>`;
      } else {
        statusBadgeHtml = `<span class="room-status-badge finished">🏁 Kết Thúc</span>`;
      }

      // Tên người chơi & Điểm số
      const redName = r.playerRed?.name || 'Chủ phòng (Đỏ)';
      const redScore = r.scores?.red || r.playerRed?.score || 0;
      const blueName = r.playerBlue?.name || (isWaiting ? 'Đang đợi đối thủ...' : 'Khách (Xanh)');
      const blueScore = r.scores?.blue || r.playerBlue?.score || 0;

      // Tính thời gian ban đầu
      let initialTimerText = '';
      let chipClass = 'live-timer-chip';
      if (isWaiting) {
        const waitMs = Math.max(0, now - (r.createdAt || now));
        initialTimerText = `⏳ Chờ: ${formatDuration(waitMs)}`;
        chipClass += ' waiting';
      } else if (isPlaying) {
        const playMs = Math.max(0, now - (r.gameStartedAt || now));
        initialTimerText = `⚔️ Đang đấu: ${formatDuration(playMs)}`;
      } else {
        const totalMs = Math.max(0, (r.finishedAt || now) - (r.gameStartedAt || now));
        initialTimerText = `🏁 Tổng: ${formatDuration(totalMs)}`;
      }

      // Nút hành động
      let actionBtnHtml = '';
      if (isWaiting) {
        actionBtnHtml = `<button class="btn btn-success btn-action" data-action="join" data-room-id="${r.id}">⚔️ Tham Chiến Ngay</button>`;
      } else if (isPlaying) {
        actionBtnHtml = `<button class="btn btn-primary btn-action" data-action="spectate" data-room-id="${r.id}">👁️ Xem Trực Tiếp</button>`;
      } else {
        actionBtnHtml = `<button class="btn btn-secondary btn-action" data-action="spectate" data-room-id="${r.id}">👁️ Xem Bàn Cờ</button>`;
      }

      return `
        <div class="room-card status-${r.status.toLowerCase()}" data-room-id="${r.id}">
          <div class="room-card-header">
            <div class="room-title-area">
              <div class="room-name" title="${r.name || ('Phòng #' + r.id)}">${r.name || ('Phòng #' + r.id)}</div>
              <div class="room-id-tag">
                <span>Mã: <code>${r.id}</code></span>
              </div>
            </div>
            ${statusBadgeHtml}
          </div>

          <div class="room-card-body">
            <div class="room-matchup-row">
              <div class="room-player-side">
                <span class="side-dot">🔴</span>
                <span class="p-name" title="${redName}">${redName}</span>
                ${isPlaying || isFinished ? `<span style="font-weight: 800; color: #f87171; font-size: 0.8rem;">(${redScore})</span>` : ''}
              </div>

              <div class="room-vs-badge">VS</div>

              <div class="room-player-side" style="justify-content: flex-end;">
                ${isPlaying || isFinished ? `<span style="font-weight: 800; color: #60a5fa; font-size: 0.8rem;">(${blueScore})</span>` : ''}
                <span class="p-name ${isWaiting ? 'waiting' : ''}" title="${blueName}">${blueName}</span>
                <span class="side-dot">🔵</span>
              </div>
            </div>

            <div class="room-timing-row">
              <div class="${chipClass}">
                <span class="live-timer-text" data-timer-target="${r.id}">${initialTimerText}</span>
              </div>
              <div class="room-meta-tags">
                <span>⌛ ${r.timePerTurn || 30}s/lượt</span>
                <span>👁️ ${r.spectatorCount || 0}</span>
                <span>🎯 ${r.moveCount || 0} nước</span>
              </div>
            </div>
          </div>

          <div class="room-card-actions">
            ${actionBtnHtml}
            <button class="btn btn-secondary btn-copy-mini" data-action="copy" data-room-id="${r.id}" title="Sao chép link mời phòng">
              📋
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Gán sự kiện cho các nút hành động trong thẻ phòng
    grid.querySelectorAll('[data-action="join"], [data-action="spectate"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.getAttribute('data-room-id');
        if (roomId) {
          startPlayhtmlRoom(roomId, false);
        }
      });
    });

    grid.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.getAttribute('data-room-id');
        if (roomId) {
          const url = new URL(window.location.href);
          url.searchParams.set('room', roomId);
          const shareUrl = url.toString();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
              showToast(`📋 Đã sao chép link phòng #${roomId}!`, 'success');
            }).catch(() => {
              prompt('Sao chép đường link phòng:', shareUrl);
            });
          } else {
            prompt('Sao chép đường link phòng:', shareUrl);
          }
        }
      });
    });
  }

  // Bộ đếm Live Ticker chạy mỗi giây cập nhật thời gian thực trên các thẻ phòng
  function startLobbyLiveTicker() {
    if (roomLiveTickerInterval) clearInterval(roomLiveTickerInterval);
    roomLiveTickerInterval = setInterval(() => {
      if (!lobbyView.classList.contains('active')) return;
      const now = Date.now();

      document.querySelectorAll('[data-timer-target]').forEach(el => {
        const roomId = el.getAttribute('data-timer-target');
        const room = cachedLobbyRooms.find(r => r.id === roomId);
        if (!room) return;

        if (room.status === 'WAITING') {
          const waitMs = Math.max(0, now - (room.createdAt || now));
          el.textContent = `⏳ Chờ: ${formatDuration(waitMs)}`;
        } else if (room.status === 'PLAYING') {
          const playMs = Math.max(0, now - (room.gameStartedAt || now));
          el.textContent = `⚔️ Đang đấu: ${formatDuration(playMs)}`;
        } else if (room.status === 'FINISHED') {
          const totalMs = Math.max(0, (room.finishedAt || now) - (room.gameStartedAt || now));
          el.textContent = `🏁 Tổng: ${formatDuration(totalMs)}`;
        }
      });
    }, 1000);
  }

  // Khởi động đồng bộ danh sách phòng và lắng nghe Discovery
  function initLobbyRoomDiscovery() {
    fetchAndRenderLobbyRooms();
    startLobbyLiveTicker();

    // Polling định kỳ mỗi 5s
    if (roomRefreshPollInterval) clearInterval(roomRefreshPollInterval);
    roomRefreshPollInterval = setInterval(() => {
      if (lobbyView.classList.contains('active')) {
        fetchAndRenderLobbyRooms();
      }
    }, 5000);

    // Lắng nghe BroadcastChannel Discovery
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const lobbyChannel = new BroadcastChannel('ottv2_lobby_discovery');
        lobbyChannel.onmessage = (event) => {
          if (event.data && (event.data.type === 'ROOM_ANNOUNCE' || event.data.type === 'ROOM_CLOSED')) {
            fetchAndRenderLobbyRooms();
          }
        };
      } catch (e) {}
    }

    // Sự kiện Filter Tabs
    document.querySelectorAll('#room-filter-tabs .filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#room-filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeRoomFilter = tab.getAttribute('data-filter') || 'ALL';
        renderLobbyRoomGrid();
      });
    });

    // Sự kiện Tìm kiếm
    const searchInput = document.getElementById('input-search-rooms');
    searchInput?.addEventListener('input', (e) => {
      roomSearchKeyword = e.target.value.trim();
      renderLobbyRoomGrid();
    });

    // Sự kiện Nút Refresh
    const btnRefresh = document.getElementById('btn-refresh-rooms');
    btnRefresh?.addEventListener('click', async () => {
      btnRefresh.classList.add('spinning');
      await fetchAndRenderLobbyRooms();
      showToast('Đã làm mới danh sách phòng chơi!', 'info');
      setTimeout(() => {
        btnRefresh.classList.remove('spinning');
      }, 600);
    });
  }

  // 11. GÁN SỰ KIỆN CHO CÁC NÚT BẤM VÀ FORM

  // Chế độ Offline Pass & Play
  document.getElementById('btn-mode-offline')?.addEventListener('click', startOffline2P);

  // Chế độ AI Bot
  document.getElementById('btn-mode-ai')?.addEventListener('click', startAiMode);

  // Mở modal tạo phòng Online playhtml
  document.getElementById('btn-mode-playhtml')?.addEventListener('click', () => {
    createRoomModal.classList.add('active');
  });

  document.getElementById('btn-close-create-modal')?.addEventListener('click', () => {
    createRoomModal.classList.remove('active');
  });

  // Submit form tạo phòng mới
  document.getElementById('form-create-room')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('input-room-name')?.value.trim() || 'Phòng Chiến Thuật';
    const timePerTurn = parseInt(document.getElementById('select-time-turn')?.value, 10) || 30;
    const randomCode = 'ott-' + Math.random().toString(36).substring(2, 8);

    createRoomModal.classList.remove('active');
    startPlayhtmlRoom(randomCode, true, { roomName, timePerTurn });
  });

  // Vào phòng bằng mã hoặc dán link mời
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

  // Sao chép link mời bạn bè
  document.getElementById('btn-copy-room-link')?.addEventListener('click', () => {
    const shareInput = document.getElementById('share-room-url');
    if (shareInput && shareInput.value) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareInput.value).then(() => {
          showToast('📋 Đã sao chép link mời vào bộ nhớ tạm!', 'success');
        }).catch(() => {
          shareInput.select();
          document.execCommand('copy');
          showToast('📋 Đã sao chép link mời!', 'success');
        });
      } else {
        shareInput.select();
        document.execCommand('copy');
        showToast('📋 Đã sao chép link mời!', 'success');
      }
    }
  });

  // Đầu hàng
  document.getElementById('btn-surrender')?.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn đầu hàng ván đấu này?')) {
      if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
        const winner = mySide === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
        const msg = `Phe ${mySide === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} đã chủ động đầu hàng!`;
        playhtmlAdapter.notifyGameOver(winner, msg);
        handleGameOver(winner, msg);
      } else {
        const winner = currentTurn === GameRules.SIDES.RED ? GameRules.SIDES.BLUE : GameRules.SIDES.RED;
        handleGameOver(winner, `Phe ${currentTurn === GameRules.SIDES.RED ? 'Đỏ' : 'Xanh'} đã chủ động đầu hàng!`);
      }
    }
  });

  // Rời phòng về sảnh chờ
  document.getElementById('btn-leave-arena')?.addEventListener('click', () => {
    if (confirm('Rời khỏi trận đấu và quay về sảnh chính?')) {
      if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
        playhtmlAdapter.leaveRoom();
      }
      stopLocalTimer();
      showView('lobby');
      fetchAndRenderLobbyRooms();
    }
  });

  // Đấu lại (Rematch)
  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
      const freshBoard = new ClientBoard();
      playhtmlAdapter.requestRematch(freshBoard.grid);
    } else {
      gameOverModal.classList.remove('active');
      resetGameBoard();
      startLocalTimer();
    }
  });

  document.getElementById('btn-close-game-over')?.addEventListener('click', () => {
    gameOverModal.classList.remove('active');
    showView('lobby');
    fetchAndRenderLobbyRooms();
  });

  // Bật/tắt âm thanh
  document.getElementById('btn-sound-toggle')?.addEventListener('click', (e) => {
    const isMuted = sounds.toggleMute();
    e.currentTarget.textContent = isMuted ? '🔇 Tắt tiếng' : '🔊 Âm thanh';
  });

  // Hướng dẫn luật chơi
  document.getElementById('btn-rules-modal')?.addEventListener('click', () => {
    rulesModal.classList.add('active');
  });

  document.getElementById('btn-close-rules')?.addEventListener('click', () => {
    rulesModal.classList.remove('active');
  });

  // Gửi tin nhắn Chat
  const sendChatMessage = () => {
    const text = chatInputEl.value.trim();
    if (!text) return;
    if (currentMode === CONFIG.GAME_MODES.PLAYHTML) {
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

  // 12. KHỞI TẠO DISCOVERY SẢNH CHỜ
  initLobbyRoomDiscovery();

  // 13. TỰ ĐỘNG THAM GIA PHÒNG NẾU URL CHỨA ?room=
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    setTimeout(() => {
      startPlayhtmlRoom(roomParam, false);
    }, 300);
  }
});

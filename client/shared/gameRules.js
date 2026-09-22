/**
 * OTTv2 (Oẳn Tù Tì v2) - Shared Game Engine & Rules Module
 * Tương thích cả Node.js (CommonJS/Backend) và Browser (UMD/Frontend)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GameRules = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 1. HẰNG SỐ CƠ BẢN
  const BOARD_SIZE = 9;

  const SIDES = Object.freeze({
    RED: 'RED',
    BLUE: 'BLUE'
  });

  const PIECE_TYPES = Object.freeze({
    ROCK: 'ROCK',         // Đấm / Búa
    PAPER: 'PAPER',       // Lá / Bao
    SCISSORS: 'SCISSORS'  // Kéo
  });

  // Tọa độ căn cứ (Base)
  // row 8: hàng 1, col 0: cột a -> a1 (Red Base)
  // row 0: hàng 9, col 8: cột i -> i9 (Blue Base)
  const BASES = Object.freeze({
    RED: { row: 8, col: 0, notation: 'a1' },
    BLUE: { row: 0, col: 8, notation: 'i9' }
  });

  // Tọa độ ô đặc biệt (Special Power Cells / Ô Thần Lực)
  // e5: tâm bàn cờ 9x9 (row 4, col 4)
  const SPECIAL_CELLS = Object.freeze([
    { row: 4, col: 4, notation: 'e5', name: 'Ô Thần Lực' }
  ]);

  /**
   * Kiểm tra toạ độ có phải là ô đặc biệt không
   * @param {number} r
   * @param {number} c
   * @returns {boolean}
   */
  function isSpecialCell(r, c) {
    return SPECIAL_CELLS.some(cell => cell.row === r && cell.col === c);
  }

  // 8 hướng di chuyển (4 trực giao + 4 chéo)
  const DIRECTIONS = Object.freeze([
    { dr: -1, dc: 0, name: 'UP' },
    { dr: 1, dc: 0, name: 'DOWN' },
    { dr: 0, dc: -1, name: 'LEFT' },
    { dr: 0, dc: 1, name: 'RIGHT' },
    { dr: -1, dc: -1, name: 'UP_LEFT' },
    { dr: -1, dc: 1, name: 'UP_RIGHT' },
    { dr: 1, dc: -1, name: 'DOWN_LEFT' },
    { dr: 1, dc: 1, name: 'DOWN_RIGHT' }
  ]);

  // Quy tắc khắc chế Oẳn Tù Tì
  const BEATS = Object.freeze({
    [PIECE_TYPES.ROCK]: PIECE_TYPES.SCISSORS,   // Đấm ăn Kéo
    [PIECE_TYPES.SCISSORS]: PIECE_TYPES.PAPER,  // Kéo ăn Lá
    [PIECE_TYPES.PAPER]: PIECE_TYPES.ROCK      // Lá ăn Đấm
  });

  /**
   * Kiểm tra quân tấn công có ăn được quân bị tấn công không
   * @param {string|Object} attacker - Loại quân hoặc object quân tấn công
   * @param {string|Object} defender - Loại quân hoặc object quân bị tấn công
   * @returns {boolean}
   */
  function canCapture(attacker, defender) {
    if (!attacker || !defender) return false;

    const attackerType = typeof attacker === 'object' ? attacker.type : attacker;
    const defenderType = typeof defender === 'object' ? defender.type : defender;
    const isAttackerEmpowered = typeof attacker === 'object' ? !!attacker.isEmpowered : false;
    const isDefenderEmpowered = typeof defender === 'object' ? !!defender.isEmpowered : false;

    // QUY TẮC QUÂN THẦN LỰC (ĐÃ ĂN CHỨC NĂNG Ô ĐẶC BIỆT):
    // 1. Nếu quân bị tấn công (defender) là quân Thần Lực:
    //    -> Quân thường ("không ăn ô đặc biệt") KHÔNG THỂ ăn được nó!
    //    -> Chỉ có quân cũng có Thần Lực mới ăn được quân Thần Lực!
    if (isDefenderEmpowered) {
      return isAttackerEmpowered;
    }

    // 2. Nếu quân tấn công (attacker) là quân Thần Lực:
    //    -> Ăn được mọi quân phòng thủ thường bất kể Đấm, Kéo hay Lá!
    if (isAttackerEmpowered) {
      return true;
    }

    // 3. Cả hai đều là quân thường: Tuân theo luật Oẳn Tù Tì chuẩn
    return BEATS[attackerType] === defenderType;
  }

  /**
   * Kiểm tra tọa độ có nằm trong bàn cờ 9x9 không
   * @param {number} r - Row (0-8)
   * @param {number} c - Col (0-8)
   * @returns {boolean}
   */
  function isValidPosition(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  /**
   * Chuyển đổi toạ độ (row, col) sang ký hiệu cờ (ví dụ: row 8, col 0 -> a1)
   * @param {number} row 
   * @param {number} col 
   * @returns {string}
   */
  function posToNotation(row, col) {
    if (!isValidPosition(row, col)) return '??';
    const colLetter = String.fromCharCode(97 + col); // 0 -> 'a'
    const rowNumber = 9 - row;                      // 0 -> 9, 8 -> 1
    return `${colLetter}${rowNumber}`;
  }

  /**
   * Chuyển đổi ký hiệu cờ sang toạ độ {row, col} (ví dụ: a1 -> {row: 8, col: 0})
   * @param {string} notation 
   * @returns {{row: number, col: number}|null}
   */
  function notationToPos(notation) {
    if (typeof notation !== 'string' || notation.length !== 2) return null;
    const colLetter = notation[0].toLowerCase();
    const rowNumber = parseInt(notation[1], 10);
    const col = colLetter.charCodeAt(0) - 97;
    const row = 9 - rowNumber;
    if (!isValidPosition(row, col)) return null;
    return { row, col };
  }

  /**
   * Khởi tạo bàn cờ 9x9 với vị trí mặc định của 2 phe
   * @returns {Array<Array<Object|null>>}
   */
  function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => null)
    );

    let idCounter = 1;
    const createPiece = (type, side) => ({
      id: `${side[0].toLowerCase()}_${type[0].toLowerCase()}_${idCounter++}`,
      type,
      side
    });

    // --- KHỞI TẠO PHE XANH (BLUE) Ở HÀNG TRÊN (row 0 và row 1) ---
    // Row 0 (rank 9): b9, d9, f9, h9 (i9 là căn cứ Xanh - để trống)
    board[0][1] = createPiece(PIECE_TYPES.ROCK, SIDES.BLUE);     // b9
    board[0][3] = createPiece(PIECE_TYPES.PAPER, SIDES.BLUE);    // d9
    board[0][5] = createPiece(PIECE_TYPES.SCISSORS, SIDES.BLUE); // f9
    board[0][7] = createPiece(PIECE_TYPES.ROCK, SIDES.BLUE);     // h9

    // Row 1 (rank 8): a8, c8, e8, g8, i8
    board[1][0] = createPiece(PIECE_TYPES.PAPER, SIDES.BLUE);    // a8
    board[1][2] = createPiece(PIECE_TYPES.SCISSORS, SIDES.BLUE); // c8
    board[1][4] = createPiece(PIECE_TYPES.ROCK, SIDES.BLUE);     // e8
    board[1][6] = createPiece(PIECE_TYPES.PAPER, SIDES.BLUE);    // g8
    board[1][8] = createPiece(PIECE_TYPES.SCISSORS, SIDES.BLUE); // i8

    // --- KHỞI TẠO PHE ĐỎ (RED) Ở HÀNG DƯỚI (row 7 và row 8) ---
    // Row 7 (rank 2): a2, c2, e2, g2, i2
    board[7][0] = createPiece(PIECE_TYPES.SCISSORS, SIDES.RED);  // a2
    board[7][2] = createPiece(PIECE_TYPES.PAPER, SIDES.RED);     // c2
    board[7][4] = createPiece(PIECE_TYPES.ROCK, SIDES.RED);      // e2
    board[7][6] = createPiece(PIECE_TYPES.SCISSORS, SIDES.RED);  // g2
    board[7][8] = createPiece(PIECE_TYPES.PAPER, SIDES.RED);     // i2

    // Row 8 (rank 1): b1, d1, f1, h1 (a1 là căn cứ Đỏ - để trống)
    board[8][1] = createPiece(PIECE_TYPES.ROCK, SIDES.RED);      // b1
    board[8][3] = createPiece(PIECE_TYPES.SCISSORS, SIDES.RED);  // d1
    board[8][5] = createPiece(PIECE_TYPES.PAPER, SIDES.RED);     // f1
    board[8][7] = createPiece(PIECE_TYPES.ROCK, SIDES.RED);      // h1

    return board;
  }

  /**
   * Lấy danh sách các nước đi hợp lệ của 1 quân tại (fromRow, fromCol)
   * @param {Array<Array<Object|null>>} board 
   * @param {number} fromRow 
   * @param {number} fromCol 
   * @returns {Array<{row: number, col: number, isCapture: boolean, targetPiece: Object|null}>}
   */
  function getValidMoves(board, fromRow, fromCol) {
    if (!isValidPosition(fromRow, fromCol)) return [];
    const piece = board[fromRow][fromCol];
    if (!piece) return [];

    const validMoves = [];
    const isFromSpecial = isSpecialCell(fromRow, fromCol);

    for (const dir of DIRECTIONS) {
      const toRow = fromRow + dir.dr;
      const toCol = fromCol + dir.dc;

      if (!isValidPosition(toRow, toCol)) continue;

      const targetPiece = board[toRow][toCol];
      const isToSpecial = isSpecialCell(toRow, toCol);

      if (!targetPiece) {
        // Ô trống: Đi được 1 ô theo hướng bất kỳ
        validMoves.push({
          row: toRow,
          col: toCol,
          isCapture: false,
          targetPiece: null
        });
      } else {
        // Ô có quân:
        if (targetPiece.side === piece.side) {
          // Cùng phe: Không thể đi vào
          continue;
        } else {
          // Khác phe:
          // Nếu quân đang đứng ở ô đặc biệt thì tạm thời kích hoạt Thần Lực
          const effectiveAttacker = (isFromSpecial && !piece.isEmpowered)
            ? { ...piece, isEmpowered: true }
            : piece;

          if (canCapture(effectiveAttacker, targetPiece)) {
            validMoves.push({
              row: toRow,
              col: toCol,
              isCapture: true,
              targetPiece: targetPiece
            });
          }
        }
      }
    }

    return validMoves;
  }

  /**
   * Lấy toàn bộ các nước đi hợp lệ của một phe trên toàn bàn cờ
   * @param {Array<Array<Object|null>>} board 
   * @param {string} side - 'RED' hoặc 'BLUE'
   * @returns {Array<{from: {row: number, col: number}, to: {row: number, col: number}, isCapture: boolean, piece: Object}>}
   */
  function getAllValidMoves(board, side) {
    const allMoves = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = board[r][c];
        if (piece && piece.side === side) {
          const moves = getValidMoves(board, r, c);
          for (const m of moves) {
            allMoves.push({
              from: { row: r, col: c },
              to: { row: m.row, col: m.col },
              isCapture: m.isCapture,
              piece: piece
            });
          }
        }
      }
    }
    return allMoves;
  }

  /**
   * Đếm số lượng quân của mỗi bên trên bàn cờ
   * @param {Array<Array<Object|null>>} board 
   * @returns {{ RED: number, BLUE: number, pieces: { RED: Array, BLUE: Array } }}
   */
  function countPieces(board) {
    let redCount = 0;
    let blueCount = 0;
    const redPieces = [];
    const bluePieces = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const piece = board[r][c];
        if (piece) {
          if (piece.side === SIDES.RED) {
            redCount++;
            redPieces.push({ piece, pos: { row: r, col: c } });
          } else if (piece.side === SIDES.BLUE) {
            blueCount++;
            bluePieces.push({ piece, pos: { row: r, col: c } });
          }
        }
      }
    }

    return {
      RED: redCount,
      BLUE: blueCount,
      pieces: { RED: redPieces, BLUE: bluePieces }
    };
  }

  /**
   * Kiểm tra điều kiện kết thúc trò chơi
   * @param {Array<Array<Object|null>>} board 
   * @param {string} nextTurnSide - Phe chuẩn bị đi tiếp theo
   * @returns {{ isGameOver: boolean, winner: string|null, reason: string|null, message: string }}
   */
  function checkGameOver(board, nextTurnSide) {
    // 1. Kiểm tra Chiếm căn cứ (Base Invasion)
    // Red Base: a1 (row 8, col 0). Nếu có quân BLUE ở đây -> BLUE thắng.
    const redBaseCell = board[BASES.RED.row][BASES.RED.col];
    if (redBaseCell && redBaseCell.side === SIDES.BLUE) {
      return {
        isGameOver: true,
        winner: SIDES.BLUE,
        reason: 'BASE_INVADED',
        message: 'Phe Xanh đã chiếm căn cứ a1 của Đỏ và giành chiến thắng!'
      };
    }

    // Blue Base: i9 (row 0, col 8). Nếu có quân RED ở đây -> RED thắng.
    const blueBaseCell = board[BASES.BLUE.row][BASES.BLUE.col];
    if (blueBaseCell && blueBaseCell.side === SIDES.RED) {
      return {
        isGameOver: true,
        winner: SIDES.RED,
        reason: 'BASE_INVADED',
        message: 'Phe Đỏ đã chiếm căn cứ i9 của Xanh và giành chiến thắng!'
      };
    }

    // 2. Kiểm tra Ăn hết quân (Annihilation)
    const counts = countPieces(board);
    if (counts.RED === 0) {
      return {
        isGameOver: true,
        winner: SIDES.BLUE,
        reason: 'ALL_PIECES_CAPTURED',
        message: 'Phe Đỏ đã bị tiêu diệt toàn bộ quân! Phe Xanh thắng cuộc!'
      };
    }
    if (counts.BLUE === 0) {
      return {
        isGameOver: true,
        winner: SIDES.RED,
        reason: 'ALL_PIECES_CAPTURED',
        message: 'Phe Xanh đã bị tiêu diệt toàn bộ quân! Phe Đỏ thắng cuộc!'
      };
    }

    // 3. Kiểm tra Hết nước đi hợp lệ (No Valid Moves)
    if (nextTurnSide) {
      const nextMoves = getAllValidMoves(board, nextTurnSide);
      if (nextMoves.length === 0) {
        const winner = nextTurnSide === SIDES.RED ? SIDES.BLUE : SIDES.RED;
        return {
          isGameOver: true,
          winner: winner,
          reason: 'NO_VALID_MOVES',
          message: `Phe ${nextTurnSide === SIDES.RED ? 'Đỏ' : 'Xanh'} không còn nước đi hợp lệ! Phe ${winner === SIDES.RED ? 'Đỏ' : 'Xanh'} thắng cuộc!`
        };
      }
    }

    return {
      isGameOver: false,
      winner: null,
      reason: null,
      message: ''
    };
  }

  /**
   * Tạo bản sao sâu của bàn cờ
   * @param {Array<Array<Object|null>>} board 
   * @returns {Array<Array<Object|null>>}
   */
  function cloneBoard(board) {
    return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
  }

  return {
    BOARD_SIZE,
    SIDES,
    PIECE_TYPES,
    BASES,
    SPECIAL_CELLS,
    isSpecialCell,
    DIRECTIONS,
    BEATS,
    canCapture,
    isValidPosition,
    posToNotation,
    notationToPos,
    createInitialBoard,
    getValidMoves,
    getAllValidMoves,
    countPieces,
    checkGameOver,
    cloneBoard
  };
}));

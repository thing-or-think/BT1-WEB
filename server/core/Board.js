/**
 * Lớp quản lý bàn cờ 9x9 của OTTv2 phía Server
 */
const {
  BOARD_SIZE,
  createInitialBoard,
  isValidPosition,
  cloneBoard,
  countPieces,
  isSpecialCell
} = require('../../shared/gameRules');

class Board {
  constructor() {
    this.grid = createInitialBoard();
  }

  /**
   * Đặt lại bàn cờ về vị trí ban đầu
   */
  reset() {
    this.grid = createInitialBoard();
  }

  /**
   * Lấy quân cờ tại toạ độ (row, col)
   * @param {number} row 
   * @param {number} col 
   * @returns {Object|null}
   */
  getPiece(row, col) {
    if (!isValidPosition(row, col)) return null;
    return this.grid[row][col];
  }

  /**
   * Đặt quân cờ vào toạ độ (row, col)
   * @param {number} row 
   * @param {number} col 
   * @param {Object|null} piece 
   */
  setPiece(row, col, piece) {
    if (!isValidPosition(row, col)) return false;
    this.grid[row][col] = piece;
    return true;
  }

  /**
   * Thực hiện di chuyển quân cờ từ (fromRow, fromCol) đến (toRow, toCol)
   * @param {number} fromRow 
   * @param {number} fromCol 
   * @param {number} toRow 
   * @param {number} toCol 
   * @returns {{ movedPiece: Object, capturedPiece: Object|null } | null}
   */
  movePiece(fromRow, fromCol, toRow, toCol) {
    if (!isValidPosition(fromRow, fromCol) || !isValidPosition(toRow, toCol)) {
      return null;
    }

    const movedPiece = this.grid[fromRow][fromCol];
    if (!movedPiece) return null;

    const capturedPiece = this.grid[toRow][toCol];

    // Nếu đi vào ô đặc biệt, quân nhận được Thần Lực (ăn mọi quân cờ)
    if (movedPiece && isSpecialCell && isSpecialCell(toRow, toCol)) {
      movedPiece.isEmpowered = true;
    }

    // Di chuyển quân
    this.grid[toRow][toCol] = movedPiece;
    this.grid[fromRow][fromCol] = null;

    return {
      movedPiece,
      capturedPiece
    };
  }

  /**
   * Lấy bản sao trạng thái bàn cờ hiện tại
   * @returns {Array<Array<Object|null>>}
   */
  getState() {
    return cloneBoard(this.grid);
  }

  /**
   * Đếm số lượng quân của mỗi bên
   */
  getStats() {
    return countPieces(this.grid);
  }
}

module.exports = Board;

/**
 * Client Board Class
 */
class ClientBoard {
  constructor() {
    this.grid = GameRules.createInitialBoard();
  }

  reset() {
    this.grid = GameRules.createInitialBoard();
  }

  setState(serverGrid) {
    this.grid = GameRules.cloneBoard(serverGrid);
  }

  getPiece(row, col) {
    if (!GameRules.isValidPosition(row, col)) return null;
    return this.grid[row][col];
  }

  applyMove(from, to) {
    const movedPiece = this.grid[from.row][from.col];
    const capturedPiece = this.grid[to.row][to.col];

    if (movedPiece && GameRules.isSpecialCell && GameRules.isSpecialCell(to.row, to.col)) {
      movedPiece.isEmpowered = true;
    }

    this.grid[to.row][to.col] = movedPiece;
    this.grid[from.row][from.col] = null;

    return { movedPiece, capturedPiece };
  }

  getStats() {
    return GameRules.countPieces(this.grid);
  }
}

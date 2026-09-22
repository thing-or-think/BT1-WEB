/**
 * Client Rules & AI Logic Helper
 */
class ClientRules {
  /**
   * Lấy các nước đi hợp lệ của 1 ô
   */
  static getValidMoves(boardGrid, row, col) {
    return GameRules.getValidMoves(boardGrid, row, col);
  }

  /**
   * Lấy toàn bộ nước đi hợp lệ của một phe
   */
  static getAllValidMoves(boardGrid, side) {
    return GameRules.getAllValidMoves(boardGrid, side);
  }

  /**
   * Kiểm tra điều kiện thắng/thua
   */
  static checkGameOver(boardGrid, nextTurnSide) {
    return GameRules.checkGameOver(boardGrid, nextTurnSide);
  }

  /**
   * Thuật toán AI Bot lựa chọn nước đi thông minh
   * @param {Array<Array<Object|null>>} boardGrid 
   * @param {string} botSide - Thường là 'BLUE'
   * @returns {{ from: {row, col}, to: {row, col} } | null}
   */
  static getBestAiMove(boardGrid, botSide) {
    const allMoves = GameRules.getAllValidMoves(boardGrid, botSide);
    if (allMoves.length === 0) return null;

    const targetBase = botSide === GameRules.SIDES.BLUE ? GameRules.BASES.RED : GameRules.BASES.BLUE;

    // Đánh giá điểm số cho từng nước đi:
    const scoredMoves = allMoves.map(move => {
      let score = 0;

      // 1. Nếu đi vào chiếm được căn cứ đối phương -> Ưu tiên tuyệt đối (+1000 điểm)
      if (move.to.row === targetBase.row && move.to.col === targetBase.col) {
        score += 1000;
      }

      // 1.5. Nếu chiếm được Ô Thần Lực (e5) -> Rất giá trị (+80 điểm)
      if (GameRules.isSpecialCell && GameRules.isSpecialCell(move.to.row, move.to.col)) {
        score += 80;
      }

      // 2. Nếu ăn được quân đối phương -> Điểm cao (+50 điểm)
      if (move.isCapture) {
        score += 50;
      }

      // 3. Tiến gần hơn tới căn cứ mục tiêu (khoảng cách Manhattan)
      const currentDist = Math.abs(move.from.row - targetBase.row) + Math.abs(move.from.col - targetBase.col);
      const nextDist = Math.abs(move.to.row - targetBase.row) + Math.abs(move.to.col - targetBase.col);
      if (nextDist < currentDist) {
        score += 10;
      }

      // 4. Tránh bị ăn ở ô đích (giả lập 1 bước tiếp theo)
      const simulatedBoard = GameRules.cloneBoard(boardGrid);
      simulatedBoard[move.to.row][move.to.col] = move.piece;
      simulatedBoard[move.from.row][move.from.col] = null;

      const oppSide = botSide === GameRules.SIDES.BLUE ? GameRules.SIDES.RED : GameRules.SIDES.BLUE;
      const oppResponses = GameRules.getAllValidMoves(simulatedBoard, oppSide);
      const willBeCaptured = oppResponses.some(oppMove => oppMove.to.row === move.to.row && oppMove.to.col === move.to.col);

      if (willBeCaptured) {
        score -= 40;
      }

      // Thêm chút ngẫu nhiên để Bot không đi theo lối mòn
      score += Math.random() * 5;

      return { move, score };
    });

    // Sắp xếp điểm giảm dần và chọn nước tốt nhất
    scoredMoves.sort((a, b) => b.score - a.score);
    return scoredMoves[0].move;
  }
}

/**
 * Board Renderer: Trình dựng giao diện bàn cờ 9x9
 */
class BoardRenderer {
  /**
   * @param {HTMLElement} containerElement 
   * @param {Function} onCellClickCallback 
   */
  constructor(containerElement, onCellClickCallback) {
    this.container = containerElement;
    this.onCellClick = onCellClickCallback;
    this.cellElements = []; // Ma trận [9][9] lưu DOM elements
    this.isFlipped = false;  // Góc nhìn (Lật bàn cờ)

    this._buildDOM();
  }

  _buildDOM() {
    this.container.innerHTML = '';

    // Khung bàn cờ
    const boardWrapper = document.createElement('div');
    boardWrapper.className = 'board-wrapper';

    // Toạ độ hàng trên (a - i)
    const topCoords = document.createElement('div');
    topCoords.className = 'coords-row';
    this._renderColHeaders(topCoords);
    boardWrapper.appendChild(topCoords);

    // Lưới 9x9
    const grid = document.createElement('div');
    grid.className = 'board-grid';

    this.cellElements = Array.from({ length: CONFIG.BOARD_SIZE }, () =>
      Array.from({ length: CONFIG.BOARD_SIZE }, () => null)
    );

    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Đánh dấu ô căn cứ và ô đặc biệt
        if (r === GameRules.BASES.RED.row && c === GameRules.BASES.RED.col) {
          cell.classList.add('base-red');
        } else if (r === GameRules.BASES.BLUE.row && c === GameRules.BASES.BLUE.col) {
          cell.classList.add('base-blue');
        } else if (GameRules.isSpecialCell && GameRules.isSpecialCell(r, c)) {
          cell.classList.add('special-power-cell');
          cell.setAttribute('title', '⚡ Ô Thần Lực (e5): Đi vào có thể ăn mọi con bất kể quân gì!');
        }

        cell.addEventListener('click', () => {
          if (typeof this.onCellClick === 'function') {
            this.onCellClick(parseInt(cell.dataset.row, 10), parseInt(cell.dataset.col, 10));
          }
        });

        this.cellElements[r][c] = cell;
        grid.appendChild(cell);
      }
    }

    boardWrapper.appendChild(grid);

    // Toạ độ hàng dưới (a - i)
    const bottomCoords = document.createElement('div');
    bottomCoords.className = 'coords-row';
    this._renderColHeaders(bottomCoords);
    boardWrapper.appendChild(bottomCoords);

    this.container.appendChild(boardWrapper);
  }

  _renderColHeaders(container) {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const cols = this.isFlipped ? [...letters].reverse() : letters;
    cols.forEach(letter => {
      const span = document.createElement('span');
      span.textContent = letter;
      container.appendChild(span);
    });
  }

  /**
   * Cập nhật toàn bộ giao diện bàn cờ từ ma trận dữ liệu
   * @param {Array<Array<Object|null>>} boardGrid 
   */
  renderBoard(boardGrid) {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        const cellDom = this.cellElements[r][c];
        const pieceData = boardGrid[r][c];

        cellDom.innerHTML = '';

        if (pieceData) {
          const pieceDiv = document.createElement('div');
          pieceDiv.className = `piece ${pieceData.side.toLowerCase()}`;
          if (pieceData.isEmpowered) {
            pieceDiv.classList.add('empowered');
          }

          const img = document.createElement('img');
          img.src = CONFIG.PIECE_ASSETS[pieceData.side][pieceData.type];
          img.alt = `${pieceData.side} ${pieceData.type}`;
          img.draggable = false;

          pieceDiv.appendChild(img);

          // Nếu quân đã kích hoạt Thần Lực -> Hiển thị huy hiệu sét hoàng kim
          if (pieceData.isEmpowered) {
            const badge = document.createElement('span');
            badge.className = 'empowered-badge';
            badge.textContent = '⚡';
            badge.title = 'Quân Thần Lực: Có thể ăn mọi loại quân đối phương!';
            pieceDiv.appendChild(badge);
          }

          cellDom.appendChild(pieceDiv);
        } else {
          // Ô trống đặc biệt: Hiển thị biểu tượng thần lực phát sáng
          if (GameRules.isSpecialCell && GameRules.isSpecialCell(r, c)) {
            const powerIcon = document.createElement('div');
            powerIcon.className = 'special-cell-icon';
            powerIcon.innerHTML = '⚡';
            cellDom.appendChild(powerIcon);
          }
        }
      }
    }
  }

  /**
   * Đánh dấu ô đang được chọn
   */
  highlightSelected(row, col) {
    this.clearHighlights();
    if (row !== null && col !== null && this.cellElements[row] && this.cellElements[row][col]) {
      this.cellElements[row][col].classList.add('selected');
    }
  }

  /**
   * Đánh dấu các ô đi được hợp lệ (Gợi ý 8 hướng)
   * @param {Array<{row: number, col: number, isCapture: boolean}>} validMoves 
   */
  showValidMoves(validMoves) {
    validMoves.forEach(m => {
      const cellDom = this.cellElements[m.row][m.col];
      if (cellDom) {
        if (m.isCapture) {
          cellDom.classList.add('valid-capture');
        } else {
          cellDom.classList.add('valid-move');
        }
      }
    });
  }

  /**
   * Đánh dấu nước đi vừa thực hiện (Last move)
   */
  highlightLastMove(from, to) {
    // Xoá highlight cũ
    document.querySelectorAll('.last-move-from, .last-move-to').forEach(el => {
      el.classList.remove('last-move-from', 'last-move-to');
    });

    if (from && this.cellElements[from.row] && this.cellElements[from.row][from.col]) {
      this.cellElements[from.row][from.col].classList.add('last-move-from');
    }
    if (to && this.cellElements[to.row] && this.cellElements[to.row][to.col]) {
      this.cellElements[to.row][to.col].classList.add('last-move-to');
    }
  }

  /**
   * Xoá mọi hiệu ứng highlight chọn/gợi ý
   */
  clearHighlights() {
    for (let r = 0; r < CONFIG.BOARD_SIZE; r++) {
      for (let c = 0; c < CONFIG.BOARD_SIZE; c++) {
        this.cellElements[r][c].classList.remove('selected', 'valid-move', 'valid-capture');
      }
    }
  }
}

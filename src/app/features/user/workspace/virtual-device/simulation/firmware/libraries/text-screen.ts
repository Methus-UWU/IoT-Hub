import { formatPrint, type FirmwareValue } from '../firmware-values';

/**
 * A grid of character cells that `print` writes into at a cursor.
 *
 * Both displays reduce to this: an LCD is one by construction, and a text-only
 * SSD1306 sketch places text on a pixel cursor that maps onto the glass's rows.
 */
export class TextScreen {
  private cells: string[][];
  column = 0;
  row = 0;

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.cells = this.blank();
  }

  clear(): void {
    this.cells = this.blank();
    this.column = 0;
    this.row = 0;
  }

  moveTo(column: number, row: number): void {
    this.column = Math.max(0, Math.trunc(column));
    this.row = Math.max(0, Math.trunc(row));
  }

  /** Writes text at the cursor; `wrap` continues a long line on the next row. */
  write(text: string, wrap: boolean, lineHeight = 1, charWidth = 1): void {
    for (const character of text) {
      if (character === '\n') {
        this.column = 0;
        this.row += lineHeight;
        continue;
      }
      if (character === '\r') continue;
      if (this.column >= this.columns) {
        if (!wrap) continue;
        this.column = 0;
        this.row += lineHeight;
      }
      if (this.row < this.rows) this.cells[this.row][this.column] = character;
      this.column += charWidth;
    }
  }

  /** Places one character at a cell, ignoring cells off the glass. */
  put(column: number, row: number, character: string): void {
    if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) return;
    this.cells[row][column] = character;
  }

  print(args: readonly FirmwareValue[]): string {
    return formatPrint(args[0], args[1]);
  }

  lines(): string[] {
    return this.cells.map((row) => row.join('').replace(/\s+$/, ''));
  }

  private blank(): string[][] {
    return Array.from({ length: this.rows }, () => new Array<string>(this.columns).fill(' '));
  }
}

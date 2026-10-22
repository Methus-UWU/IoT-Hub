import {
  formatPrint,
  numeric,
  truthy,
  type FirmwareValue,
  type LibraryHost,
} from '../firmware-values';
import { accept, hexAddress, libraryObject, type LibraryDefinition } from './library-support';

/** Adafruit GFX's built-in font: a 5×7 glyph in a 6×8 cell at text size 1. */
const CHAR_W = 6;
const CHAR_H = 8;
const GLYPH_W = 5;
const GLYPH_H = 7;

/**
 * Adafruit SSD1306 with the GFX text API.
 *
 * Text lands on the panel's own 128×64 pixel grid, where the cursor puts it, in
 * the 6×8 cell of the built-in font, and appears when the sketch calls
 * `display()`, as on the real panel. A glyph that would fall off the panel is
 * not drawn, so a line too long for the screen is cut at the edge (or wrapped, as
 * `setTextWrap` says) exactly where the real one is. `begin()` finds the panel only if an OLED at that address is
 * powered and wired to the board's SDA, so a miswired display fails the same
 * `if (!display.begin(...))` check it would on the bench. Shapes (lines, boxes,
 * bitmaps) are accepted but not drawn: the part renders text rows, not pixels.
 */
export const SSD1306_LIBRARY: LibraryDefinition = {
  constants: {
    SSD1306_SWITCHCAPVCC: 2,
    SSD1306_EXTERNALVCC: 1,
    SSD1306_WHITE: 1,
    SSD1306_BLACK: 0,
    SSD1306_INVERSE: 2,
    WHITE: 1,
    BLACK: 0,
    INVERSE: 2,
  },
  classes: {
    Adafruit_SSD1306: (args, host, line) => createDisplay(args, host, line),
  },
};

function createDisplay(args: readonly FirmwareValue[], host: LibraryHost, line: number) {
  // (width, height, &Wire, reset) — or the legacy (reset) form, which is 128×64.
  const width = args.length >= 2 ? numeric(args[0], line) : 128;
  const height = args.length >= 2 ? numeric(args[1], line) : 64;
  /** Lit glyphs by pixel position; a later glyph in the same cell replaces it. */
  let glyphs = new Map<string, { x: number; y: number; size: number; character: string }>();
  let address = 0x3c;
  let x = 0;
  let y = 0;
  let size = 1;
  let wrap = true;
  let found = false;

  const write = (text: string) => {
    for (const character of text) {
      if (character === '\n') {
        x = 0;
        y += CHAR_H * size;
        continue;
      }
      if (character === '\r') continue;
      if (wrap && x + CHAR_W * size > width) {
        x = 0;
        y += CHAR_H * size;
      }
      const onPanel =
        x >= 0 && y >= 0 && x + GLYPH_W * size <= width && y + GLYPH_H * size <= height;
      if (onPanel && character !== ' ') {
        glyphs.set(`${x},${y}`, { x, y, size, character });
      } else if (onPanel) {
        glyphs.delete(`${x},${y}`);
      }
      x += CHAR_W * size;
    }
  };

  return libraryObject('Adafruit_SSD1306', {
    begin: (callArgs, callLine) => {
      if (callArgs[1] !== undefined) address = numeric(callArgs[1], callLine);
      const sda = host.i2cPins().sda;
      found =
        !!sda &&
        host
          .messages(sda)
          .some(
            (message) =>
              message.protocol === 'i2c-device' &&
              message.data['chip'] === 'ssd1306' &&
              message.data['address'] === hexAddress(address),
          );
      return found;
    },
    clearDisplay: () => {
      glyphs = new Map();
      return 0;
    },
    display: () => {
      const sda = host.i2cPins().sda;
      if (sda && found) {
        host.publish(sda, `ssd1306:${address}`, 'ssd1306', {
          address: hexAddress(address),
          width,
          height,
          runs: toRuns([...glyphs.values()]),
        });
      }
      return 0;
    },
    setCursor: (callArgs, callLine) => {
      x = numeric(callArgs[0], callLine);
      y = numeric(callArgs[1], callLine);
      return 0;
    },
    getCursorX: () => x,
    getCursorY: () => y,
    setTextSize: (callArgs, callLine) => {
      size = Math.max(1, Math.trunc(numeric(callArgs[0], callLine)));
      return 0;
    },
    setTextWrap: (callArgs) => {
      wrap = truthy(callArgs[0]);
      return 0;
    },
    print: (callArgs) => {
      write(formatPrint(callArgs[0], callArgs[1]));
      return 0;
    },
    println: (callArgs) => {
      write(`${callArgs.length ? formatPrint(callArgs[0], callArgs[1]) : ''}\n`);
      return 0;
    },
    write: (callArgs, callLine) => {
      const value = callArgs[0];
      write(
        typeof value === 'number'
          ? String.fromCharCode(numeric(value, callLine))
          : formatPrint(value, undefined),
      );
      return 1;
    },
    width: () => width,
    height: () => height,
    setTextColor: accept,
    setFont: accept,
    cp437: accept,
    setRotation: accept,
    invertDisplay: accept,
    dim: accept,
    ssd1306_command: accept,
    startscrollright: accept,
    startscrollleft: accept,
    startscrolldiagright: accept,
    startscrolldiagleft: accept,
    stopscroll: accept,
    drawPixel: accept,
    drawLine: accept,
    drawFastHLine: accept,
    drawFastVLine: accept,
    drawRect: accept,
    fillRect: accept,
    drawRoundRect: accept,
    fillRoundRect: accept,
    drawCircle: accept,
    fillCircle: accept,
    drawTriangle: accept,
    fillTriangle: accept,
    drawBitmap: accept,
    fillScreen: (callArgs, callLine) => {
      if (numeric(callArgs[0], callLine) === 0) glyphs = new Map();
      return 0;
    },
  });
}

/**
 * Glyphs joined into horizontal runs of text, `x|y|size|text`, which is what the
 * OLED part draws. A run breaks wherever the next glyph is not in the next cell.
 */
function toRuns(
  glyphs: readonly { x: number; y: number; size: number; character: string }[],
): string[] {
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  const runs: { x: number; y: number; size: number; text: string; nextX: number }[] = [];
  for (const glyph of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.y === glyph.y && last.size === glyph.size && last.nextX === glyph.x) {
      last.text += glyph.character;
      last.nextX += CHAR_W * glyph.size;
    } else {
      runs.push({ ...glyph, text: glyph.character, nextX: glyph.x + CHAR_W * glyph.size });
    }
  }
  return runs.map((run) => `${run.x}|${run.y}|${run.size}|${run.text}`);
}

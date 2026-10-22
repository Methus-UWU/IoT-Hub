import {
  FirmwareRuntimeError,
  formatPrint,
  numeric,
  type FirmwareValue,
  type LibraryHost,
} from '../firmware-values';
import { TextScreen } from './text-screen';
import { accept, hexAddress, libraryObject, type LibraryDefinition } from './library-support';

/**
 * LiquidCrystal_I2C: `LiquidCrystal_I2C lcd(0x27, 16, 2); lcd.print("hi")`.
 *
 * Every change is sent at once, as the character LCD shows it immediately; there
 * is no `display()` step. The module on the canvas shows the text only while it is
 * powered, which is what a real one does.
 */
export const LCD_I2C_LIBRARY: LibraryDefinition = {
  classes: {
    LiquidCrystal_I2C: (args, host, line) => createLcd(args, host, line),
  },
};

function createLcd(args: readonly FirmwareValue[], host: LibraryHost, line: number) {
  // The library talks on Wire and takes no bus argument; a sketch that passes
  // &Wire1 does not compile against it, and would not reach a second bus anyway.
  if (args.length > 3) {
    throw new FirmwareRuntimeError(
      'LiquidCrystal_I2C รับแค่ (address, cols, rows) และใช้บัส Wire เสมอ — ต่อจอทุกจอบน SDA/SCL เดียวกันแล้วแยกด้วย address',
      line,
    );
  }
  const address = numeric(args[0] ?? 0x27, line);
  const screen = new TextScreen(
    Math.max(1, numeric(args[1] ?? 16, line)),
    Math.max(1, numeric(args[2] ?? 2, line)),
  );
  let backlight = true;

  const send = () => {
    const sda = host.i2cPins().sda;
    if (!sda) return 0;
    host.publish(sda, `lcd:${address}`, 'lcd', {
      address: hexAddress(address),
      lines: screen.lines(),
      backlight,
    });
    return 0;
  };

  return libraryObject('LiquidCrystal_I2C', {
    init: send,
    begin: send,
    clear: () => {
      screen.clear();
      return send();
    },
    home: () => {
      screen.moveTo(0, 0);
      return 0;
    },
    setCursor: (callArgs, callLine) => {
      screen.moveTo(numeric(callArgs[0], callLine), numeric(callArgs[1], callLine));
      return 0;
    },
    print: (callArgs) => {
      screen.write(formatPrint(callArgs[0], callArgs[1]), false);
      return send();
    },
    // An HD44780 has no newline: println prints the text and two junk characters.
    println: (callArgs) => {
      screen.write(formatPrint(callArgs[0], callArgs[1]), false);
      return send();
    },
    write: (callArgs, callLine) => {
      const value = callArgs[0];
      screen.write(
        typeof value === 'number'
          ? String.fromCharCode(numeric(value, callLine))
          : formatPrint(value, undefined),
        false,
      );
      return send();
    },
    backlight: () => {
      backlight = true;
      return send();
    },
    noBacklight: () => {
      backlight = false;
      return send();
    },
    setBacklight: (callArgs, callLine) => {
      backlight = numeric(callArgs[0], callLine) !== 0;
      return send();
    },
    display: accept,
    noDisplay: accept,
    cursor: accept,
    noCursor: accept,
    blink: accept,
    noBlink: accept,
    createChar: accept,
    scrollDisplayLeft: accept,
    scrollDisplayRight: accept,
    leftToRight: accept,
    rightToLeft: accept,
    autoscroll: accept,
    noAutoscroll: accept,
  });
}

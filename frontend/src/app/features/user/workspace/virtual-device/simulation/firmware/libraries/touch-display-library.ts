import { FirmwareRuntimeError, formatPrint, numeric } from '../firmware-values';
import {
  libraryObject,
  libraryRecord,
  requirePin,
  type LibraryDefinition,
} from './library-support';
import { busReply, sendBus } from './multi-pin-library';
import { TextScreen } from './text-screen';

function color565(value: number): string {
  const rgb = [
    Math.round((((value >> 11) & 31) * 255) / 31),
    Math.round((((value >> 5) & 63) * 255) / 63),
    Math.round(((value & 31) * 255) / 31),
  ];
  return '#' + rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('');
}

export const TOUCH_DISPLAY_LIBRARY: LibraryDefinition = {
  constants: {
    ILI9341_BLACK: 0,
    ILI9341_WHITE: 65535,
    ILI9341_RED: 63488,
    ILI9341_GREEN: 2016,
    ILI9341_BLUE: 31,
  },
  classes: {
    Adafruit_ILI9341: (args, host, line) => {
      if (args.length > 3)
        throw new FirmwareRuntimeError(
          'ตัวจำลองใช้ Adafruit_ILI9341(CS, DC, RST) กับ hardware SPI',
          line,
        );
      const select = requirePin(host, args[0], 'Adafruit_ILI9341', line),
        dc = requirePin(host, args[1], 'Adafruit_ILI9341', line);
      const screen = new TextScreen(40, 40);
      let background = '#000000',
        foreground = '#ffffff';
      const send = () => {
        const { clock, mosi } = host.spiPins();
        return sendBus(host, { select, dc, clock, mosi }, 'ili9341-frame', {
          screen: screen.lines().join('\n'),
          background,
          foreground,
        });
      };
      return libraryObject('Adafruit_ILI9341', {
        begin: send,
        fillScreen: (a, l) => {
          background = color565(numeric(a[0], l));
          screen.clear();
          return send();
        },
        setCursor: (a, l) => {
          screen.moveTo(Math.floor(numeric(a[0], l) / 6), Math.floor(numeric(a[1], l) / 8));
          return 0;
        },
        setTextSize: (a, l) => {
          if (numeric(a[0], l) !== 1)
            throw new FirmwareRuntimeError('ตัวจำลอง TFT รองรับ text size 1', l);
          return 0;
        },
        setRotation: (a, l) => {
          if (numeric(a[0], l) !== 0)
            throw new FirmwareRuntimeError('ตัวจำลอง TFT รองรับ portrait rotation 0', l);
          return 0;
        },
        setTextColor: (a, l) => {
          foreground = color565(numeric(a[0], l));
          return 0;
        },
        print: (a) => {
          screen.write(formatPrint(a[0], a[1]), true);
          return send();
        },
        println: (a) => {
          screen.write(formatPrint(a[0], a[1]) + '\n', true);
          return send();
        },
        width: () => 240,
        height: () => 320,
      });
    },
    XPT2046_Touchscreen: (args, host, line) => {
      const select = requirePin(host, args[0], 'XPT2046_Touchscreen', line);
      let rotation = 1;
      const reply = () => busReply(host, { select, ...host.spiPins() }, 'xpt2046');
      return libraryObject('XPT2046_Touchscreen', {
        begin: () => !!reply(),
        touched: () => !!reply()?.data['touched'],
        setRotation: (a, l) => {
          rotation = numeric(a[0], l) & 3;
          return 0;
        },
        getPoint: () => {
          const message = reply();
          let x = Number(message?.data['x'] ?? 0),
            y = Number(message?.data['y'] ?? 0);
          if (rotation === 0) [x, y] = [4095 - y, x];
          if (rotation === 2) [x, y] = [y, 4095 - x];
          if (rotation === 3) [x, y] = [4095 - x, 4095 - y];
          return libraryRecord('TS_Point', { x, y, z: message?.data['touched'] ? 1000 : 0 });
        },
      });
    },
  },
};

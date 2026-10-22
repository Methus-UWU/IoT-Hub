import { FirmwareRuntimeError, numeric, truthy } from '../firmware-values';
import { libraryObject, requirePin, type LibraryDefinition } from './library-support';
import { sendBus } from './multi-pin-library';

const DIGITS = [
  0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71,
];
const bounded = (value: number, max: number) => Math.max(0, Math.min(max, Math.trunc(value)));

export const LED_DISPLAYS_LIBRARY: LibraryDefinition = {
  constants: {
    SEG_A: 1,
    SEG_B: 2,
    SEG_C: 4,
    SEG_D: 8,
    SEG_E: 16,
    SEG_F: 32,
    SEG_G: 64,
    SEG_DP: 128,
  },
  classes: {
    TM1637Display: (args, host, line) => {
      const pins = {
        clock: requirePin(host, args[0], 'TM1637Display', line),
        data: requirePin(host, args[1], 'TM1637Display', line),
      };
      const digits = [0, 0, 0, 0];
      let brightness = 7;
      let enabled = true;
      const send = () =>
        sendBus(host, pins, 'tm1637-frame', { segments: digits.join(','), brightness, enabled });
      const number = (value: number, dots: number, zeros: boolean, length: number, pos: number) => {
        const size = bounded(length, 4);
        const start = bounded(pos, 3);
        const text = String(Math.trunc(value))
          .padStart(size, zeros && value >= 0 ? '0' : ' ')
          .slice(-size);
        for (let i = 0; i < size && start + i < 4; i++)
          digits[start + i] =
            (text[i] === '-' ? 64 : text[i] === ' ' ? 0 : DIGITS[Number(text[i])]) |
            (dots & (128 >> i) ? 128 : 0);
        return send();
      };
      return libraryObject('TM1637Display', {
        setBrightness: (a, l) => {
          brightness = bounded(numeric(a[0], l), 7);
          enabled = a[1] === undefined || truthy(a[1]);
          return 0;
        },
        showNumberDec: (a, l) =>
          number(numeric(a[0], l), 0, truthy(a[1]), numeric(a[2] ?? 4, l), numeric(a[3], l)),
        showNumberDecEx: (a, l) =>
          number(
            numeric(a[0], l),
            numeric(a[1], l),
            truthy(a[2]),
            numeric(a[3] ?? 4, l),
            numeric(a[4], l),
          ),
        encodeDigit: (a, l) => DIGITS[numeric(a[0], l) & 15],
        clear: () => {
          digits.fill(0);
          return send();
        },
        setSegments: (a, l) => {
          if (!Array.isArray(a[0]))
            throw new FirmwareRuntimeError('setSegments ต้องรับอาร์เรย์', l);
          const start = bounded(numeric(a[2], l), 3);
          for (let i = 0; i < bounded(numeric(a[1] ?? 4, l), 4) && start + i < 4; i++)
            digits[start + i] = numeric(a[0][i], l) & 255;
          return send();
        },
      });
    },
    LedControl: (args, host, line) => {
      if (numeric(args[3] ?? 1, line) !== 1)
        throw new FirmwareRuntimeError('ตัวจำลองรองรับ MAX7219 หนึ่งโมดูลต่อชุดขา', line);
      const pins = {
        data: requirePin(host, args[0], 'LedControl', line),
        clock: requirePin(host, args[1], 'LedControl', line),
        select: requirePin(host, args[2], 'LedControl', line),
      };
      const pixels = new Array<number>(64).fill(0);
      let enabled = false;
      let brightness = 8;
      const send = () =>
        sendBus(host, pins, 'max7219-frame', { pixels: pixels.join(''), brightness, enabled });
      const valid = (address: number) => address === 0;
      return libraryObject('LedControl', {
        getDeviceCount: () => 1,
        shutdown: (a, l) => {
          if (valid(numeric(a[0], l))) enabled = !truthy(a[1]);
          return send();
        },
        setIntensity: (a, l) => {
          if (valid(numeric(a[0], l))) brightness = bounded(numeric(a[1], l), 15);
          return send();
        },
        clearDisplay: (a, l) => {
          if (valid(numeric(a[0], l))) pixels.fill(0);
          return send();
        },
        setLed: (a, l) => {
          const row = numeric(a[1], l),
            col = numeric(a[2], l);
          if (valid(numeric(a[0], l)) && row >= 0 && row < 8 && col >= 0 && col < 8)
            pixels[Math.trunc(row) * 8 + Math.trunc(col)] = truthy(a[3]) ? 1 : 0;
          return send();
        },
        setRow: (a, l) => {
          const row = numeric(a[1], l),
            value = numeric(a[2], l);
          if (valid(numeric(a[0], l)) && row >= 0 && row < 8)
            for (let col = 0; col < 8; col++)
              pixels[Math.trunc(row) * 8 + col] = (value >> (7 - col)) & 1;
          return send();
        },
        setColumn: (a, l) => {
          const col = numeric(a[1], l),
            value = numeric(a[2], l);
          if (valid(numeric(a[0], l)) && col >= 0 && col < 8)
            for (let row = 0; row < 8; row++)
              pixels[row * 8 + Math.trunc(col)] = (value >> (7 - row)) & 1;
          return send();
        },
      });
    },
  },
};

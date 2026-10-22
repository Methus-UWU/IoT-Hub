import type { VirtualDevice } from '../../models/virtual-device.model';

/**
 * Maps the pin numbers a sketch uses onto the pin names the catalog declares.
 *
 * The two boards families label pins differently and both labels appear in real
 * sketches: an Uno header pin is `13`, an ESP32 one is `GPIO13` with `D13`
 * printed on the silkscreen. Rather than hard-coding a table per board, this
 * resolves against whatever pins the catalog part actually declares, so a board
 * added later works without touching this file.
 *
 * `A0`–`A7` follow the Arduino convention where the analog header continues the
 * digital numbering at 14. ESP32 sketches address ADC pins by GPIO number
 * instead, which rule 2 already covers.
 */

const ANALOG_BASE = 14;

export interface BoardPinMap {
  /** Catalog pin name for a sketch pin number, or null when the board has no such pin. */
  nameFor(pin: number): string | null;
  /** Pins the board can drive or read — everything that is not power or ground. */
  readonly ioPinNames: readonly string[];
}

export function createBoardPinMap(board: VirtualDevice): BoardPinMap {
  const byName = new Map<string, string>();
  const ioPinNames: string[] = [];

  for (const pin of board.pins) {
    if (pin.type === 'vcc' || pin.type === 'gnd' || pin.type === 'nc') continue;
    ioPinNames.push(pin.name);
    byName.set(pin.name.toUpperCase(), pin.name);
    for (const alias of pin.aliases ?? []) {
      // A silkscreen label such as `~11` marks PWM capability; the sketch writes
      // `11`, so the tilde must not stop the alias from matching.
      byName.set(alias.toUpperCase().replace(/^~/, ''), pin.name);
    }
  }

  const cache = new Map<number, string | null>();

  return {
    ioPinNames,
    nameFor(pin: number): string | null {
      const cached = cache.get(pin);
      if (cached !== undefined) return cached;

      const candidates = [`${pin}`, `GPIO${pin}`, `D${pin}`, `IO${pin}`];
      if (pin >= ANALOG_BASE) candidates.push(`A${pin - ANALOG_BASE}`);

      let resolved: string | null = null;
      for (const candidate of candidates) {
        const match = byName.get(candidate);
        if (match) {
          resolved = match;
          break;
        }
      }

      cache.set(pin, resolved);
      return resolved;
    },
  };
}

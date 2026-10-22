/**
 * Read access to the device catalog.
 *
 * The catalog itself is generated (`device-catalog.generated.ts`); everything the API
 * asks of it goes through this file, so a lookup is indexed once at module load rather
 * than scanning 47 devices and 1,773 pins on every wiring check.
 *
 * Not every board in `board-catalog.ts` has a definition here. The Angular catalog draws
 * three boards; new project creation offers only these supported boards. Existing
 * projects can still reference older board ids without a pinout, so callers must
 * handle `undefined` rather than assume a board is always describable.
 */

import { GENERATED_DEVICE_CATALOG } from './device-catalog.generated';
import { GENERATED_LIBRARY_CATALOG } from './library-catalog.generated';
import {
  CatalogDevice,
  CatalogPin,
  CatalogSetting,
  DeviceInterface,
  LibraryReference,
  PinType,
  isPassivePinType,
} from './device-catalog.types';

const BY_ID = new Map<string, CatalogDevice>(
  GENERATED_DEVICE_CATALOG.map((device) => [device.id, device]),
);

/**
 * Pin lookup per device, including silkscreen aliases.
 *
 * A board prints `D4` next to the hole its definition calls `GPIO4`, and a model asked
 * to wire "D4" means the same hole. Resolving an alias here means the stored connection
 * always carries the canonical pin id, so one hole never ends up with two spellings.
 */
const PINS_BY_DEVICE = new Map<string, Map<string, CatalogPin>>(
  GENERATED_DEVICE_CATALOG.map((device) => {
    const index = new Map<string, CatalogPin>();
    for (const pin of device.pins) {
      index.set(pin.name.toUpperCase(), pin);
      for (const alias of pin.aliases ?? []) {
        // A canonical name always wins: `GND` is an alias of `GND-L` on an ESP32 but
        // could be another part's real pin, and the real pin is the one meant.
        if (!index.has(alias.toUpperCase()))
          index.set(alias.toUpperCase(), pin);
      }
    }
    return [device.id, index];
  }),
);

export function findDevice(definitionId: string): CatalogDevice | undefined {
  return BY_ID.get(definitionId);
}

export function isKnownDevice(definitionId: string): boolean {
  return BY_ID.has(definitionId);
}

export function allDevices(): readonly CatalogDevice[] {
  return GENERATED_DEVICE_CATALOG;
}

/** Resolves a pin by canonical name or silkscreen alias, case-insensitively. */
export function findPin(
  definitionId: string,
  pinId: string,
): CatalogPin | undefined {
  return PINS_BY_DEVICE.get(definitionId)?.get(pinId.trim().toUpperCase());
}

/**
 * Catalog devices matching the term, best match first.
 *
 * Used to answer "is there a temperature sensor available?" without the model having to
 * guess catalog ids. Matching is deliberately generous — a miss sends the model looking
 * for hardware the project could have had, or makes it drop the part: "water pump 5V"
 * used to match nothing because no single field contains that whole phrase, and the
 * assistant built a watering system without a pump. So the phrase is scored word by
 * word, and a word counts for more the fewer parts carry it: in "dc pump", "pump" names
 * one part and "dc" a dozen, so the pump outranks the DC motor instead of tying with
 * it. A whole-phrase match ranks above any partial one.
 */
export function searchDevices(term: string): readonly CatalogDevice[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const words = [
    ...new Set(needle.split(/[\s,/·]+/).filter((word) => word.length > 1)),
  ];

  const scored = SEARCH_FIELDS.map(({ device, fields }) => {
    const matched = words.filter((word) =>
      fields.some((field) => field.includes(word)),
    );
    return {
      device,
      matched,
      whole: fields.some((field) => field.includes(needle)),
    };
  });
  // How many parts carry each word, for weighting it.
  const spread = new Map(
    words.map((word) => [
      word,
      scored.filter((entry) => entry.matched.includes(word)).length,
    ]),
  );

  return scored
    .map((entry) => ({
      device: entry.device,
      score:
        (entry.whole ? words.length + 1 : 0) +
        entry.matched.reduce(
          (total, word) => total + 1 / (spread.get(word) ?? 1),
          0,
        ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.device);
}

/** Lower-cased searchable text per part, built once. */
const SEARCH_FIELDS = GENERATED_DEVICE_CATALOG.map((device) => ({
  device,
  fields: [
    device.id,
    device.name.toLowerCase(),
    device.model.toLowerCase(),
    ...device.aliases.map((alias) => alias.toLowerCase()),
    ...device.tags.map((tag) => tag.toLowerCase()),
  ],
}));

/**
 * Pin types a board pin may stand in for.
 *
 * A general-purpose GPIO can serve a digital line, a PWM output, or a bit-banged bus,
 * which is why a request for `pwm` is satisfied by a `digital` pin. The reverse does not
 * hold: an ADC-only pin on an ESP32 (GPIO34–39) is input-only and cannot drive an LED,
 * and an I2C pin is only nominally special — the peripheral still needs *that* pin,
 * because the default bus is wired to it.
 */
const SUBSTITUTABLE: Readonly<Record<PinType, readonly PinType[]>> = {
  vcc: ['vcc'],
  gnd: ['gnd'],
  digital: ['digital', 'i2c-sda', 'i2c-scl', 'spi-mosi', 'spi-sck', 'spi-cs'],
  // An analog input is a distinct capability: a plain digital pin cannot read a voltage.
  analog: ['analog'],
  pwm: ['pwm', 'digital'],
  'i2c-sda': ['i2c-sda', 'digital'],
  'i2c-scl': ['i2c-scl', 'digital'],
  'spi-mosi': ['spi-mosi', 'digital'],
  'spi-miso': ['spi-miso', 'digital'],
  'spi-sck': ['spi-sck', 'digital'],
  'spi-cs': ['spi-cs', 'digital'],
  'uart-tx': ['uart-tx'],
  'uart-rx': ['uart-rx'],
  reset: ['reset'],
  passive: ['passive'],
  nc: ['nc'],
};

/** True when `candidate` can serve a peripheral pin of type `required`. */
export function pinTypeSatisfies(
  candidate: PinType,
  required: PinType,
): boolean {
  if (candidate === required) return true;
  if (isPassivePinType(required)) return true;
  return SUBSTITUTABLE[required].includes(candidate);
}

/**
 * The pin type a board must offer to serve this peripheral pin.
 *
 * A peripheral's `DATA` pin is `digital`; a board pin of any GPIO type will do. The
 * mapping is identity today and exists so the rule has one home if a peripheral ever
 * needs something its own pin type does not say.
 */
export function requiredBoardPinType(peripheralPin: CatalogPin): PinType {
  return peripheralPin.type;
}

/**
 * Pins on a board that could host a peripheral pin of the given type, best first.
 *
 * A pin whose type *is* the requested one comes before any pin that merely can stand in,
 * so an I2C display lands on the board's documented SDA and SCL rather than on whichever
 * general-purpose pin the header happens to reach first. Bit-banging the bus elsewhere
 * works, but every library example and every tutorial assumes the default pair, and a
 * diagram that quietly disagrees with them is the harder thing to debug.
 *
 * Within each group the board's own header order is kept. That ordering is stable, so two
 * runs of the assignment engine over the same project produce the same wiring, and the
 * code a model writes cannot disagree with the diagram because of iteration order.
 */
export function candidatePins(
  board: CatalogDevice,
  required: PinType,
): readonly CatalogPin[] {
  const usable = board.pins.filter((pin) =>
    pinTypeSatisfies(pin.type, required),
  );
  return [
    ...usable.filter((pin) => pin.type === required),
    ...usable.filter((pin) => pin.type !== required),
  ];
}

export function deviceInterfaces(
  device: CatalogDevice,
): readonly DeviceInterface[] {
  return device.interfaces;
}

/** A placed part's configured values, keyed by setting id. */
export type DeviceSettings = Readonly<
  Record<string, string | number | boolean>
>;

/**
 * Checks requested settings against the part's catalog entry.
 *
 * Returns the accepted values, or the reason the first bad one is refused. A setting
 * the part does not have, or a value outside its options or range, is refused rather
 * than stored: the canvas would ignore it, and the assistant would describe a part
 * that is not what the user sees.
 */
export function resolveSettings(
  definitionId: string,
  requested: unknown,
): { ok: true; settings: DeviceSettings } | { ok: false; reason: string } {
  if (requested === undefined || requested === null)
    return { ok: true, settings: {} };
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    return {
      ok: false,
      reason: 'settings must be an object of setting id to value',
    };
  }

  const available = findDevice(definitionId)?.settings ?? [];
  const accepted: Record<string, string | number | boolean> = {};
  for (const [id, raw] of Object.entries(
    requested as Record<string, unknown>,
  )) {
    const setting = available.find((candidate) => candidate.id === id);
    if (!setting) {
      const names =
        available.map((candidate) => candidate.id).join(', ') || 'none';
      return {
        ok: false,
        reason: `${definitionId} has no setting "${id}". Its settings: ${names}`,
      };
    }
    const value = coerceSetting(setting, raw);
    if (value === undefined) {
      return {
        ok: false,
        reason: `"${String(raw)}" is not a valid ${id} for ${definitionId}. ${describeSetting(setting)}`,
      };
    }
    accepted[id] = value;
  }
  return { ok: true, settings: accepted };
}

/** One line a model can act on: the setting, what it accepts, and its default. */
export function describeSetting(setting: CatalogSetting): string {
  const range = setting.options?.length
    ? setting.options.join(' | ')
    : [setting.min, setting.max].some((bound) => bound !== undefined)
      ? `${setting.min ?? '…'}–${setting.max ?? '…'}${setting.unit ? ` ${setting.unit}` : ''}`
      : setting.kind;
  return `${setting.id}: ${range} (default ${String(setting.defaultValue)})`;
}

function coerceSetting(
  setting: CatalogSetting,
  raw: unknown,
): string | number | boolean | undefined {
  if (setting.options?.length) {
    const value = String(raw).trim().toLowerCase();
    const match = setting.options.find(
      (option) => option.toLowerCase() === value,
    );
    if (match === undefined) return undefined;
    // Keep the stored type of the default: a numeric select stays a number.
    return typeof setting.defaultValue === 'number' ? Number(match) : match;
  }
  if (typeof setting.defaultValue === 'boolean') {
    return typeof raw === 'boolean' ? raw : undefined;
  }
  if (typeof setting.defaultValue === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) return undefined;
    if (setting.min !== undefined && value < setting.min) return undefined;
    if (setting.max !== undefined && value > setting.max) return undefined;
    return value;
  }
  return typeof raw === 'string' && raw.length <= 200 ? raw : undefined;
}

/** Colour words a label may use, English and Thai, by the option value they mean. */
const COLOUR_WORDS: Readonly<Record<string, readonly string[]>> = {
  red: ['red', 'แดง'],
  green: ['green', 'เขียว'],
  blue: ['blue', 'น้ำเงิน', 'ฟ้า'],
  yellow: ['yellow', 'เหลือง'],
  white: ['white', 'ขาว'],
  orange: ['orange', 'ส้ม'],
};

/**
 * Settings a part's label states outright.
 *
 * A model names a part "Status LED Green" and a resistor "DHT22 pull-up 4.7kΩ", then
 * passes the default colour and a copied 150 Ω as settings — the label is the one it
 * meant, and the one the user reads on the canvas. So a colour word or a resistance
 * in the label is taken as the setting, whatever the call passed.
 */
export function settingsFromLabel(
  definitionId: string,
  label: string,
): DeviceSettings {
  const settings = findDevice(definitionId)?.settings ?? [];
  const text = label.toLowerCase();
  const inferred: Record<string, string | number | boolean> = {};

  const colour = settings.find((setting) => setting.id === 'color');
  if (colour?.options?.length) {
    const named = colour.options.filter((option) =>
      (COLOUR_WORDS[option] ?? [option]).some((word) => text.includes(word)),
    );
    // Two colours in one label ("red/green indicator") say nothing definite.
    if (named.length === 1) inferred['color'] = named[0];
  }

  const resistance = settings.find((setting) => setting.id === 'resistance');
  if (resistance) {
    const match = /(\d+(?:\.\d+)?)\s*([kKmM])?\s*(?:Ω|ohm|r\b)/i.exec(label);
    if (match) {
      const scale = { k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[match[2] ?? ''] ?? 1;
      const value = Number(match[1]) * scale;
      const resolved = resolveSettings(definitionId, { resistance: value });
      if (resolved.ok) inferred['resistance'] = value;
    }
  }

  return inferred;
}

/** The emulated Arduino library that drives a part, if the simulator has one. */
export function libraryFor(definitionId: string): LibraryReference | undefined {
  return GENERATED_LIBRARY_CATALOG.find((library) =>
    library.devices.includes(definitionId),
  );
}

/** How the assistant is told to drive a part: includes, dependency, and usage. */
export function describeLibrary(library: LibraryReference): string {
  return [
    [
      `library: ${library.name}`,
      library.includes.map((file) => `#include <${file}>`).join(' '),
      library.platformio ? `lib_deps: ${library.platformio}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...library.usage.split('\n').map((line) => `  ${line}`),
    ...(library.limits ? [`  simulator: ${library.limits}`] : []),
  ].join('\n');
}

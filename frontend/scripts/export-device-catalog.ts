/**
 * Exports the electrical half of the device catalog to the NestJS API.
 *
 * The catalog is authored once, in `src/app/features/user/workspace/virtual-device/devices/`,
 * and that stays true: this script *derives* a backend copy rather than asking anyone to
 * maintain a second one. `board-catalog.ts` refuses to duplicate pin geometry by hand for
 * exactly the right reason — a hand-kept copy drifts — but the backend still has to be the
 * authority on whether a wire is legal (docs: AI project awareness, rule 6), and it cannot
 * be an authority on facts it does not hold.
 *
 * What crosses the boundary is only what a validator needs:
 *
 *   - identity: id, name, model, category, aliases, tags
 *   - electrical: pin name, pin type, wiring kind, direction, nominal voltage, fan-out
 *   - part-level: operating voltage window, interfaces, power source, current limiting
 *   - settings: the inspector properties a user configures — an LED's colour, a relay's
 *     trigger level — with their allowed values, so the assistant can set them and the
 *     API can refuse a value the part does not have
 *
 * What does not: coordinates, artwork, shapes, sizes, simulation behaviour, and the
 * live simulation-only controls. None of them decide whether GPIO4 may host a DHT22 data line, and
 * shipping them would recreate the drift this file exists to avoid.
 *
 * Run it from `frontend/`:
 *
 *   node_modules/@esbuild/win32-x64/esbuild.exe scripts/export-device-catalog.ts \
 *     --bundle --platform=node --format=cjs --outfile=.tmp/export-catalog.cjs \
 *     && node .tmp/export-catalog.cjs
 *
 * On other platforms swap the esbuild binary path (`node_modules/.bin/esbuild`).
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEVICES } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { deviceInterfaces } from '../src/app/features/user/workspace/virtual-device/devices/core/device-registry';
import {
  deviceCategoryLabel,
  isBoardCategory,
} from '../src/app/features/user/workspace/virtual-device/device-library.models';
import type { VirtualDevice } from '../src/app/features/user/workspace/virtual-device/models/virtual-device.model';
import { LIBRARY_CATALOG } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/libraries/library-catalog';

const OUTPUT = resolve(
  __dirname,
  '../../backend/src/modules/projects/catalog/device-catalog.generated.ts',
);

/** Mirrors `CatalogPin` on the backend. Field order is the emitted order. */
interface ExportedPin {
  readonly name: string;
  readonly type: string;
  readonly kind: string;
  readonly direction: string;
  readonly voltage?: number;
  readonly maxInputVoltage?: number;
  readonly maxCurrentMa?: number;
  readonly requiresBias?: 'up' | 'down';
  readonly aliases?: readonly string[];
  readonly description?: string;
  /** Emitted only when false; every other pin is a shared electrical node. */
  readonly multipleConnections?: false;
  /** Board header side, so assignment can keep a part's wires on one side. */
  readonly side?: string;
}

interface ExportedDevice {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly description: string;
  readonly categoryId: string;
  readonly category: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly typicalUsage: string;
  readonly interfaces: readonly string[];
  readonly isBoard: boolean;
  readonly powerSource?: true;
  readonly requiresSeriesResistor?: true;
  readonly limitsCurrent?: true;
  readonly operatingVoltage?: { min: number; max: number; recommended?: number };
  readonly logicVoltage?: number;
  readonly maxLogicInputVoltage?: number;
  readonly supplyCurrentMa?: number;
  readonly onboardLed?: { readonly pin: string; readonly activeLow?: boolean; readonly label: string };
  readonly defaultSpi?: {
    readonly mosi: string;
    readonly miso: string;
    readonly clock: string;
    readonly select?: string;
  };
  readonly settings?: readonly ExportedSetting[];
  readonly pins: readonly ExportedPin[];
}

/** Mirrors `CatalogSetting` on the backend. */
interface ExportedSetting {
  readonly id: string;
  readonly kind: string;
  readonly defaultValue: string | number | boolean;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
}

function exportSettings(device: VirtualDevice): readonly ExportedSetting[] {
  return (device.properties ?? [])
    .filter((property) => !property.simulationOnly)
    .map((property) => ({
      id: property.id,
      kind: property.kind,
      defaultValue: property.defaultValue,
      ...(property.options?.length
        ? { options: property.options.map((option) => String(option.value)) }
        : {}),
      ...(property.min !== undefined ? { min: property.min } : {}),
      ...(property.max !== undefined ? { max: property.max } : {}),
      ...(property.unit ? { unit: property.unit } : {}),
    }));
}

function exportPin(pin: VirtualDevice['pins'][number], isBoard: boolean): ExportedPin {
  return {
    name: pin.name,
    // A pin authored before the fine-grained model has no `type`; `kind` is the
    // only classification it carries, so widen it rather than dropping the pin.
    type: pin.type ?? (pin.kind === 'power' ? 'vcc' : pin.kind === 'ground' ? 'gnd' : 'digital'),
    kind: pin.kind,
    direction: pin.direction ?? 'bidirectional',
    ...(pin.voltage !== undefined ? { voltage: pin.voltage } : {}),
    ...(pin.maxInputVoltage !== undefined ? { maxInputVoltage: pin.maxInputVoltage } : {}),
    ...(pin.maxCurrentMa !== undefined ? { maxCurrentMa: pin.maxCurrentMa } : {}),
    ...(pin.requiresBias ? { requiresBias: pin.requiresBias } : {}),
    ...(pin.aliases?.length ? { aliases: [...pin.aliases] } : {}),
    ...(pin.description ? { description: pin.description } : {}),
    ...(pin.multipleConnections === false ? { multipleConnections: false as const } : {}),
    ...(isBoard && pin.side ? { side: pin.side } : {}),
  };
}

function exportDevice(device: VirtualDevice): ExportedDevice {
  const settings = exportSettings(device);
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    description: device.description,
    categoryId: device.catalog.categoryId,
    category: deviceCategoryLabel(device.catalog.categoryId),
    aliases: [...device.catalog.aliases],
    tags: [...device.catalog.tags],
    typicalUsage: device.catalog.typicalUsage,
    interfaces: [...deviceInterfaces(device)],
    isBoard: isBoardCategory(device.catalog.categoryId),
    ...(device.powerSource ? { powerSource: true as const } : {}),
    ...(device.requiresSeriesResistor ? { requiresSeriesResistor: true as const } : {}),
    ...(device.limitsCurrent ? { limitsCurrent: true as const } : {}),
    ...(device.operatingVoltage ? { operatingVoltage: { ...device.operatingVoltage } } : {}),
    ...(device.logicVoltage !== undefined ? { logicVoltage: device.logicVoltage } : {}),
    ...(device.maxLogicInputVoltage !== undefined
      ? { maxLogicInputVoltage: device.maxLogicInputVoltage }
      : {}),
    ...(device.supplyCurrentMa !== undefined ? { supplyCurrentMa: device.supplyCurrentMa } : {}),
    ...(device.onboardLed ? { onboardLed: { ...device.onboardLed } } : {}),
    ...(device.defaultSpi ? { defaultSpi: { ...device.defaultSpi } } : {}),
    ...(settings.length ? { settings } : {}),
    pins: device.pins.map((pin) => exportPin(pin, isBoardCategory(device.catalog.categoryId))),
  };
}

const exported = DEVICES.map(exportDevice).sort((a, b) => a.id.localeCompare(b.id));
const pinCount = exported.reduce((total, device) => total + device.pins.length, 0);

/**
 * One pin per line, one device per block.
 *
 * A breadboard contributes hundreds of pins, so the default four-space-per-field
 * layout turns a 47-part catalog into a file nobody can scroll. Keeping a pin on one
 * line makes the diff of a catalog change readable, which is the only reason this
 * generated file is committed rather than built.
 */
function serialize(devices: readonly ExportedDevice[]): string {
  const blocks = devices.map((device) => {
    const { pins, ...head } = device;
    const fields = Object.entries(head).map(
      ([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    );
    const pinLines = pins.map((pin) => `      ${JSON.stringify(pin)},`);
    return ['  {', ...fields, '    "pins": [', ...pinLines, '    ],', '  },'].join('\n');
  });

  return ['[', ...blocks, ']'].join('\n');
}

const banner = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`frontend/scripts/export-device-catalog.ts\` from the Angular device
 * catalog, which remains the single place a part is authored. Re-run the exporter after
 * changing any device definition; editing this file by hand recreates the drift the
 * generator exists to prevent.
 *
 * Carries the electrical facts the API needs to decide whether a wire is legal — pins,
 * pin types, directions, voltages, fan-out — the settings a user may configure, and
 * nothing about how a part is drawn.
 *
 * ${exported.length} devices, ${pinCount} pins.
 */

import type { CatalogDevice } from './device-catalog.types';

export const GENERATED_DEVICE_CATALOG: readonly CatalogDevice[] = `;

writeFileSync(OUTPUT, `${banner}${serialize(exported)} as const;\n`, 'utf8');

console.log(`Wrote ${exported.length} devices (${pinCount} pins) to ${OUTPUT.replace(/\\/g, '/')}`);

// The library table rides along: the assistant has to write sketches with the
// libraries the simulator runs, and a part id that no longer exists is a stale
// entry, refused here rather than shipped.
const knownIds = new Set(exported.map((device) => device.id));
for (const library of LIBRARY_CATALOG) {
  for (const id of library.devices) {
    if (!knownIds.has(id))
      throw new Error(`library-catalog: "${library.name}" names unknown device "${id}"`);
  }
}

const LIBRARY_OUTPUT = resolve(
  __dirname,
  '../../backend/src/modules/projects/catalog/library-catalog.generated.ts',
);

writeFileSync(
  LIBRARY_OUTPUT,
  `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`frontend/scripts/export-device-catalog.ts\` from
 * \`simulation/firmware/libraries/library-catalog.ts\`, the one place the table is
 * written. It lists the Arduino libraries the simulator emulates and the parts they
 * drive, so the assistant writes sketches the canvas can run.
 */

import type { LibraryReference } from './device-catalog.types';

export const GENERATED_LIBRARY_CATALOG: readonly LibraryReference[] = ${JSON.stringify(
    LIBRARY_CATALOG,
    null,
    2,
  )} as const;
`,
  'utf8',
);

console.log(`Wrote ${LIBRARY_CATALOG.length} libraries to ${LIBRARY_OUTPUT.replace(/\\/g, '/')}`);

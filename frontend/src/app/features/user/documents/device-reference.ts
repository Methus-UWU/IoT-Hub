import { DEVICES } from '../workspace/virtual-device/devices/device-catalog';
import { deviceInterfaces } from '../workspace/virtual-device/devices/core/device-registry';
import type {
  DeviceInterface,
  PinDirection,
  PinType,
} from '../workspace/virtual-device/devices/core/device-types';
import {
  DEVICE_CATEGORY_OPTIONS,
  deviceCategoryLabel,
  isBoardCategory,
} from '../workspace/virtual-device/device-library.models';
import type { DeviceCategoryId } from '../workspace/virtual-device/device-library.models';
import type { VirtualDevice } from '../workspace/virtual-device/models/virtual-device.model';
import { DEVICE_DATASHEETS } from './device-datasheets';
import { DEVICE_NOTES_TH } from './device-notes.th';
import { PinAdvice, pinAdviceFor } from './pin-advice';
import {
  LIBRARY_CATALOG,
  type LibraryReference,
} from '../workspace/virtual-device/simulation/firmware/libraries/library-catalog';

/**
 * Device reference shown on the documents page.
 *
 * Every electrical fact is derived from `DEVICES` — the same catalog the canvas
 * draws from and the backend validates wiring against — so adding a part to the
 * catalog makes it appear here with no edit. Thai prose lives in
 * [device-notes.th.ts].
 *
 * Pin labels are translated from the union types (`PinType`, `PinDirection`)
 * rather than from the English text in the catalog: that text is free to change,
 * but a change to the union makes TypeScript fail here immediately.
 */

const PIN_TYPE_LABELS_TH: Readonly<Record<PinType, string>> = {
  vcc: 'ไฟเลี้ยง',
  gnd: 'กราวด์',
  digital: 'ดิจิทัล',
  analog: 'แอนะล็อก',
  pwm: 'PWM',
  'i2c-sda': 'I2C ข้อมูล',
  'i2c-scl': 'I2C สัญญาณนาฬิกา',
  'spi-mosi': 'SPI ข้อมูลออก',
  'spi-miso': 'SPI ข้อมูลเข้า',
  'spi-sck': 'SPI สัญญาณนาฬิกา',
  'spi-cs': 'SPI เลือกชิป',
  'uart-tx': 'UART ส่ง',
  'uart-rx': 'UART รับ',
  reset: 'รีเซ็ต',
  passive: 'ขาพาสซีฟ',
  nc: 'ไม่ได้ต่อภายใน',
};

const PIN_DIRECTION_LABELS_TH: Readonly<Record<PinDirection, string>> = {
  input: 'รับเข้า',
  output: 'ส่งออก',
  bidirectional: 'สองทาง',
  power: 'ไฟเลี้ยง',
  passive: 'พาสซีฟ',
};

const INTERFACE_LABELS_TH: Readonly<Record<DeviceInterface, string>> = {
  digital: 'ดิจิทัล',
  analog: 'แอนะล็อก',
  pwm: 'PWM',
  i2c: 'I2C',
  spi: 'SPI',
  uart: 'UART',
  onewire: '1-Wire',
  power: 'ไฟเลี้ยง',
  passive: 'พาสซีฟ',
};

export interface DevicePinReference {
  readonly name: string;
  readonly typeLabel: string;
  readonly directionLabel: string;
  /** Voltage this pin sources or expects. Empty when the catalog omits it. */
  readonly voltageLabel: string;
  /** Whether to use this pin, for board pins that are a wiring choice. */
  readonly advice: PinAdvice | null;
}

export interface DeviceReference {
  readonly id: string;
  /** Thai name when [device-notes.th.ts] has one; otherwise the model, which is already a proper noun. */
  readonly name: string;
  readonly model: string;
  readonly categoryId: DeviceCategoryId;
  readonly categoryLabel: string;
  /** Microcontroller boards show per-pin advice; parts do not. */
  readonly isBoard: boolean;
  readonly summary: string;
  readonly usage: string;
  readonly caution: string;
  readonly voltageLabel: string;
  readonly interfaceLabels: readonly string[];
  /** What the part senses or drives and over what span, e.g. "Temperature -40–80 °C". */
  readonly operatingRangeLabel: string;
  /** Real dimensions, e.g. "28.3 × 51.5 มม.". Empty when the catalog has none. */
  readonly sizeLabel: string;
  /** Signal pins by direction, e.g. "อินพุต 1 · เอาต์พุต 0 · สองทาง 0". */
  readonly ioLabel: string;
  readonly pins: readonly DevicePinReference[];
  /** Arduino libraries that drive this part, for the IDE and PlatformIO setup. */
  readonly libraries: readonly LibraryReference[];
  /** Raw Markdown datasheet, or empty when this part has none yet. */
  readonly datasheet: string;
  /** Search haystack: Thai name, English name, model, and the catalog tags and aliases. */
  readonly searchText: string;
}

function voltageLabelFor(device: VirtualDevice): string {
  const range = device.operatingVoltage;
  if (!range) return '';
  const span = range.min === range.max ? `${range.min} V` : `${range.min}–${range.max} V`;
  return range.recommended === undefined ? span : `${span} (แนะนำ ${range.recommended} V)`;
}

/**
 * The sensed or driven quantity comes from the part's simulation controls: a
 * DHT22's temperature knob spans exactly the range the real sensor measures, so
 * the comparison reads the same numbers the canvas enforces instead of a copy.
 */
function operatingRangeFor(device: VirtualDevice): string {
  return (device.properties ?? [])
    .filter(
      (property) =>
        property.group === 'simulation' &&
        property.kind === 'number' &&
        property.min !== undefined &&
        property.max !== undefined &&
        Boolean(property.unit),
    )
    .map((property) => `${property.label} ${property.min}–${property.max} ${property.unit}`)
    .join(', ');
}

function sizeLabelFor(device: VirtualDevice): string {
  const size = device.physicalSize;
  if (!size) return '';
  const mm = (value: number) => Number(value.toFixed(1)).toString();
  return `${mm(size.widthMm)} × ${mm(size.heightMm)} มม.`;
}

function ioLabelFor(device: VirtualDevice): string {
  const count = (direction: string) =>
    device.pins.filter((pin) => pin.direction === direction).length;
  return [
    `อินพุต ${count('input')}`,
    `เอาต์พุต ${count('output')}`,
    `สองทาง ${count('bidirectional')}`,
  ].join(' · ');
}

function toPinReference(pin: VirtualDevice['pins'][number]): DevicePinReference {
  return {
    name: pin.name,
    typeLabel: pin.type ? PIN_TYPE_LABELS_TH[pin.type] : '',
    directionLabel: pin.direction ? PIN_DIRECTION_LABELS_TH[pin.direction] : '',
    voltageLabel: pin.voltage === undefined ? '' : `${pin.voltage} V`,
    advice: pinAdviceFor(pin.type, pin.description),
  };
}

function toReference(device: VirtualDevice): DeviceReference {
  const note = DEVICE_NOTES_TH[device.id];
  const name = note?.name ?? device.model;
  return {
    id: device.id,
    name,
    model: device.model,
    categoryId: device.catalog.categoryId,
    categoryLabel: deviceCategoryLabel(device.catalog.categoryId),
    isBoard: isBoardCategory(device.catalog.categoryId),
    summary: note?.summary ?? '',
    usage: note?.usage ?? '',
    caution: note?.caution ?? '',
    voltageLabel: voltageLabelFor(device),
    interfaceLabels: deviceInterfaces(device).map((name) => INTERFACE_LABELS_TH[name]),
    operatingRangeLabel: operatingRangeFor(device),
    sizeLabel: sizeLabelFor(device),
    ioLabel: ioLabelFor(device),
    pins: device.pins.map(toPinReference),
    libraries: LIBRARY_CATALOG.filter((library) => library.devices.includes(device.id)),
    datasheet: DEVICE_DATASHEETS[device.id] ?? '',
    searchText: [name, device.name, device.model, ...device.catalog.tags, ...device.catalog.aliases]
      .join(' ')
      .toLocaleLowerCase(),
  };
}

export const DEVICE_REFERENCES: readonly DeviceReference[] = DEVICES.map(toReference);

export interface DeviceCategoryFilter {
  readonly id: DeviceCategoryId | 'all';
  readonly label: string;
  readonly count: number;
}

/**
 * Only categories that actually hold a part. `DEVICE_CATEGORY_OPTIONS` lists 21,
 * several reserved for parts not in the catalog yet; showing an empty one gives the
 * user a filter that leads to a blank page.
 */
export const DEVICE_CATEGORY_FILTERS: readonly DeviceCategoryFilter[] = [
  { id: 'all' as const, label: 'ทุกหมวด', count: DEVICE_REFERENCES.length },
  ...DEVICE_CATEGORY_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    count: DEVICE_REFERENCES.filter((device) => device.categoryId === option.id).length,
  })).filter((option) => option.count > 0),
];

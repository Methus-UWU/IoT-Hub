/**
 * Device identity and taxonomy for the library.
 *
 * `DeviceKind` used to be a hand-maintained union of the thirteen parts that
 * existed at the time. It is now an opaque string: the catalog registers parts
 * at module load and `isDeviceKind` validates against that registry at runtime,
 * so adding a part no longer means editing this file.
 */
export type DeviceKind = string;

export const DEVICE_CATEGORY_OPTIONS = [
  { id: 'microcontrollers', label: 'ไมโครคอนโทรลเลอร์' },
  { id: 'dev-boards', label: 'บอร์ดพัฒนา' },
  { id: 'sbc', label: 'คอมพิวเตอร์บอร์ดเดี่ยว' },
  { id: 'sensors', label: 'เซนเซอร์' },
  { id: 'input-devices', label: 'อุปกรณ์อินพุต' },
  { id: 'output-devices', label: 'อุปกรณ์เอาต์พุต' },
  { id: 'displays', label: 'จอแสดงผล' },
  { id: 'leds', label: 'แสงสว่าง' },
  { id: 'motors-actuators', label: 'มอเตอร์และแอกชูเอเตอร์' },
  { id: 'communication', label: 'โมดูลสื่อสาร' },
  { id: 'power', label: 'โมดูลจ่ายไฟ' },
  { id: 'logic-ics', label: 'ไอซีลอจิก' },
  { id: 'analog', label: 'อุปกรณ์แอนะล็อก' },
  { id: 'passive-components', label: 'อุปกรณ์พาสซีฟ' },
  { id: 'switches', label: 'สวิตช์' },
  { id: 'relay-modules', label: 'รีเลย์' },
  { id: 'audio', label: 'เสียง' },
  { id: 'storage', label: 'หน่วยความจำ' },
  { id: 'breadboards', label: 'เบรดบอร์ด' },
  { id: 'prototyping', label: 'งานต้นแบบ' },
  { id: 'misc', label: 'อื่น ๆ' },
] as const;

export type DeviceCategoryId = (typeof DEVICE_CATEGORY_OPTIONS)[number]['id'];
export type DeviceLibraryFilterId = 'all' | 'favorites' | 'recently-used' | DeviceCategoryId;

const BOARD_CATEGORY_IDS: ReadonlySet<DeviceCategoryId> = new Set([
  'microcontrollers',
  'dev-boards',
  'sbc',
]);

/** Categories that count toward the two-board workspace limit. */
export function isBoardCategory(id: DeviceCategoryId): boolean {
  return BOARD_CATEGORY_IDS.has(id);
}

export function deviceCategoryLabel(id: DeviceCategoryId): string {
  return DEVICE_CATEGORY_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export interface DeviceLibraryItem {
  id: DeviceKind;
  name: string;
  model: string;
  categoryId: DeviceCategoryId;
  category: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
  pinCount: number;
  interfaceLabel: string;
  typicalUsage: string;
  /** Short badges rendered on the card: I2C, SPI, 3.3 V, PWM, … */
  badges: readonly string[];
  /** Higher sorts earlier under the "popular" quick filter. */
  popularity: number;
}

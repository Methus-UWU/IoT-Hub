import type { PinType } from '../workspace/virtual-device/devices/core/device-types';

export type PinAdviceLevel = 'recommended' | 'caution' | 'avoid';

export interface PinAdvice {
  readonly level: PinAdviceLevel;
  readonly label: string;
  /** Why, in Thai. Empty for a plain recommended pin. */
  readonly reason: string;
}

interface Rule {
  readonly pattern: RegExp;
  readonly level: Exclude<PinAdviceLevel, 'recommended'>;
  readonly reason: string;
}

/**
 * Checked in order; the first match wins, so the harder "avoid" rules come first.
 *
 * The rules read the pin descriptions the board definitions already carry
 * ("strapping pin", "wired to the onboard SPI flash — do not use"), so the
 * canvas, the wiring checks, and this table agree on one set of facts.
 */
const RULES: readonly Rule[] = [
  {
    pattern: /do not use|spi flash|onboard flash|leave unconnected/i,
    level: 'avoid',
    reason: 'ต่อกับหน่วยความจำแฟลชบนบอร์ด ใช้แล้วบอร์ดค้างหรือบูตไม่ขึ้น',
  },
  {
    pattern: /usb bridge|usb adapter|uart0/i,
    level: 'avoid',
    reason: 'ใช้ร่วมกับพอร์ต USB สำหรับอัปโหลดและ Serial Monitor อาจทำให้อัปโหลดไม่ผ่าน',
  },
  {
    pattern: /camera/i,
    level: 'avoid',
    reason: 'ถูกใช้โดยกล้องบนบอร์ด',
  },
  {
    pattern: /strapping|bootloader/i,
    level: 'caution',
    reason: 'ขา strapping มีผลตอนบูต อย่าให้อุปกรณ์ดึงขานี้สูงหรือต่ำค้างไว้ตอนเปิดเครื่อง',
  },
  {
    pattern: /input only/i,
    level: 'caution',
    reason: 'รับสัญญาณเข้าได้อย่างเดียว และไม่มีตัวต้านทาน pull-up ภายใน',
  },
  {
    pattern: /\bsd\b|sd card/i,
    level: 'caution',
    reason: 'ใช้ร่วมกับช่องการ์ด microSD',
  },
  {
    pattern: /flash led|onboard (l )?led/i,
    level: 'caution',
    reason: 'ต่อกับไฟ LED บนบอร์ด ไฟจะติดตามสัญญาณของขานี้',
  },
  {
    pattern: /doubles as i2c/i,
    level: 'caution',
    reason: 'เป็นขา I2C ด้วย ถ้าใช้จอหรือเซนเซอร์ I2C จะใช้ขานี้เป็นอย่างอื่นไม่ได้',
  },
];

/** Supply, ground, and reset pins get no advice: they are not a choice. */
const NOT_A_CHOICE: ReadonlySet<PinType> = new Set(['vcc', 'gnd', 'reset', 'passive']);

const LABELS: Record<PinAdviceLevel, string> = {
  recommended: 'แนะนำ',
  caution: 'ระวัง',
  avoid: 'ควรหลีกเลี่ยง',
};

export function pinAdviceFor(
  type: PinType | undefined,
  description: string | undefined,
): PinAdvice | null {
  if (!type || NOT_A_CHOICE.has(type)) return null;
  const rule = RULES.find((candidate) => candidate.pattern.test(description ?? ''));
  // An unconnected pad is worth a word only when it is one to keep away from.
  if (type === 'nc' && rule?.level !== 'avoid') return null;
  const level = rule?.level ?? 'recommended';
  return { level, label: LABELS[level], reason: rule?.reason ?? '' };
}

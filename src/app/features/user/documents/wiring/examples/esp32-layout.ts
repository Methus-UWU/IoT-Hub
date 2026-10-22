import type { DiagramNote, PartSpec, Point } from '../wiring-diagram';

/**
 * Every single-device example puts the same 38-pin board in the same place, so a
 * reader flipping between examples sees only the part and its wires change.
 * Left header pins sit at x ≈ 291, right header pins at x ≈ 469.
 */
export const ESP32: PartSpec = {
  device: 'esp32-devkit-38',
  label: 'ESP32 DevKit · 38 ขา',
  at: [281, 110],
  scale: 0.7,
};

export const SINGLE_SIZE: Point = [800, 560];

export const USB_NOTE: DiagramNote = { at: [281, 525], text: 'จ่ายไฟบอร์ดผ่าน USB' };

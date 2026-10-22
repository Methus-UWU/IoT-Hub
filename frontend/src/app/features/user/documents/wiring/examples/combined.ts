import { WIRE, type WiringExampleSpec } from '../wiring-diagram';

export const COMBINED_EXAMPLE: WiringExampleSpec = {
  id: 'combined',
  name: 'วงจรรวม',
  title: 'ตัวอย่างวงจรรวม · ใช้ ESP32 บอร์ดเดียว',
  description:
    'สายหมายเลข 1 ถึง 8 ตรงกับรายการใต้ภาพ ใช้ GPIO 23 ควบคุม LED ผ่านตัวต้านทาน 220 โอห์ม GPIO 18 อ่านปุ่มกดแบบ INPUT_PULLUP และ GPIO 19 อ่าน DO ของ KY-038 ที่เลี้ยงด้วย 3.3V ทุกอุปกรณ์ใช้กราวด์ร่วมกัน ขา AO ไม่ต่อ',
  size: [920, 600],
  parts: [
    { device: 'esp32-devkit-38', label: 'ESP32 DevKit · 38 ขา', at: [110, 120], scale: 0.7 },
    {
      device: 'resistor',
      label: 'ตัวต้านทาน 220 Ω',
      at: [470, 185],
      scale: 1,
      state: { resistance: 220 },
    },
    { device: 'led', label: 'LED', at: [650, 105], scale: 0.65 },
    { device: 'button', label: 'ปุ่มกด', at: [535, 300], scale: 0.8 },
    { device: 'sound-sensor', label: 'เซนเซอร์เสียง KY-038', at: [495, 425], scale: 0.7 },
  ],
  wires: [
    {
      label: 'GPIO 23 → ตัวต้านทาน ขา 1',
      from: [0, 'GPIO23'],
      to: [1, '1'],
      color: WIRE.signal,
      route: ['h', 410],
      badge: [410, 180],
    },
    {
      label: 'ตัวต้านทาน ขา 2 → LED ขา A (+)',
      from: [1, '2'],
      to: [2, 'A'],
      color: WIRE.signal,
      route: ['h', 620, 220],
      badge: [620, 220],
    },
    {
      label: 'LED ขา K (−) → GND',
      from: [2, 'K'],
      to: [0, 'GND-R1'],
      color: WIRE.ground,
      route: ['h', 720, 40, 330],
      badge: [720, 125],
    },
    {
      label: 'GPIO 18 → ปุ่มกด ขา 1',
      from: [0, 'GPIO18'],
      to: [3, '1'],
      color: WIRE.signal,
      route: ['h', 350],
      badge: [445, 308],
    },
    {
      label: 'ปุ่มกด ขา 3 → GND',
      from: [3, '3'],
      to: [0, 'GND-R2'],
      color: WIRE.ground,
      route: ['h', 670, 370, 390],
      badge: [670, 345],
    },
    {
      label: '3V3 → KY-038 ขา VCC (+)',
      from: [0, '3V3'],
      to: [4, 'VCC'],
      color: WIRE.power,
      route: ['h', 60, 565, 800],
      badge: [800, 540],
    },
    {
      label: 'KY-038 ขา GND → GND',
      from: [4, 'GND'],
      to: [0, 'GND-R1'],
      color: WIRE.ground,
      route: ['h', 830, 60, 350],
      badge: [830, 340],
    },
    {
      label: 'KY-038 ขา DO → GPIO 19',
      from: [4, 'DO'],
      to: [0, 'GPIO19'],
      color: WIRE.signal,
      route: ['h', 780, 390, 370],
      badge: [780, 420],
    },
  ],
  notes: [
    { at: [110, 540], text: 'จ่ายไฟบอร์ดผ่าน USB' },
    { at: [495, 550], text: 'AO ไม่ต่อ · ใช้เฉพาะ DO' },
  ],
  materials:
    'LED สีแดง 1 ดวง · ตัวต้านทาน 220 Ω 1 ตัว · ปุ่มกด 1 ตัว · KY-038 ที่รองรับ 3.3V 1 ตัว · สายจัมเปอร์ 8 เส้น',
  tips: [
    'ถอดไฟก่อนต่อสาย ใช้ INPUT_PULLUP กับปุ่มกด และห้ามป้อน 5V เข้า GPIO ตัวอย่างนี้แสดงการต่อสาย ยังไม่ได้จำลองการทำงาน',
  ],
};

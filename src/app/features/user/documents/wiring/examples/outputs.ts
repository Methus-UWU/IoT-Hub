import { WIRE, type WiringExampleSpec } from '../wiring-diagram';
import { ESP32, SINGLE_SIZE, USB_NOTE } from './esp32-layout';

export const LED_EXAMPLE: WiringExampleSpec = {
  id: 'led',
  name: 'LED กะพริบ',
  title: 'ไฟ LED ผ่านตัวต้านทาน',
  description: 'ESP32 GPIO 23 ต่อตัวต้านทาน 220 โอห์ม แล้วต่อขา A ของ LED ขา K ของ LED ต่อ GND',
  size: SINGLE_SIZE,
  parts: [
    ESP32,
    {
      device: 'resistor',
      label: 'ตัวต้านทาน 220 Ω',
      at: [540, 145.16],
      scale: 1,
      state: { resistance: 220 },
    },
    { device: 'led', label: 'LED สีแดง', at: [690, 110], scale: 0.65 },
  ],
  wires: [
    { label: 'GPIO 23 → ตัวต้านทาน ขา 1', from: [0, 'GPIO23'], to: [1, '1'], color: WIRE.signal },
    {
      label: 'ตัวต้านทาน ขา 2 → LED ขา A (+)',
      from: [1, '2'],
      to: [2, 'A'],
      color: WIRE.signal,
      route: ['h', 675, 222],
    },
    {
      label: 'LED ขา K (−) → GND',
      from: [2, 'K'],
      to: [0, 'GND-R2'],
      color: WIRE.ground,
      route: ['v', 247.06],
    },
  ],
  notes: [USB_NOTE],
  materials: 'LED สีแดง 1 ดวง · ตัวต้านทาน 220 Ω 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'ตั้ง pinMode(23, OUTPUT) แล้วสลับ digitalWrite(23, HIGH) กับ LOW ทุก 500 ms เพื่อให้ LED กะพริบ',
    'ขายาวของ LED คือขา A ขาสั้นหรือด้านแบนของตัวถังคือขา K ต้องมีตัวต้านทานอนุกรมเสมอ',
  ],
};

export const SERVO_EXAMPLE: WiringExampleSpec = {
  id: 'servo',
  name: 'เซอร์โว SG90',
  title: 'หมุนเซอร์โวมอเตอร์ SG90',
  description:
    'เซอร์โว SG90 รับไฟ 5V จากขา VIN สาย GND ต่อกราวด์ของบอร์ด สายสัญญาณ PWM ต่อ GPIO 18 สาย VIN ข้ามสาย PWM โดยไม่เชื่อมกัน',
  size: SINGLE_SIZE,
  parts: [ESP32, { device: 'servo', label: 'เซอร์โว SG90', at: [575, 221.9], scale: 0.55 }],
  wires: [
    {
      label: 'GPIO 18 → เซอร์โว PWM (สีส้ม)',
      from: [0, 'GPIO18'],
      to: [1, 'PWM'],
      color: WIRE.signalAlt,
      badge: [505, 282.62],
    },
    {
      label: 'GND → เซอร์โว GND (สีน้ำตาล)',
      from: [0, 'GND-R2'],
      to: [1, 'GND'],
      color: WIRE.ground,
      route: ['h', 520],
      badge: [600, 236],
    },
    {
      label: 'VIN (5V) → เซอร์โว VCC (สีแดง)',
      from: [0, 'VIN'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 265, 545, 545],
    },
  ],
  notes: [USB_NOTE],
  materials: 'เซอร์โว SG90 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'ใช้ไลบรารี ESP32Servo เรียก servo.attach(18) แล้ว servo.write(0 ถึง 180) เพื่อกำหนดมุม',
    'SG90 ตัวเดียวที่ไม่มีโหลดใช้ไฟ VIN จาก USB ได้ ถ้ามีหลายตัวหรือรับแรงมาก ให้ใช้แหล่งจ่าย 5V แยกและต่อ GND ร่วมกับบอร์ด',
  ],
};

export const RELAY_EXAMPLE: WiringExampleSpec = {
  id: 'relay',
  name: 'รีเลย์',
  title: 'สั่งเปิดปิดรีเลย์ 1 ช่อง',
  description:
    'โมดูลรีเลย์รับไฟ 5V จากขา VIN โดยเดินสายอ้อมด้านบนของบอร์ด ต่อ GND และให้ GPIO 16 สั่งขา IN ด้านหน้าสัมผัส NO COM NC ไม่แสดงโหลด',
  size: SINGLE_SIZE,
  parts: [ESP32, { device: 'relay', label: 'โมดูลรีเลย์ 1 ช่อง', at: [520, 258.26], scale: 0.5 }],
  wires: [
    {
      label: 'VIN (5V) → รีเลย์ VCC',
      from: [0, 'VIN'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 255, 62, 505],
    },
    {
      label: 'GND → รีเลย์ GND',
      from: [0, 'GND-R2'],
      to: [1, 'GND'],
      color: WIRE.ground,
      route: ['h', 495],
    },
    { label: 'GPIO 16 → รีเลย์ IN', from: [0, 'GPIO16'], to: [1, 'IN'], color: WIRE.signal },
  ],
  notes: [USB_NOTE, { at: [520, 410], text: 'NO · COM · NC ต่อโหลดแยกวงจร' }],
  materials: 'โมดูลรีเลย์ 5V 1 ช่องที่สั่งด้วยสัญญาณ 3.3V ได้ 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'ตั้ง pinMode(16, OUTPUT) โมดูลหลายรุ่นทำงานแบบ active LOW คือ digitalWrite(16, LOW) แล้วรีเลย์ติด ตรวจจากไฟแสดงสถานะบนโมดูล',
    'เลือกโมดูลที่มีทรานซิสเตอร์หรือออปโตคัปเปลอร์ขับคอยล์ ห้ามต่อคอยล์รีเลย์เปล่าเข้ากับ GPIO โดยตรง',
    'ฝึกกับโหลดแรงดันต่ำก่อน ห้ามต่อไฟบ้าน 220V หากไม่มีผู้ชำนาญดูแล',
  ],
};

export const OLED_EXAMPLE: WiringExampleSpec = {
  id: 'oled',
  name: 'จอ OLED I2C',
  title: 'แสดงข้อความบนจอ OLED 0.96" แบบ I2C',
  description:
    'จอ OLED รับไฟ 3V3 ซึ่งเดินสายอ้อมด้านบนของบอร์ด ต่อ GND ขา SCL ต่อ GPIO 22 และขา SDA ต่อ GPIO 21 ตามขา I2C เริ่มต้นของ ESP32 สายไฟเลี้ยงข้ามสาย SCL และ SDA โดยไม่เชื่อมกัน',
  size: SINGLE_SIZE,
  parts: [
    ESP32,
    {
      device: 'oled-096-i2c',
      label: 'จอ OLED 0.96" I2C',
      at: [560, 300],
      scale: 0.6,
      labelAt: [0, 192],
    },
  ],
  wires: [
    {
      label: '3V3 → OLED ขา VCC',
      from: [0, '3V3'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 270, 62, 634.28],
    },
    { label: 'GND → OLED ขา GND', from: [0, 'GND-R2'], to: [1, 'GND'], color: WIRE.ground },
    {
      label: 'GPIO 22 (SCL) → OLED ขา SCL',
      from: [0, 'GPIO22'],
      to: [1, 'SCL'],
      color: WIRE.signalAlt,
    },
    {
      label: 'GPIO 21 (SDA) → OLED ขา SDA',
      from: [0, 'GPIO21'],
      to: [1, 'SDA'],
      color: WIRE.signal,
    },
  ],
  notes: [USB_NOTE],
  materials: 'จอ OLED 0.96" SSD1306 แบบ I2C 4 ขา 1 ตัว · สายจัมเปอร์ 4 เส้น',
  tips: [
    'ใช้ไลบรารี Adafruit SSD1306 เรียก display.begin(SSD1306_SWITCHCAPVCC, 0x3C) จอส่วนใหญ่ใช้แอดเดรส 0x3C บางรุ่นเป็น 0x3D',
    'ลำดับขาบนจอแต่ละรุ่นไม่เหมือนกัน บางรุ่นเริ่มที่ VCC แทน GND ให้อ่านชื่อขาบนแผงก่อนต่อ',
  ],
};

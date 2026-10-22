import { WIRE, type WiringExampleSpec } from '../wiring-diagram';
import { ESP32, SINGLE_SIZE, USB_NOTE } from './esp32-layout';

export const LDR_EXAMPLE: WiringExampleSpec = {
  id: 'ldr',
  name: 'วัดแสง LDR',
  title: 'วัดความสว่างด้วยโมดูล LDR',
  description:
    'โมดูล LDR รับไฟ 3V3 และ GND จากบอร์ด ขา AO ต่อ GPIO 34 เพื่ออ่านค่าแอนะล็อก ขา DO ไม่ต่อ สาย GND ข้ามสาย AO โดยไม่เชื่อมกัน',
  size: SINGLE_SIZE,
  parts: [ESP32, { device: 'ldr', label: 'โมดูล LDR วัดแสง', at: [20, 147.18], scale: 0.6 }],
  wires: [
    {
      label: '3V3 → LDR ขา VCC',
      from: [0, '3V3'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 250],
    },
    {
      label: 'GND → LDR ขา GND',
      from: [0, 'GND-L'],
      to: [1, 'GND'],
      color: WIRE.ground,
      route: ['h', 265],
    },
    { label: 'LDR ขา AO → GPIO 34', from: [1, 'AO'], to: [0, 'GPIO34'], color: WIRE.signal },
  ],
  notes: [USB_NOTE, { at: [20, 260], text: 'DO ไม่ต่อ · ใช้ AO' }],
  materials: 'โมดูล LDR แบบ 4 ขา (VCC, GND, DO, AO) 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'อ่านด้วย analogRead(34) ได้ 0 ถึง 4095 ทิศของค่าเมื่อสว่างขึ้นต่างกันตามโมดูล ให้ดูค่าใน Serial ตอนปิดและเปิดไฟก่อนตั้งเกณฑ์',
    'เลี้ยงโมดูลด้วย 3.3V เพื่อให้ AO ไม่เกินแรงดันที่ GPIO รับได้',
    'ถ้าต้องการแค่สว่างหรือมืด ใช้ขา DO กับ digitalRead แทนได้ แล้วปรับเกณฑ์ที่ตัวปรับบนโมดูล',
  ],
};

export const IR_OBSTACLE_EXAMPLE: WiringExampleSpec = {
  id: 'ir-obstacle',
  name: 'ตรวจจับวัตถุ IR',
  title: 'ตรวจจับวัตถุด้วยเซนเซอร์อินฟราเรด',
  description:
    'โมดูล IR รับไฟ 3V3 และ GND ขา OUT ต่อ GPIO 13 เพื่ออ่านค่าดิจิทัลว่ามีวัตถุอยู่ด้านหน้าหรือไม่',
  size: SINGLE_SIZE,
  parts: [
    ESP32,
    {
      device: 'ir-obstacle',
      label: 'เซนเซอร์ตรวจจับวัตถุ IR',
      at: [0, 300],
      scale: 0.6,
      labelAt: [10, -18],
    },
  ],
  wires: [
    {
      label: '3V3 → IR ขา VCC',
      from: [0, '3V3'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 230],
    },
    {
      label: 'GND → IR ขา GND',
      from: [0, 'GND-L'],
      to: [1, 'GND'],
      color: WIRE.ground,
      route: ['h', 265],
      badge: [230, 334.44],
    },
    {
      label: 'IR ขา OUT → GPIO 13',
      from: [1, 'OUT'],
      to: [0, 'GPIO13'],
      color: WIRE.signal,
      route: ['h', 245],
      badge: [268, 389.3],
    },
  ],
  notes: [USB_NOTE],
  materials: 'โมดูล IR ตรวจจับวัตถุแบบ 3 ขา 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'ตั้ง pinMode(13, INPUT) แล้วอ่าน digitalRead(13) โมดูลส่วนใหญ่ให้ LOW เมื่อพบวัตถุ ตรวจกับไฟแสดงสถานะบนโมดูล',
    'หมุนตัวปรับบนโมดูลเพื่อตั้งระยะตรวจจับ แสงแดดและพื้นผิวสีดำทำให้ระยะสั้นลง',
  ],
};

export const PIR_EXAMPLE: WiringExampleSpec = {
  id: 'pir',
  name: 'ตรวจจับคน PIR',
  title: 'ตรวจจับการเคลื่อนไหวด้วย PIR HC-SR501',
  description: 'HC-SR501 รับไฟ 5V จากขา VIN และต่อ GND ร่วม ขา OUT ให้สัญญาณ 3.3V ต่อเข้า GPIO 13',
  size: SINGLE_SIZE,
  parts: [ESP32, { device: 'pir-hc-sr501', label: 'PIR HC-SR501', at: [20, 170], scale: 0.6 }],
  wires: [
    {
      label: 'VIN (5V) → PIR ขา VCC',
      from: [0, 'VIN'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 240, 365],
      badge: [240, 415],
    },
    {
      label: 'PIR ขา OUT → GPIO 13',
      from: [1, 'OUT'],
      to: [0, 'GPIO13'],
      color: WIRE.signal,
      route: ['v', 345, 256],
      badge: [170, 345],
    },
    {
      label: 'GND → PIR ขา GND',
      from: [0, 'GND-L'],
      to: [1, 'GND'],
      color: WIRE.ground,
      route: ['h', 274, 325],
      badge: [230, 325],
    },
  ],
  notes: [USB_NOTE],
  materials: 'โมดูล PIR HC-SR501 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'HC-SR501 ต้องการไฟเลี้ยง 4.5V ขึ้นไป จึงใช้ขา VIN ที่ได้ 5V จาก USB ส่วนขา OUT ให้ระดับ 3.3V จึงต่อเข้า GPIO ได้โดยตรง',
    'อ่านด้วย digitalRead(13) ได้ HIGH เมื่อพบการเคลื่อนไหว หลังจ่ายไฟให้รอโมดูลปรับตัวประมาณ 1 นาทีก่อนเชื่อค่า',
    'ตัวปรับบนโมดูลตั้งความไวและเวลาค้างสัญญาณ จัมเปอร์เลือกโหมดยิงครั้งเดียวหรือยิงซ้ำ',
  ],
};

export const DHT22_EXAMPLE: WiringExampleSpec = {
  id: 'dht22',
  name: 'อุณหภูมิ DHT22',
  title: 'วัดอุณหภูมิและความชื้นด้วย DHT22',
  description:
    'DHT22 รับไฟ 3V3 และ GND ขา DATA ต่อ GPIO 23 มีตัวต้านทาน 10 กิโลโอห์มต่อพูลอัประหว่าง DATA กับ 3V3 ขา NC ไม่ต่อ',
  size: SINGLE_SIZE,
  parts: [
    ESP32,
    { device: 'dht22', label: 'DHT22', at: [640, 130], scale: 0.5 },
    {
      device: 'resistor',
      label: '10 kΩ',
      at: [569.1, 150],
      scale: 0.7,
      rotate: 90,
      state: { resistance: 10000 },
      labelAt: [3, 50],
    },
  ],
  wires: [
    {
      label: '3V3 → ตัวต้านทาน 10 kΩ ขาบน',
      from: [0, '3V3'],
      to: [2, '1'],
      color: WIRE.power,
      route: ['h', 270, 62, 560],
    },
    {
      label: 'ตัวต้านทาน ขาบน → DHT22 ขา VCC',
      from: [2, '1'],
      to: [1, 'VCC'],
      color: WIRE.power,
      route: ['h', 625, 300],
    },
    {
      label: 'GPIO 23 → ตัวต้านทาน ขาล่าง',
      from: [0, 'GPIO23'],
      to: [2, '2'],
      color: WIRE.signal,
      route: ['h', 520, 230.5],
    },
    {
      label: 'ตัวต้านทาน ขาล่าง → DHT22 ขา DATA',
      from: [2, '2'],
      to: [1, 'DATA'],
      color: WIRE.signal,
      route: ['v', 315],
    },
    {
      label: 'DHT22 ขา GND → GND',
      from: [1, 'GND'],
      to: [0, 'GND-R2'],
      color: WIRE.ground,
      route: ['v', 335, 500],
    },
  ],
  notes: [USB_NOTE, { at: [640, 370], text: 'NC ไม่ต่อ' }],
  materials: 'DHT22 แบบ 4 ขา 1 ตัว · ตัวต้านทาน 10 kΩ 1 ตัว · สายจัมเปอร์ 5 เส้น',
  tips: [
    'ใช้ไลบรารี DHT sensor library สร้าง DHT dht(23, DHT22) เรียก dht.begin() แล้วอ่าน readTemperature() และ readHumidity()',
    'DHT22 วัดได้ไม่เกินครั้งละ 2 วินาที ถ้าอ่านเร็วกว่านั้นจะได้ค่าเดิมหรือ NaN',
    'ตัวต้านทาน 10 kΩ ดึงสาย DATA ขึ้นไป 3V3 ถ้าใช้โมดูล DHT22 แบบ 3 ขาที่มีตัวต้านทานบนแผงแล้วไม่ต้องเพิ่ม',
  ],
};

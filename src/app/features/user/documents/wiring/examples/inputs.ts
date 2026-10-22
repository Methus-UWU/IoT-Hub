import { WIRE, type WiringExampleSpec } from '../wiring-diagram';
import { ESP32, SINGLE_SIZE, USB_NOTE } from './esp32-layout';

export const BUTTON_EXAMPLE: WiringExampleSpec = {
  id: 'button',
  name: 'ปุ่มกด',
  title: 'ปุ่มกดแบบใช้ตัวต้านทานพูลอัปภายใน',
  description:
    'ESP32 GPIO 18 ต่อขา 1 ของปุ่มกด ขา 3 ของปุ่มต่อ GND ใช้ INPUT_PULLUP ภายในบอร์ด จึงไม่ต้องต่อไฟ 3.3V เข้าปุ่ม',
  size: SINGLE_SIZE,
  parts: [ESP32, { device: 'button', label: 'ปุ่มกด', at: [560, 274.62], scale: 0.8 }],
  wires: [
    { label: 'GPIO 18 → ปุ่มกด ขา 1', from: [0, 'GPIO18'], to: [1, '1'], color: WIRE.signal },
    {
      label: 'GND → ปุ่มกด ขา 3',
      from: [0, 'GND-R2'],
      to: [1, '3'],
      color: WIRE.ground,
      route: ['h', 500, 225, 660],
    },
  ],
  notes: [USB_NOTE],
  materials: 'ปุ่มกดแบบชั่วขณะ 1 ตัว · สายจัมเปอร์ 2 เส้น',
  tips: [
    'ตั้ง pinMode(18, INPUT_PULLUP) แล้วอ่าน digitalRead(18) ปล่อยปุ่มได้ HIGH กดปุ่มได้ LOW',
    'ขา 1 กับ 2 และขา 3 กับ 4 เชื่อมกันอยู่แล้ว ให้ต่อคร่อมคนละฝั่งของปุ่ม หากอ่านได้ LOW ตลอดแปลว่าเลือกขาคู่ที่เชื่อมกันถาวร',
    'งานนับจำนวนครั้งที่กดควรกรองการเด้งของหน้าสัมผัส (debounce) ในโค้ด',
  ],
};

export const POTENTIOMETER_EXAMPLE: WiringExampleSpec = {
  id: 'potentiometer',
  name: 'โพเทนชิโอมิเตอร์',
  title: 'อ่านค่าแอนะล็อกจากโพเทนชิโอมิเตอร์',
  description:
    'ขา VCC ของโพเทนชิโอมิเตอร์ต่อ 3V3 ขา GND ต่อ GND และขา SIG (ขากลาง) ต่อ GPIO 34 ซึ่งเป็นขา ADC1 แบบอินพุตอย่างเดียว',
  size: SINGLE_SIZE,
  parts: [
    ESP32,
    { device: 'potentiometer', label: 'โพเทนชิโอมิเตอร์ 10 kΩ', at: [40, 120], scale: 0.6 },
  ],
  wires: [
    {
      label: '3V3 → โพเทนชิโอมิเตอร์ ขา VCC',
      from: [0, '3V3'],
      to: [1, '3'],
      color: WIRE.power,
      route: ['h', 235, 305],
      badge: [170, 305],
    },
    {
      label: 'โพเทนชิโอมิเตอร์ ขา SIG → GPIO 34',
      from: [1, 'WIPER'],
      to: [0, 'GPIO34'],
      color: WIRE.signal,
      route: ['v', 325, 250],
      badge: [250, 270],
    },
    {
      label: 'GND → โพเทนชิโอมิเตอร์ ขา GND',
      from: [0, 'GND-L'],
      to: [1, '1'],
      color: WIRE.ground,
      route: ['h', 265, 345],
      badge: [200, 345],
    },
  ],
  notes: [USB_NOTE],
  materials: 'โพเทนชิโอมิเตอร์ 10 kΩ 1 ตัว · สายจัมเปอร์ 3 เส้น',
  tips: [
    'อ่านด้วย analogRead(34) ได้ค่า 0 ถึง 4095 ตามตำแหน่งที่หมุน ไม่ต้องตั้ง pinMode',
    'ใช้ขา ADC1 (GPIO 32–39) เพราะขา ADC2 อ่านค่าไม่ได้ขณะเปิด Wi-Fi',
    'ถ้าค่ากลับทิศ ให้สลับสาย 3V3 กับ GND ห้ามต่อขา VCC เข้า 5V เพราะขา SIG จะส่งแรงดันเกินที่ GPIO รับได้',
  ],
};

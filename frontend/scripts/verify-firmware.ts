/**
 * End-to-end check for the firmware simulator.
 *
 * Builds real circuits from catalog parts, runs the real solver, and asserts on
 * the node voltages it resolves. Nothing here stubs the interpreter or the
 * simulator: if this passes, a sketch genuinely drove a pin and the pin genuinely
 * lit an LED.
 *
 * Run it from `frontend/`:
 *
 *   node_modules/@esbuild/win32-x64/esbuild.exe scripts/verify-firmware.ts \
 *     --bundle --platform=node --format=cjs --outfile=.tmp/verify-firmware.cjs \
 *     && node .tmp/verify-firmware.cjs
 *
 * On other platforms swap the esbuild binary path (`node_modules/.bin/esbuild`).
 */

import { deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import {
  devicePinKey,
  simulateTick,
} from '../src/app/features/user/workspace/virtual-device/simulation/circuit-simulator';
import type { DeviceBehavior } from '../src/app/features/user/workspace/virtual-device/devices/core/device-simulation';
import {
  attachFirmware,
  clearFirmware,
} from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-bus';
import { FirmwareMachine } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-machine';
import { validateCircuit } from '../src/app/features/user/workspace/virtual-device/simulation/wire-validation';
import type {
  VirtualDevice,
  WireConnection,
} from '../src/app/features/user/workspace/virtual-device/models/virtual-device.model';

const TICK_MS = 50;

interface Placed {
  readonly instanceId: string;
  readonly definition: VirtualDevice;
  readonly properties: Record<string, string | number | boolean>;
}

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

function place(id: string, instanceId: string, properties: Record<string, string | number | boolean> = {}): Placed {
  const definition = deviceById(id);
  if (!definition) throw new Error(`ไม่พบอุปกรณ์ ${id} ใน catalog`);
  return { instanceId, definition, properties };
}

function wire(a: [string, string], b: [string, string], index: number): WireConnection {
  return {
    id: `w${index}`,
    start: { type: 'device', deviceId: a[0], pinId: a[1] },
    end: { type: 'device', deviceId: b[0], pinId: b[1] },
    waypoints: [],
    color: '#000',
    kind: 'signal',
  };
}

class Rig {
  private readonly behaviors = new Map<string, DeviceBehavior>();
  private result = simulateTick({ devices: [], connections: [], deltaMs: 0 }, this.behaviors);

  constructor(
    private readonly devices: readonly Placed[],
    private readonly connections: readonly WireConnection[],
  ) {
    for (const device of devices) {
      const factory = device.definition.simulation;
      if (factory) this.behaviors.set(device.instanceId, factory(device.instanceId));
    }
  }

  tick(count = 1, deltaMs = TICK_MS): void {
    for (let i = 0; i < count; i++) {
      this.result = simulateTick(
        { devices: this.devices, connections: this.connections, deltaMs },
        this.behaviors,
      );
    }
  }

  voltage(instanceId: string, pinName: string): number {
    const state = this.result.pinStates.get(devicePinKey(instanceId, pinName));
    if (!state || state.floating) return Number.NaN;
    return Math.round(state.voltage * 100) / 100;
  }

  floating(instanceId: string, pinName: string): boolean {
    return this.result.pinStates.get(devicePinKey(instanceId, pinName))?.floating ?? true;
  }

  /** Nodes where two strong drivers disagreed on the last tick. */
  shortCount(): number {
    return this.result.shorts.length;
  }

  runtime(instanceId: string, key: string): string | number | boolean | undefined {
    return this.result.runtime[instanceId]?.[key];
  }

  setProperty(instanceId: string, key: string, value: string | number | boolean): void {
    const device = this.devices.find((candidate) => candidate.instanceId === instanceId);
    if (!device) throw new Error(`ไม่พบอุปกรณ์ ${instanceId}`);
    device.properties[key] = value;
  }
}

function load(instanceId: string, board: VirtualDevice, source: string): FirmwareMachine {
  const compiled = FirmwareMachine.compile(board, source);
  if (!compiled.machine) {
    throw new Error(`คอมไพล์ไม่ผ่านบรรทัด ${compiled.fault.line}: ${compiled.fault.message}`);
  }
  attachFirmware(instanceId, compiled.machine);
  return compiled.machine;
}

// --- 1. a sketch drives a pin -----------------------------------------------

function testDigitalWrite(): void {
  console.log('\n1. digitalWrite ขับขาได้จริง');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  load('board', board.definition, `
    void setup() {
      pinMode(2, OUTPUT);
      digitalWrite(2, HIGH);
      pinMode(4, OUTPUT);
      digitalWrite(4, LOW);
    }
    void loop() {}
  `);

  check('ก่อนรัน ขา GPIO2 ลอย', rig.floating('board', 'GPIO2'), true);
  rig.tick(2);
  check('หลังรัน GPIO2 เป็น 3.3 V', rig.voltage('board', 'GPIO2'), 3.3);
  check('GPIO4 ที่เขียน LOW เป็น 0 V', rig.voltage('board', 'GPIO4'), 0);
  check('ขาที่ไม่ได้แตะยังลอยอยู่', rig.floating('board', 'GPIO5'), true);
}

// --- 2. the classic circuit the user asked about -----------------------------

function testButtonRelayLed(): void {
  console.log('\n2. กดปุ่ม → โค้ดสั่งรีเลย์ → LED ติด');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const button = place('button', 'btn', { pressed: false, mode: 'no' });
  const relay = place('relay', 'relay', {});
  const led = place('led', 'led', { color: 'red' });
  const resistor = place('resistor', 'r', { resistance: 220 });

  const connections = [
    // ปุ่มระหว่าง GPIO15 กับกราวด์ อ่านด้วยพูลอัปในตัวชิป
    wire(['board', 'GPIO15'], ['btn', '1'], 1),
    wire(['btn', '3'], ['board', 'GND-L'], 2),
    // ไฟเลี้ยงรีเลย์จากบอร์ด และขาควบคุมจาก GPIO26
    wire(['board', 'VIN'], ['relay', 'VCC'], 3),
    wire(['board', 'GND-R'], ['relay', 'GND'], 4),
    wire(['board', 'GPIO26'], ['relay', 'IN'], 5),
    // หน้าสัมผัสรีเลย์จ่ายไฟให้ LED ผ่านตัวต้านทาน
    wire(['board', 'VIN'], ['relay', 'COM'], 6),
    wire(['relay', 'NO'], ['r', '1'], 7),
    wire(['r', '2'], ['led', 'A'], 8),
    wire(['led', 'K'], ['board', 'GND-R'], 9),
  ];

  const rig = new Rig([board, button, relay, led, resistor], connections);
  load('board', board.definition, `
    const int BUTTON_PIN = 15;
    const int RELAY_PIN = 26;

    void setup() {
      pinMode(BUTTON_PIN, INPUT_PULLUP);
      pinMode(RELAY_PIN, OUTPUT);
      digitalWrite(RELAY_PIN, HIGH);   // โมดูลรีเลย์เป็น active-low จึงเริ่มที่ดับ
    }

    void loop() {
      if (digitalRead(BUTTON_PIN) == LOW) {
        digitalWrite(RELAY_PIN, LOW);  // กดแล้วรีเลย์ทำงาน
      } else {
        digitalWrite(RELAY_PIN, HIGH);
      }
    }
  `);

  rig.tick(4);
  check('ยังไม่กด: LED ดับ', rig.runtime('led', 'brightness'), 0);
  check('ยังไม่กด: รีเลย์ไม่ทำงาน', rig.runtime('relay', 'ch1'), false);
  check('พูลอัปดึงขาปุ่มขึ้น 3.3 V', rig.voltage('board', 'GPIO15'), 3.3);

  rig.setProperty('btn', 'pressed', true);
  rig.tick(4);
  check('กดแล้ว: ขาปุ่มถูกดึงลง 0 V', rig.voltage('board', 'GPIO15'), 0);
  check('กดแล้ว: รีเลย์ทำงาน', rig.runtime('relay', 'ch1'), true);
  check('กดแล้ว: LED สว่าง', rig.runtime('led', 'brightness'), 100);

  rig.setProperty('btn', 'pressed', false);
  rig.tick(4);
  check('ปล่อยแล้ว: LED ดับอีกครั้ง', rig.runtime('led', 'brightness'), 0);
}

// --- 3. delay() suspends without blocking ------------------------------------

function testBlink(): void {
  console.log('\n3. delay() หน่วงเวลาโดยไม่ค้าง');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  load('board', board.definition, `
    void setup() { pinMode(2, OUTPUT); }
    void loop() {
      digitalWrite(2, HIGH);
      delay(500);
      digitalWrite(2, LOW);
      delay(500);
    }
  `);

  rig.tick(2);
  check('เริ่มต้นติด', rig.voltage('board', 'GPIO2'), 3.3);
  rig.tick(6); // 300 มิลลิวินาที ยังไม่ครบครึ่งวินาที
  check('ที่ 400 ms ยังติดอยู่', rig.voltage('board', 'GPIO2'), 3.3);
  rig.tick(6); // ผ่าน 500 ms ไปแล้ว
  check('ผ่าน 500 ms แล้วดับ', rig.voltage('board', 'GPIO2'), 0);
  rig.tick(11);
  check('ครบรอบแล้วกลับมาติด', rig.voltage('board', 'GPIO2'), 3.3);
}

// --- 4. PWM lands between the rails ------------------------------------------

function testPwm(): void {
  console.log('\n4. analogWrite ให้แรงดันระหว่างกลาง');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  load('board', board.definition, `
    void setup() {
      pinMode(25, OUTPUT);
      analogWrite(25, 128);
    }
    void loop() {}
  `);

  rig.tick(2);
  check('duty 128/255 ของ 3.3 V', rig.voltage('board', 'GPIO25'), 1.66);
}

// --- 5. analogRead sees the real node ----------------------------------------

function testAnalogRead(): void {
  console.log('\n5. analogRead อ่านแรงดันจริงจากวงจร');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], [wire(['board', '3V3'], ['board', 'GPIO34'], 1)]);
  load('board', board.definition, `
    int reading = 0;
    void setup() {}
    void loop() {
      reading = analogRead(34);
      // เขียนออกขาอื่นเพื่อให้ตรวจค่าที่อ่านได้จากภายนอก
      if (reading > 4000) { digitalWrite(26, HIGH); } else { digitalWrite(26, LOW); }
    }
  `);

  rig.tick(4);
  check('ต่อ 3V3 เข้าขา ADC แล้วอ่านได้เต็มสเกล', rig.voltage('board', 'GPIO26'), 3.3);
}

// --- 6. faults are reported, not swallowed -----------------------------------

function testFaults(): void {
  console.log('\n6. ข้อผิดพลาดถูกรายงานพร้อมเลขบรรทัด');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');

  const syntax = FirmwareMachine.compile(board.definition, 'void setup() { int x = ; }');
  check('ไวยากรณ์ผิดถูกจับตอนคอมไพล์', syntax.fault?.phase, 'compile');

  const missing = FirmwareMachine.compile(board.definition, 'int x = 1;');
  check('ไม่มี setup/loop ถูกปฏิเสธ', missing.fault?.phase, 'compile');

  const runtime = FirmwareMachine.compile(
    board.definition,
    'void setup() {}\nvoid loop() {\n  int a = 1 / 0;\n}',
  );
  if (!runtime.machine) throw new Error('ควรคอมไพล์ผ่าน');
  attachFirmware('board', runtime.machine);
  const rig = new Rig([board], []);
  rig.tick(3);
  check('หารด้วยศูนย์ถูกจับตอนรัน', runtime.machine.fault?.phase, 'run');
  check('รายงานเลขบรรทัดที่ถูกต้อง', runtime.machine.fault?.line, 3);
  check('สถานะเปลี่ยนเป็น error', runtime.machine.status, 'error');

  const unsupported = FirmwareMachine.compile(
    board.definition,
    'void setup() {}\nvoid loop() { someUnknownCall(1); }',
  );
  if (!unsupported.machine) throw new Error('ควรคอมไพล์ผ่าน');
  attachFirmware('board2', unsupported.machine);
  const board2 = place('esp32-devkit-v1', 'board2');
  new Rig([board2], []).tick(3);
  check('ฟังก์ชันที่ไม่รองรับถูกรายงาน', unsupported.machine.status, 'error');
}

// --- 7. a tight loop does not hang the page ----------------------------------

function testRunawayLoop(): void {
  console.log('\n7. ลูปไม่รู้จบไม่ทำให้ค้าง');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  load('board', board.definition, `
    void setup() { pinMode(2, OUTPUT); digitalWrite(2, HIGH); }
    void loop() { while (true) { } }
  `);

  const startedAt = Date.now();
  rig.tick(3);
  const elapsed = Date.now() - startedAt;
  check('ยังคืนค่ามาได้ ไม่ค้าง', elapsed < 5000, true);
  check('ขาที่ตั้งไว้ใน setup ยังถูกขับอยู่', rig.voltage('board', 'GPIO2'), 3.3);
}

// --- 8. Arduino pin numbering ------------------------------------------------

function testArduinoPins(): void {
  console.log('\n8. บอร์ด Arduino ใช้เลขขาแบบของตัวเอง');
  clearFirmware();

  const board = place('arduino-uno-r3', 'uno');
  const rig = new Rig([board], []);
  load('uno', board.definition, `
    void setup() {
      pinMode(LED_BUILTIN, OUTPUT);
      digitalWrite(LED_BUILTIN, HIGH);
      pinMode(9, OUTPUT);
      analogWrite(9, 255);
    }
    void loop() {}
  `);

  rig.tick(2);
  check('LED_BUILTIN คือขา 13 ที่ 5 V', rig.voltage('uno', '13'), 5);
  check('ขา ~9 ที่มีเครื่องหมาย PWM ก็ยังหาเจอ', rig.voltage('uno', '9'), 5);
}

// --- 9. serial output --------------------------------------------------------

function testSerial(): void {
  console.log('\n9. Serial เก็บข้อความที่พิมพ์');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  const machine = load('board', board.definition, `
    void setup() {
      Serial.begin(115200);
      while (!Serial) { delay(10); }
      Serial.println("พร้อมทำงาน");
      Serial.print("ค่า: ");
      Serial.println(42);
    }
    void loop() { delay(1000); }
  `);

  rig.tick(2);
  check('เก็บข้อความครบ', machine.takeSerialOutput().join(''), 'พร้อมทำงาน\nค่า: 42\n');
  check('อ่านแล้วบัฟเฟอร์ว่าง', machine.takeSerialOutput().length, 0);
  check('จำอัตราบอดจาก Serial.begin', machine.serialBaud, 115200);
}

// --- 10. PWM dims an LED in proportion to 0-255 --------------------------------

function pwmLedRig(value: number, sink: boolean): Rig {
  clearFirmware();
  const board = place('esp32-devkit-v1', 'board');
  const resistor = place('resistor', 'r', { resistance: 220 });
  const led = place('led', 'led', { color: 'red' });
  const connections = sink
    ? [
        // LED from the 3V3 rail into the GPIO, which sinks current while low.
        wire(['board', '3V3'], ['r', '1'], 1),
        wire(['r', '2'], ['led', 'A'], 2),
        wire(['led', 'K'], ['board', 'GPIO25'], 3),
      ]
    : [
        wire(['board', 'GPIO25'], ['r', '1'], 1),
        wire(['r', '2'], ['led', 'A'], 2),
        wire(['led', 'K'], ['board', 'GND-L'], 3),
      ];
  const rig = new Rig([board, resistor, led], connections);
  load('board', board.definition, `
    void setup() {
      pinMode(25, OUTPUT);
      analogWrite(25, ${value});
    }
    void loop() {}
  `);
  rig.tick(3);
  return rig;
}

function testPwmDimsLed(): void {
  console.log('\n10. analogWrite หรี่ LED ตามค่า 0-255');
  for (const [value, expected] of [
    [0, 0],
    [64, 25],
    [128, 50],
    [191, 75],
    [255, 100],
  ] as const) {
    check(`analogWrite(25, ${value}) → LED สว่าง ${expected}%`, pwmLedRig(value, false).runtime('led', 'brightness'), expected);
  }
  check('แรงดันเฉลี่ยที่ขายังเป็นค่าเดิม (128 → 1.66 V)', pwmLedRig(128, false).voltage('board', 'GPIO25'), 1.66);
  check('ต่อ LED แบบขาดึงลง: duty 191 ติดแค่ช่วงที่ขาเป็น LOW = 25%', pwmLedRig(191, true).runtime('led', 'brightness'), 25);

  // RGB LED: a common-cathode channel lights while its pin is high; a
  // common-anode channel lights while its pin is low.
  clearFirmware();
  const board = place('esp32-devkit-v1', 'board');
  const cathode = place('rgb-led-common-cathode', 'rgbk', {});
  const anode = place('rgb-led-common-anode', 'rgba', {});
  const rig = new Rig(
    [board, cathode, anode],
    [
      wire(['board', 'GPIO25'], ['rgbk', 'R'], 1),
      wire(['rgbk', 'CATH'], ['board', 'GND-L'], 2),
      wire(['board', '3V3'], ['rgba', 'ANODE'], 3),
      wire(['rgba', 'G'], ['board', 'GPIO26'], 4),
    ],
  );
  load('board', board.definition, `
    void setup() {
      pinMode(25, OUTPUT);
      pinMode(26, OUTPUT);
      analogWrite(25, 128);
      analogWrite(26, 191);
    }
    void loop() {}
  `);
  rig.tick(3);
  check('RGB แคโทดร่วม: R ที่ 128 → ครึ่งหนึ่ง (128/255)', rig.runtime('rgbk', 'red'), 128);
  check('RGB แอโนดร่วม: G ที่ 191 ติดช่วง LOW → 64/255', rig.runtime('rgba', 'green'), 64);
}

// --- 11. VCC and GND must return to one supply --------------------------------

function testSameSupply(): void {
  console.log('\n11. VCC กับ GND ต้องมาจากแหล่งจ่ายเดียวกัน');
  clearFirmware();

  const soil = (connections: [[string, string], [string, string]][]) => {
    const rig = new Rig(
      [place('esp32-devkit-v1', 'board'), place('soil-moisture-capacitive', 'soil'), place('gnd', 'gnd')],
      connections.map(([a, b], index) => wire(a, b, index)),
    );
    rig.tick(3);
    return rig;
  };

  const boardOnly = soil([
    [['soil', 'VCC'], ['board', '3V3']],
    [['soil', 'GND'], ['board', 'GND-L']],
  ]);
  check('เซนเซอร์: VCC และ GND จากบอร์ด → ทำงาน', boardOnly.runtime('soil', 'powered'), true);

  const split = soil([
    [['soil', 'VCC'], ['board', '3V3']],
    [['soil', 'GND'], ['gnd', 'GND']],
  ]);
  check('เซนเซอร์: VCC จากบอร์ด แต่ GND ที่สัญลักษณ์ → ไม่ทำงาน', split.runtime('soil', 'powered'), false);
  check('เซนเซอร์ที่ไม่ทำงานปล่อย AOUT ลอย', split.floating('soil', 'AOUT'), true);

  const common = soil([
    [['soil', 'VCC'], ['board', '3V3']],
    [['soil', 'GND'], ['gnd', 'GND']],
    [['board', 'GND-L'], ['gnd', 'GND']],
  ]);
  check('ต่อ GND บอร์ดเข้าสัญลักษณ์ GND (กราวด์ร่วม) → ทำงาน', common.runtime('soil', 'powered'), true);

  const pump = (groundTo: [string, string]) => {
    const rig = new Rig(
      [place('esp32-devkit-v1', 'board'), place('vcc-5v', 'vcc'), place('gnd', 'gnd'), place('gnd', 'gnd2'), place('water-pump', 'pump')],
      [wire(['vcc', 'VCC'], ['pump', '+'], 1), wire(['pump', '-'], groundTo, 2)],
    );
    rig.tick(3);
    return rig.runtime('pump', 'pumping');
  };
  check('ปั๊ม: สัญลักษณ์ VCC 5V กับสัญลักษณ์ GND → หมุน', pump(['gnd', 'GND']), true);
  check('ปั๊ม: สัญลักษณ์ GND คนละตัวก็เป็นแหล่งเดียวกัน → หมุน', pump(['gnd2', 'GND']), true);
  check('ปั๊ม: สัญลักษณ์ VCC 5V แต่ GND ของบอร์ด → ไม่หมุน', pump(['board', 'GND-R']), false);

  const relay = new Rig(
    [place('esp32-devkit-v1', 'board'), place('vcc-5v', 'vcc'), place('relay', 'relay')],
    [wire(['vcc', 'VCC'], ['relay', 'VCC'], 1), wire(['relay', 'GND'], ['board', 'GND-R'], 2)],
  );
  relay.tick(3);
  check('รีเลย์: VCC จากสัญลักษณ์ แต่ GND ของบอร์ด → ไฟ PWR ไม่ติด', relay.runtime('relay', 'powered'), false);
}

// --- 12. inspector settings change behaviour ----------------------------------

function testInspectorSettings(): void {
  console.log('\n12. ค่าที่ตั้งในแผงด้านขวาเปลี่ยนพฤติกรรมจริง');

  const relay = (trigger: string, level: 'HIGH' | 'LOW') => {
    clearFirmware();
    const board = place('esp32-devkit-v1', 'board');
    const rig = new Rig(
      [board, place('relay', 'relay', { trigger })],
      [
        wire(['board', 'VIN'], ['relay', 'VCC'], 1),
        wire(['board', 'GND-R'], ['relay', 'GND'], 2),
        wire(['board', 'GPIO26'], ['relay', 'IN'], 3),
      ],
    );
    load('board', board.definition, `
      void setup() { pinMode(26, OUTPUT); digitalWrite(26, ${level}); }
      void loop() {}
    `);
    rig.tick(4);
    return rig.runtime('relay', 'ch1');
  };
  check('รีเลย์สั่งงานด้วย LOW: IN เป็น LOW → ทำงาน', relay('low', 'LOW'), true);
  check('รีเลย์สั่งงานด้วย LOW: IN เป็น HIGH → ไม่ทำงาน', relay('low', 'HIGH'), false);
  check('รีเลย์สั่งงานด้วย HIGH: IN เป็น HIGH → ทำงาน', relay('high', 'HIGH'), true);
  check('รีเลย์สั่งงานด้วย HIGH: IN เป็น LOW → ไม่ทำงาน', relay('high', 'LOW'), false);
  clearFirmware();

  const load2 = (definitionId: string, plus: string, minus: string, key: string) =>
    (rated: string, supply: string) => {
      const rig = new Rig(
        [place(supply, 'vcc'), place('gnd', 'gnd'), place(definitionId, 'load', { ratedVoltage: rated })],
        [wire(['vcc', 'VCC'], ['load', plus], 1), wire(['load', minus], ['gnd', 'GND'], 2)],
      );
      rig.tick(3);
      return rig.runtime('load', key);
    };
  const pump = load2('water-pump', '+', '-', 'pumping');
  const motor = load2('dc-motor', 'M+', 'M−', 'spinning');
  check('ปั๊ม 5V ต่อไฟ 5V → หมุน', pump('5', 'vcc-5v'), true);
  check('ปั๊ม 12V ต่อไฟ 5V → ไม่หมุน (ไม่ถึงครึ่งพิกัด)', pump('12', 'vcc-5v'), false);
  check('ปั๊ม 3V ต่อไฟ 3.3V → หมุน', pump('3', 'vcc-3v3'), true);
  check('มอเตอร์ 5V ต่อไฟ 5V → หมุน', motor('5', 'vcc-5v'), true);
  check('มอเตอร์ 12V ต่อไฟ 5V → ไม่หมุน', motor('12', 'vcc-5v'), false);
  check('มอเตอร์ 12V ต่อไฟ 12V → หมุน', motor('12', 'vcc-12v'), true);

  const overvoltage = (rated: string) =>
    validateCircuit({
      devices: [
        { instanceId: 'vcc', definition: place('vcc-12v', 'vcc').definition },
        { instanceId: 'pump', definition: place('water-pump', 'pump').definition, properties: { ratedVoltage: rated } },
      ],
      connections: [wire(['vcc', 'VCC'], ['pump', '+'], 1)],
    }).some((issue) => issue.code === 'overvoltage');
  check('ปั๊ม 5V ต่อราง 12V → เตือนแรงดันเกิน', overvoltage('5'), true);
  check('ปั๊ม 12V ต่อราง 12V → ไม่เตือน', overvoltage('12'), false);
}

console.log('ตรวจตัวจำลองเฟิร์มแวร์');
testDigitalWrite();
testButtonRelayLed();
testBlink();
testPwm();
testAnalogRead();
testFaults();

// --- 13. library emulation --------------------------------------------------

function testLibraries(): void {
  console.log('\n13. library ที่โค้ดจริงใช้ ทำงานกับอุปกรณ์บน canvas');

  // DHT22 on GPIO4, OLED on the default I2C pins, both from the 3V3 rail.
  const sketch = `
    #include <DHT.h>
    #include <Wire.h>
    #include <Adafruit_SSD1306.h>
    #define SCREEN_WIDTH 128
    Adafruit_SSD1306 display(SCREEN_WIDTH, 64, &Wire, -1);
    DHT dht(4, DHT22);
    enum Mode { IDLE, HOT = 5, HOTTER };
    Mode mode = IDLE;
    bool found = false;
    void setup() {
      Serial.begin(115200);
      dht.begin();
      found = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
      Serial.printf("oled=%d\\n", found ? 1 : 0);
    }
    void loop() {
      float t = dht.readTemperature();
      switch (t > 30 ? HOT : IDLE) {
        case HOT: mode = HOT; break;
        default: mode = IDLE;
      }
      display.clearDisplay();
      display.setCursor(0, 0);
      display.print(F("Temp: "));
      display.print(t, 1);
      display.setCursor(0, 16);
      display.print(mode == HOT ? "HOT" : "OK");
      display.display();
      Serial.printf("t=%.1f h=%.0f\\n", t, dht.readHumidity());
      delay(500);
    }
  `;

  const libraryRig = (withOled: boolean, dhtPin = 'GPIO4') => {
    clearFirmware();
    const board = place('esp32-devkit-v1', 'board');
    const sensor = place('dht22', 'dht', { temperature: 32.5, humidity: 61 });
    const oled = place('oled-096-i2c', 'oled');
    let index = 0;
    const wires = [
      wire(['dht', 'VCC'], ['board', '3V3'], index++),
      wire(['dht', 'GND'], ['board', 'GND-L'], index++),
      wire(['dht', 'DATA'], ['board', dhtPin], index++),
      ...(withOled
        ? [
            wire(['oled', 'VCC'], ['board', '3V3'], index++),
            wire(['oled', 'GND'], ['board', 'GND-L'], index++),
            wire(['oled', 'SDA'], ['board', 'GPIO21'], index++),
            wire(['oled', 'SCL'], ['board', 'GPIO22'], index++),
          ]
        : []),
    ];
    const rig = new Rig([board, sensor, oled], wires);
    const machine = load('board', board.definition, sketch);
    rig.tick(4);
    return { rig, machine };
  };

  const wired = libraryRig(true);
  const serial = wired.machine.takeSerialOutput().join('');
  check('โค้ดที่ใช้ DHT + SSD1306 คอมไพล์และรันได้', wired.machine.fault, null);
  check('display.begin() เจอจอที่ต่ออยู่', serial.includes('oled=1'), true);
  check('dht.readTemperature() ได้ค่าจาก inspector', serial.includes('t=32.5 h=61'), true);
  // Runs are `x|y|size|text` on the 128×64 grid; a space splits a run.
  const frame = JSON.parse(String(wired.rig.runtime('oled', 'frame') ?? '[]')) as string[];
  check('จอแสดงอุณหภูมิที่พิกเซล (0,0) และ (36,0)', frame.slice(0, 2), ['0|0|1|Temp:', '36|0|1|32.5']);
  check('enum + switch เลือกสถานะถูก และขึ้นที่ y = 16', frame[2], '0|16|1|HOT');

  // A line longer than 21 cells stops at the panel edge instead of overflowing.
  clearFirmware();
  {
    const board = place('esp32-devkit-v1', 'board');
    const oled = place('oled-096-i2c', 'oled');
    const rig = new Rig(
      [board, oled],
      [
        wire(['oled', 'VCC'], ['board', '3V3'], 0),
        wire(['oled', 'GND'], ['board', 'GND-L'], 1),
        wire(['oled', 'SDA'], ['board', 'GPIO21'], 2),
        wire(['oled', 'SCL'], ['board', 'GPIO22'], 3),
      ],
    );
    load(
      'board',
      board.definition,
      `#include <Adafruit_SSD1306.h>
       Adafruit_SSD1306 display(128, 64, &Wire, -1);
       void setup() {
         display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
         display.setTextWrap(false);
         display.setCursor(0, 0);
         display.print("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
         display.setTextSize(2);
         display.setCursor(0, 56);
         display.print("LOW");
         display.display();
       }
       void loop() { delay(1000); }`,
    );
    rig.tick(4);
    const runs = JSON.parse(String(rig.runtime('oled', 'frame') ?? '[]')) as string[];
    check('ข้อความยาวถูกตัดที่ขอบจอ 21 ตัว', runs[0], '0|0|1|ABCDEFGHIJKLMNOPQRSTU');
    check('ข้อความขนาด 2 ที่ล้นขอบล่างไม่ถูกวาด', runs.length, 1);
  }

  const unwired = libraryRig(false);
  check(
    'จอที่ไม่ได้ต่อสาย display.begin() คืน false',
    unwired.machine.takeSerialOutput().join('').includes('oled=0'),
    true,
  );

  const wrongPin = libraryRig(true, 'GPIO5');
  check(
    'DHT ต่อผิดขา อ่านได้ nan เหมือนของจริง',
    wrongPin.machine.takeSerialOutput().join('').includes('t=nan'),
    true,
  );

  // Servo on GPIO13 from the 5 V rail.
  clearFirmware();
  {
    const board = place('esp32-devkit-v1', 'board');
    const servo = place('servo', 'servo');
    const rig = new Rig(
      [board, servo],
      [
        wire(['servo', 'VCC'], ['board', 'VIN'], 0),
        wire(['servo', 'GND'], ['board', 'GND-L'], 1),
        wire(['servo', 'PWM'], ['board', 'GPIO13'], 2),
      ],
    );
    load(
      'board',
      board.definition,
      `#include <ESP32Servo.h>
       Servo arm;
       void setup() { arm.attach(13); arm.write(135); }
       void loop() { delay(1000); }`,
    );
    rig.tick(4);
    check('Servo.write(135) หมุนแขนบน canvas', rig.runtime('servo', 'angle'), 135);
  }

  // DS18B20 on GPIO15 through OneWire.
  clearFirmware();
  {
    const board = place('esp32-devkit-v1', 'board');
    const probe = place('ds18b20', 'probe', { temperature: 21.5 });
    const rig = new Rig(
      [board, probe],
      [
        wire(['probe', 'VCC'], ['board', '3V3'], 0),
        wire(['probe', 'GND'], ['board', 'GND-L'], 1),
        wire(['probe', 'DATA'], ['board', 'GPIO15'], 2),
      ],
    );
    const machine = load(
      'board',
      board.definition,
      `#include <OneWire.h>
       #include <DallasTemperature.h>
       OneWire oneWire(15);
       DallasTemperature sensors(&oneWire);
       void setup() { Serial.begin(115200); sensors.begin(); }
       void loop() {
         sensors.requestTemperatures();
         Serial.println(sensors.getTempCByIndex(0));
         delay(1000);
       }`,
    );
    rig.tick(3);
    check('DallasTemperature อ่านค่า DS18B20', machine.takeSerialOutput()[0], '21.50\n');
  }

  // A 16x2 I2C LCD needs 5 V, from the ESP32's VIN.
  clearFirmware();
  {
    const board = place('esp32-devkit-v1', 'board');
    const lcd = place('lcd', 'lcd');
    const rig = new Rig(
      [board, lcd],
      [
        wire(['lcd', 'VCC'], ['board', 'VIN'], 0),
        wire(['lcd', 'GND'], ['board', 'GND-L'], 1),
        wire(['lcd', 'SDA'], ['board', 'GPIO21'], 2),
        wire(['lcd', 'SCL'], ['board', 'GPIO22'], 3),
      ],
    );
    load(
      'board',
      board.definition,
      `#include <LiquidCrystal_I2C.h>
       LiquidCrystal_I2C lcd(0x27, 16, 2);
       void setup() { lcd.init(); lcd.backlight(); lcd.setCursor(0, 1); lcd.print("Hello"); }
       void loop() { delay(1000); }`,
    );
    rig.tick(4);
    check('LiquidCrystal_I2C เขียนแถว 2 ของ LCD', rig.runtime('lcd', 'line2'), 'Hello');
  }

  // A class nothing emulates is reported by name, not silently accepted.
  clearFirmware();
  {
    const board = place('esp32-devkit-v1', 'board');
    const rig = new Rig([board], []);
    const machine = load(
      'board',
      board.definition,
      `#include <Adafruit_BMP280.h>
       Adafruit_BMP280 bmp(10);
       void setup() {}
       void loop() { delay(1000); }`,
    );
    rig.tick(2);
    check(
      'library ที่ยังไม่รองรับ บอกชื่อชัดเจน',
      machine.fault?.message.includes('Adafruit_BMP280') ?? false,
      true,
    );
  }
}
testRunawayLoop();
testArduinoPins();
testSerial();
testPwmDimsLed();
testSameSupply();
testInspectorSettings();
testLibraries();
testForLoopVariable();
testTwoLcdsToneAndLedc();
testResistors();
testCompatibilityAndElectricalDiagnostics();

// --- 16. resistors are resistors, not wires ---------------------------------

function testResistors(): void {
  console.log('\n16. ตัวต้านทาน: pull-up กับปุ่มไม่ลัดวงจร และตัวแบ่งแรงดันได้ค่ากลาง');
  clearFirmware();

  // 3V3 → 10 kΩ → GPIO18, and a button from GPIO18 to GND.
  const board = place('esp32-devkit-v1', 'board');
  const pullUp = place('resistor', 'pull', { resistance: 10000 });
  const button = place('button', 'btn', { pressed: false, mode: 'no' });
  const rig = new Rig(
    [board, pullUp, button],
    [
      wire(['pull', '1'], ['board', '3V3'], 0),
      wire(['pull', '2'], ['board', 'GPIO18'], 1),
      wire(['btn', '1'], ['board', 'GPIO18'], 2),
      wire(['btn', '3'], ['board', 'GND-L'], 3),
    ],
  );
  const machine = load(
    'board',
    board.definition,
    `void setup() { Serial.begin(115200); pinMode(18, INPUT); }
     void loop() { Serial.println(digitalRead(18)); delay(100); }`,
  );
  rig.tick(4);
  check('ปล่อยปุ่ม: pull-up ทำให้อ่านได้ HIGH', machine.takeSerialOutput().at(-1), '1\n');
  rig.setProperty('btn', 'pressed', true);
  rig.tick(4);
  check('กดปุ่ม: อ่านได้ LOW', machine.takeSerialOutput().at(-1), '0\n');
  check('กดปุ่มแล้วไม่มีไฟลัด', rig.shortCount(), 0);

  // Two 10 kΩ between 3V3 and GND put their middle at half the rail.
  clearFirmware();
  const top = place('resistor', 'top', { resistance: 10000 });
  const bottom = place('resistor', 'bottom', { resistance: 10000 });
  const divider = new Rig(
    [place('esp32-devkit-v1', 'board'), top, bottom],
    [
      wire(['top', '1'], ['board', '3V3'], 0),
      wire(['top', '2'], ['bottom', '1'], 1),
      wire(['bottom', '2'], ['board', 'GND-L'], 2),
    ],
  );
  divider.tick(4);
  check('ตัวแบ่งแรงดัน 10k/10k ได้ครึ่งหนึ่งของ 3.3 V', divider.voltage('top', '2'), 1.65);
}

// --- 15. two I2C displays, tone(), and ESP32 LEDC ------------------------------

function testTwoLcdsToneAndLedc(): void {
  console.log('\n15. LCD 2 จอคนละ address, tone() ที่ buzzer และ ledcWrite ที่ RGB');
  clearFirmware();

  const board = place('esp32-devkit-v1', 'board');
  const top = place('lcd2004i2c', 'top', { address: '0x27' });
  const bottom = place('lcd2004i2c', 'bottom', { address: '0x3F' });
  const buzzer = place('buzzer-passive', 'buzzer');
  const rgb = place('rgb-led-common-cathode', 'rgb');
  let index = 0;
  const lcdWires = (id: string) => [
    wire([id, 'VCC'], ['board', 'VIN'], index++),
    wire([id, 'GND'], ['board', 'GND-R'], index++),
    wire([id, 'SDA'], ['board', 'GPIO21'], index++),
    wire([id, 'SCL'], ['board', 'GPIO22'], index++),
  ];
  const rig = new Rig(
    [board, top, bottom, buzzer, rgb],
    [
      ...lcdWires('top'),
      ...lcdWires('bottom'),
      wire(['buzzer', '+'], ['board', 'GPIO25'], index++),
      wire(['buzzer', '−'], ['board', 'GND-L'], index++),
      wire(['rgb', 'R'], ['board', 'GPIO16'], index++),
      wire(['rgb', 'CATH'], ['board', 'GND-R'], index++),
    ],
  );
  load(
    'board',
    board.definition,
    `#include <LiquidCrystal_I2C.h>
     LiquidCrystal_I2C lcdA(0x27, 20, 4);
     LiquidCrystal_I2C lcdB(0x3F, 20, 4);
     void setup() {
       lcdA.init(); lcdB.init();
       lcdA.print("Sensors");
       lcdB.setCursor(0, 3); lcdB.print("Music");
       ledcSetup(0, 5000, 8);
       ledcAttachPin(16, 0);
       ledcWrite(0, 255);
       tone(25, 523);
     }
     void loop() { delay(1000); }`,
  );
  rig.tick(4);
  check('LCD 0x27 แสดงข้อความของตัวเอง', rig.runtime('top', 'line1'), 'Sensors');
  check('LCD 0x27 ไม่มีข้อความของอีกจอ', rig.runtime('top', 'line4'), '');
  check('LCD 0x3F แสดงข้อความของตัวเอง', rig.runtime('bottom', 'line4'), 'Music');
  check('tone(25, 523) ทำให้ buzzer ดัง', rig.runtime('buzzer', 'sounding'), true);
  check('buzzer ดังที่ 523 Hz', rig.runtime('buzzer', 'toneHz'), 523);
  check('ledcWrite ผ่านช่อง 0 ไปถึงขา GPIO16', rig.voltage('board', 'GPIO16'), 3.3);
}

// --- 17. common String/network APIs and electrical diagnostics --------------

function testCompatibilityAndElectricalDiagnostics(): void {
  console.log('\n17. String/WiFi compatibility and electrical diagnostics');
  clearFirmware();
  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  const machine = load(
    'board',
    board.definition,
    `#include <WiFi.h>
     #include <HTTPClient.h>
     String message = "  Sensor:42  ";
     HTTPClient http;
     void setup() {
       Serial.begin(115200);
       message.trim();
       Serial.print(message.substring(0, 6));
       Serial.print(" ");
       String tail = message.substring(7);
       Serial.println(tail.toInt());
       WiFi.begin("ssid", "secret");
       Serial.println(WiFi.status() == WL_CONNECTED);
       http.begin("https://example.invalid");
       Serial.println(http.GET());
     }
     void loop() { delay(1000); }`,
  );
  rig.tick(3);
  check('String methods and sandboxed WiFi/HTTP run without a fault', machine.fault, null);
  check('String methods preserve Arduino behavior', machine.takeSerialOutput().join(''), 'Sensor 42\n1\n-1\n');

  clearFirmware();
  const cppRig = new Rig([board], []);
  const cppMachine = load(
    'board',
    board.definition,
    `template <typename T>
     T twice(T value) { return value * 2; }
     struct Reading { int value = 0; };
     class Counter {
       public:
         int total = 0;
         Counter(int initial) { this.total = initial; }
         void add(int amount) { total += amount; }
     };
     Reading reading;
     Counter counter(2);
     void setup() {
       Serial.begin(115200);
       reading.value = twice(21);
       counter.add(reading.value);
       Serial.println(counter.total);
     }
     void loop() { delay(1000); }`,
  );
  cppRig.tick(3);
  check('data-oriented struct/class and inferred template function run', cppMachine.fault, null);
  check('constructor, member read/write, and method call preserve state', cppMachine.takeSerialOutput().join(''), '44\n');

  clearFirmware();
  const interruptBoard = place('esp32-devkit-v1', 'irq-board');
  const button = place('button', 'irq-button', { pressed: false, mode: 'no' });
  const resistor = place('resistor', 'irq-resistor', { resistance: 4700 });
  const interruptRig = new Rig(
    [interruptBoard, button, resistor],
    [
      wire(['irq-board', '3V3'], ['irq-resistor', '1'], 90),
      wire(['irq-resistor', '2'], ['irq-board', 'GPIO4'], 91),
      wire(['irq-board', 'GPIO4'], ['irq-button', '1'], 92),
      wire(['irq-button', '3'], ['irq-board', 'GND-L'], 93),
    ],
  );
  const interruptMachine = load(
    'irq-board',
    interruptBoard.definition,
    `void changed() { digitalWrite(2, HIGH); }
     void setup() {
       pinMode(2, OUTPUT);
       digitalWrite(2, LOW);
       attachInterrupt(digitalPinToInterrupt(4), changed, FALLING);
     }
     void loop() { delay(1000); }`,
  );
  interruptRig.tick(4);
  check('interrupt output starts low', interruptRig.voltage('irq-board', 'GPIO2'), 0);
  interruptRig.setProperty('irq-button', 'pressed', true);
  interruptRig.tick(4);
  check('FALLING interrupt runs while loop is delayed', interruptRig.voltage('irq-board', 'GPIO2'), 3.3);
  check('interrupt callback completes without a fault', interruptMachine.fault, null);

  const uno = place('arduino-uno-r3', 'uno');
  const bluetooth = place('hc05-bluetooth', 'bt');
  const uartWrong = validateCircuit({
    devices: [uno, bluetooth],
    connections: [wire(['uno', 'TX1'], ['bt', 'TXD'], 101)],
  });
  check('TX-to-TX is diagnosed', uartWrong.some((issue) => issue.code === 'uart-polarity'), true);

  const logicWrong = validateCircuit({
    devices: [uno, bluetooth],
    connections: [wire(['uno', 'TX1'], ['bt', 'RXD'], 102)],
  });
  check('5 V TX into a 3.3 V RX is diagnosed', logicWrong.some((issue) => issue.code === 'logic-overvoltage'), true);

  const reader = place('rfid-rc522', 'reader');
  const tft = place('tft-ili9341-touch', 'tft');
  const spiWrong = validateCircuit({
    devices: [board, reader, tft],
    connections: [
      wire(['board', 'GPIO5'], ['reader', 'SDA'], 103),
      wire(['board', 'GPIO5'], ['tft', 'CS'], 104),
    ],
  });
  check('shared SPI chip-select is diagnosed', spiWrong.some((issue) => issue.code === 'spi-cs-conflict'), true);

  const dht = place('dht22', 'dht');
  const floatingData = validateCircuit({
    devices: [board, dht],
    connections: [wire(['board', 'GPIO4'], ['dht', 'DATA'], 105)],
  });
  check('missing external data pull-up is diagnosed', floatingData.some((issue) => issue.code === 'missing-pull-up'), true);

  const overloaded = place('dht22', 'load');
  const heavyDefinition: VirtualDevice = { ...overloaded.definition, supplyCurrentMa: 100 };
  const currentWrong = validateCircuit({
    devices: [uno, { ...overloaded, definition: heavyDefinition }],
    connections: [wire(['uno', '3V3'], ['load', 'VCC'], 106)],
  });
  check('supply current budget is diagnosed', currentWrong.some((issue) => issue.code === 'supply-overcurrent'), true);
}

// --- 14. a for loop's own variable ------------------------------------------

function testForLoopVariable(): void {
  console.log('\n14. ตัวแปรที่ประกาศใน for ใช้ได้ทั้งลูป แม้มี delay ข้างใน');
  clearFirmware();
  const board = place('esp32-devkit-v1', 'board');
  const rig = new Rig([board], []);
  const machine = load(
    'board',
    board.definition,
    `void setup() {
       Serial.begin(115200);
       long total = 0;
       for (int i = 0; i < 3; ++i) { total += i; delay(5); }
       Serial.println(total);
     }
     void loop() { delay(1000); }`,
  );
  // Each delay() resumes on the next tick, so three of them need a few ticks.
  rig.tick(8);
  check('for (int i = 0; …) ไม่ error', machine.fault, null);
  check('ลูปครบ 3 รอบ', machine.takeSerialOutput()[0], '3\n');

  clearFirmware();
  const intRig = new Rig([board], []);
  const ints = load(
    'board',
    board.definition,
    `void setup() {
       Serial.begin(115200);
       int percent = map(2575, 3200, 1400, 0, 100);
       uint32_t total = 7;
       const int raw = total / 2;
       float half = total / 2.0;
       Serial.printf("%d %d ", percent, raw);
       Serial.println(half);
     }
     void loop() { delay(1000); }`,
  );
  intRig.tick(2);
  check('int ตัดทศนิยม และ map() คิดแบบจำนวนเต็ม', ints.takeSerialOutput().join(''), '34 3 3.50\n');
}

function testSizeOfAndReferences(): void {
  for (const [definitionId, bytes] of [['esp32-devkit-v1', 4], ['arduino-uno-r3', 2]] as const) {
    clearFirmware();
    const board = place(definitionId, 'board');
    const rig = new Rig([board], []);
    const machine = load('board', board.definition, `
      int melody[] = {262, 294, 330};
      uint8_t levels[5] = {1, 2};
      void alias(int &a, int &b) { a = 7; b += a; }
      void forward(int &a) { alias(a, a); }
      struct Color {
        Color(int &value) { value = 1; }
        void brighten(int &value) { value += 2; }
      };
      void setup() {
        int color = 0;
        forward(color);
        int index = 0;
        alias(levels[index++], color);
        Serial.println(color);
        Serial.println(index);
        Serial.println(sizeof(melody) / sizeof(int));
        Serial.println(sizeof(melody[0]));
        Serial.println(sizeof(levels));
        Serial.println(sizeof(levels[index++]));
        Serial.println(index);
        Serial.println(levels[4]);
        Color pixel(color);
        pixel.brighten(color);
        Serial.println(color);
      }
      void loop() { delay(1000); }
    `);
    rig.tick(3);
    check(`${definitionId}: references, aliasing and sizeof run without faults`, machine.fault, null);
    check(`${definitionId}: sizeof uses declared sizes without evaluating indexes`, machine.takeSerialOutput().join(''), `21\n1\n3\n${bytes}\n5\n1\n1\n0\n3\n`);
  }
}

function testBirthdayRainbow(): void {
  clearFirmware();
  const board = place('esp32-devkit-v1', 'board');
  const rgb = place('rgb-led-common-cathode', 'rgb');
  const buzzer = place('buzzer-passive', 'buzzer');
  const rig = new Rig([board, rgb, buzzer], [
    wire(['board', 'GPIO25'], ['rgb', 'R'], 1),
    wire(['board', 'GPIO26'], ['rgb', 'G'], 2),
    wire(['board', 'GPIO27'], ['rgb', 'B'], 3),
    wire(['board', 'GND-L'], ['rgb', 'CATH'], 4),
    wire(['board', 'GPIO23'], ['buzzer', '+'], 5),
    wire(['board', 'GND-L'], ['buzzer', '−'], 6),
  ]);
  const machine = load('board', board.definition, `
    int melody[] = {262, 262, 294, 262, 349, 330};
    int position = 0;
    unsigned long updated = 0;
    void wheel(int pos, int &r, int &g, int &b) {
      r = pos * 3; g = 255 - pos * 3; b = 0;
    }
    void rainbow() {
      if (millis() - updated >= 50) {
        updated = millis(); position = (position + 1) % 85;
        int r, g, b;
        wheel(position, r, g, b);
        ledcWrite(25, r); ledcWrite(26, g); ledcWrite(27, b);
      }
    }
    void setup() {
      ledcAttach(25, 5000, 8); ledcAttach(26, 5000, 8); ledcAttach(27, 5000, 8);
    }
    void loop() {
      for (int i = 0; i < sizeof(melody) / sizeof(melody[0]); i++) {
        tone(23, melody[i], 250);
        unsigned long start = millis();
        while (millis() - start < 325) { rainbow(); }
        noTone(23);
      }
    }
  `);
  const tones = new Set<unknown>();
  const colors = new Set<string>();
  for (let tick = 0; tick < 140; tick++) {
    rig.tick();
    if (rig.runtime('buzzer', 'sounding')) {
      tones.add(rig.runtime('buzzer', 'toneHz'));
      colors.add(JSON.stringify([rig.runtime('rgb', 'red'), rig.runtime('rgb', 'green')]));
    }
  }
  check('birthday sketch repeats without runtime faults', machine.fault, null);
  check('birthday melody reaches all four notes', [...tones].sort(), [262, 294, 330, 349]);
  check('rainbow changes while the buzzer plays', colors.size > 20, true);
  check('birthday circuit has no short', rig.shortCount(), 0);
}

// --- onboard LED -------------------------------------------------------------

function testOnboardLed(): void {
  console.log('\nOnboard LED: LED_BUILTIN เป็น LED ของบอร์ดเอง และภาพบอร์ดติดตามขานั้น');
  clearFirmware();

  const esp32 = place('esp32-devkit-v1', 'esp32');
  const rig = new Rig([esp32], []);
  load('esp32', esp32.definition, `
    const int LED_PIN = LED_BUILTIN;
    void setup() { pinMode(LED_PIN, OUTPUT); }
    void loop() {
      digitalWrite(LED_PIN, HIGH);
      delay(3000);
      digitalWrite(LED_PIN, LOW);
      delay(3000);
    }
  `);

  rig.tick(2);
  check('ESP32 LED_BUILTIN drives GPIO2', rig.voltage('esp32', 'GPIO2'), 3.3);
  check('ESP32 onboard LED is lit', rig.runtime('esp32', 'onboardLed'), 1);
  rig.tick(Math.ceil(3000 / TICK_MS));
  check('after 3 s the onboard LED is dark', rig.runtime('esp32', 'onboardLed'), 0);
  check('GPIO13 was never touched', rig.floating('esp32', 'GPIO13'), true);

  clearFirmware();
  const uno = place('arduino-uno-r3', 'uno');
  const unoRig = new Rig([uno], []);
  load('uno', uno.definition, `
    void setup() { pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, HIGH); }
    void loop() {}
  `);
  unoRig.tick(2);
  check('Uno LED_BUILTIN is pin 13 and lights L', unoRig.runtime('uno', 'onboardLed'), 1);

  clearFirmware();
  const idle = new Rig([place('esp32-devkit-v1', 'idle')], []);
  idle.tick(2);
  check('no sketch, no lit LED', idle.runtime('idle', 'onboardLed'), 0);
}

testSizeOfAndReferences();
testBirthdayRainbow();
testOnboardLed();

console.log(`\n${checks - failures}/${checks} ผ่าน`);
if (failures) process.exit(1);

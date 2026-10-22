import assert from 'node:assert/strict';
import { ExampleRig } from './example-rig';
import { readFileSync } from 'node:fs';
import { readBus } from '../src/app/features/user/workspace/virtual-device/devices/core/multi-pin-bus';
import type { BusMessage } from '../src/app/features/user/workspace/virtual-device/devices/core/device-simulation';
import { DEVICES } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { DEVICE_DATASHEETS } from '../src/app/features/user/documents/device-datasheets';
import { LIBRARY_CATALOG } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/libraries/library-catalog';

let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks++;
  console.log(`ok ${name}`);
}

check('IR counts edges, holds do not count twice, and seven-segment follows', () => {
  const rig = new ExampleRig('ir-counter');
  rig.tick();
  assert.equal(rig.runtime('display', 'segments'), '0,0,0,63');
  rig.set('sensor', 'distanceCm', 5);
  rig.tick();
  assert.equal(rig.runtime('display', 'segments'), '0,0,0,6');
  rig.tick(30);
  assert.equal(rig.runtime('display', 'segments'), '0,0,0,6');
  rig.set('sensor', 'distanceCm', 40);
  rig.tick();
  rig.set('sensor', 'distanceCm', 3);
  rig.tick();
  assert.equal(rig.runtime('display', 'segments'), '0,0,0,91');
});

check('RTC adjustment, DateTime initializer and advancing time drive a clock', () => {
  const rig = new ExampleRig('rtc-clock');
  rig.tick(10);
  assert.equal(rig.runtime('display', 'segments'), '6,219,79,102');
  assert.match(rig.serial(), /56/);
  rig.tick(40);
  assert.match(rig.serial(), /58/);
});

check('BME280 inspector readings drive a real I2C LCD, including Pa to hPa', () => {
  const rig = new ExampleRig('weather-lcd');
  rig.tick();
  assert.equal(rig.runtime('display', 'line1'), 'T:25.0 H:50.0');
  assert.equal(rig.runtime('display', 'line2'), '1013.3 hPa');
  rig.set('sensor', 'temperature', 32.5);
  rig.set('sensor', 'humidity', 72);
  rig.set('sensor', 'pressure', 999);
  rig.tick(30);
  assert.equal(rig.runtime('display', 'line1'), 'T:32.5 H:72.0');
  assert.equal(rig.runtime('display', 'line2'), '999.0 hPa');
});

check('RFID detects a card, exposes UID, lights matrix and waits for re-presentation', () => {
  const rig = new ExampleRig('rfid-matrix');
  rig.tick();
  assert.equal(rig.runtime('matrix', 'pixels'), '0'.repeat(64));
  rig.set('reader', 'cardPresent', true);
  rig.tick();
  assert.equal(rig.serial(), 'DE AD BE EF \n');
  assert.equal(rig.runtime('matrix', 'pixels'), '11111111' + '0'.repeat(56));
  rig.tick();
  assert.equal(rig.serial(), '');
  rig.set('reader', 'cardPresent', false);
  rig.tick();
  rig.set('reader', 'uid', '01 02 03 04');
  rig.set('reader', 'cardPresent', true);
  rig.tick();
  assert.equal(rig.serial(), '1 2 3 4 \n');
});

check('Touch controller returns coordinates and TFT shows firmware output', () => {
  const rig = new ExampleRig('touch-panel');
  rig.tick();
  assert.equal(String(rig.runtime('display', 'screen')).trim(), 'Ready');
  rig.set('display', 'touched', true);
  rig.set('display', 'touchX', 1200);
  rig.set('display', 'touchY', 2300);
  rig.tick();
  assert.equal(String(rig.runtime('display', 'screen')).trim(), 'Touch 1200,2300');
  rig.set('display', 'touched', false);
  rig.tick();
  assert.equal(String(rig.runtime('display', 'screen')).trim(), 'Ready');
});

for (const [example, part, pins, output] of [
  ['ir-counter', 'display', ['CLK', 'DIO', 'VCC', 'GND'], 'segments'],
  ['rfid-matrix', 'matrix', ['DIN', 'CLK', 'CS', 'VCC', 'GND'], 'pixels'],
  ['touch-panel', 'display', ['MOSI', 'SCK', 'CS', 'DC', 'VCC', 'GND'], 'screen'],
] as const)
  for (const pin of pins)
    check(`${example}: missing ${part}.${pin} prevents display frames`, () => {
      const rig = new ExampleRig(example, [part, pin]);
      rig.tick();
      assert.equal(rig.runtime(part, output), undefined);
    });

for (const pin of ['VCC', 'GND', 'SDA', 'SCL'])
  check(`RTC missing ${pin} fails begin`, () => {
    const rig = new ExampleRig('rtc-clock', ['rtc', pin]);
    rig.tick();
    assert.equal(rig.serial(), '');
    assert.equal(rig.runtime('display', 'segments'), undefined);
  });

for (const pin of ['VCC', 'GND', 'SDA', 'SCL'])
  check(`BME280 missing ${pin} reports offline`, () => {
    const rig = new ExampleRig('weather-lcd', ['sensor', pin]);
    rig.tick();
    assert.equal(rig.runtime('display', 'line1'), 'Sensor offline');
  });

check('BME280 address mismatch fails begin', () => {
  const rig = new ExampleRig('weather-lcd');
  rig.set('sensor', 'address', '0x77');
  rig.tick();
  assert.equal(rig.runtime('display', 'line1'), 'Sensor offline');
});

for (const pin of ['VCC', 'GND', 'MOSI', 'MISO', 'SCK', 'SDA', 'RST'])
  check(`RFID missing ${pin} does not detect a card`, () => {
    const rig = new ExampleRig('rfid-matrix', ['reader', pin]);
    rig.set('reader', 'cardPresent', true);
    rig.tick();
    assert.equal(rig.serial(), '');
  });

for (const pin of ['T_CLK', 'T_DIN', 'T_DO', 'T_CS'])
  check(`Touch missing ${pin} cannot report a touch`, () => {
    const rig = new ExampleRig('touch-panel', ['display', pin]);
    rig.set('display', 'touched', true);
    rig.tick();
    assert.equal(String(rig.runtime('display', 'screen')).trim(), 'Ready');
  });

check('TFT needs separate backlight power', () => {
  const rig = new ExampleRig('touch-panel', ['display', 'LED']);
  rig.tick();
  assert.equal(rig.runtime('display', 'backlight'), false);
});

check('Unsupported API and private object properties fail explicitly', () => {
  const rig = new ExampleRig(
    'touch-panel',
    undefined,
    'void setup() { SPI.transfer(1); } void loop() {}',
  );
  assert.throws(() => rig.tick(), /SPIClass.transfer/);
  const fields = new ExampleRig(
    'touch-panel',
    undefined,
    'XPT2046_Touchscreen touch(26); void setup() { TS_Point p = touch.getPoint(); Serial.println(p.constructor); } void loop() {}',
  );
  assert.throws(() => fields.tick(), /TS_Point.constructor/);
});

for (const id of [
  'max7219-matrix',
  'tm1637-display',
  'rtc-ds1307',
  'rfid-rc522',
  'tft-ili9341-touch',
  'bme280',
])
  check(`${id} has an AI library reference and datasheet`, () => {
    assert(LIBRARY_CATALOG.some((library) => library.devices.includes(id)));
    assert(DEVICE_DATASHEETS[id]);
  });

check('SPI remapping follows actual signal wires', () => {
  const source = readFileSync('examples/rfid-matrix/main.ino', 'utf8').replace(
    'SPI.begin();',
    'SPI.begin(14, 12, 13);',
  );
  const rig = new ExampleRig('rfid-matrix', undefined, source);
  const pins: Record<string, string> = { GPIO18: 'GPIO14', GPIO19: 'GPIO12', GPIO23: 'GPIO13' };
  for (let index = 0; index < rig.connections.length; index++) {
    const wire = rig.connections[index];
    if (wire.start.type === 'device' && wire.start.deviceId === 'board' && pins[wire.start.pinId])
      rig.connections[index] = { ...wire, start: { ...wire.start, pinId: pins[wire.start.pinId] } };
  }
  rig.set('reader', 'cardPresent', true);
  rig.tick();
  assert.equal(rig.serial(), 'DE AD BE EF \n');
});

check('Swapped TM1637 clock and data do not deliver a frame', () => {
  const source = readFileSync('examples/ir-counter/main.ino', 'utf8').replace(
    'display(18, 19)',
    'display(19, 18)',
  );
  const rig = new ExampleRig('ir-counter', undefined, source);
  rig.tick();
  assert.equal(rig.runtime('display', 'segments'), undefined);
});

check('RFID rejects malformed UID input', () => {
  const rig = new ExampleRig('rfid-matrix');
  rig.set('reader', 'uid', 'invalid');
  rig.set('reader', 'cardPresent', true);
  rig.tick();
  assert.equal(rig.serial(), '');
});

check('BME280 readings become NAN after live disconnection', () => {
  const rig = new ExampleRig('weather-lcd');
  rig.tick();
  const index = rig.connections.findIndex(
    (wire) =>
      wire.end.type === 'device' && wire.end.deviceId === 'sensor' && wire.end.pinId === 'SCL',
  );
  rig.connections.splice(index, 1);
  rig.tick(30);
  assert.equal(rig.runtime('display', 'line1'), 'T:nan H:nan');
});

check('Bus roles cannot be assembled from different devices, and address collisions fail', () => {
  const pins = { data: 'SDA', clock: 'SCL' };
  const message = (from: string, role: string, key = '0x76'): BusMessage => ({
    from,
    protocol: 'bme280',
    data: { role, busKey: key },
  });
  const split = (pin: string) => [
    message(pin === 'SDA' ? 'a' : 'b', pin === 'SDA' ? 'data' : 'clock'),
  ];
  assert.equal(readBus(split, pins, 'bme280'), undefined);
  const collision = (pin: string) =>
    ['a', 'b'].map((id) => message(id, pin === 'SDA' ? 'data' : 'clock'));
  assert.equal(readBus(collision, pins, 'bme280', '0x76'), undefined);
  const addressed = (pin: string) => [
    message('a', pin === 'SDA' ? 'data' : 'clock'),
    message('b', pin === 'SDA' ? 'data' : 'clock', '0x77'),
  ];
  assert.equal(readBus(addressed, pins, 'bme280', '0x77')?.from, 'b');
});

check('Declared SPI defaults resolve to real pins on every supported board', () => {
  for (const board of DEVICES) {
    if (!board.defaultSpi) continue;
    for (const pin of Object.values(board.defaultSpi))
      assert(
        board.pins.some((candidate) => candidate.name === pin),
        `${board.id}: ${pin}`,
      );
  }
});

console.log(`${checks}/${checks} peripheral project checks passed`);

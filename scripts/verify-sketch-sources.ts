import assert from 'node:assert/strict';
import { deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { FirmwareMachine } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-machine';
import {
  combineSketch,
  sketchSourcePaths,
  type SketchFile,
} from '../src/app/features/user/workspace/sketch-sources';
import { withoutManagedLibraries } from '../src/app/features/user/workspace/library-manager/library-files';

/**
 * Multi-file sketches in the simulator, laid out the way Arduino IDE and PlatformIO
 * keep them. The server compile already takes every file; these checks pin the browser
 * to the same files, the same order, and faults that name the file they are in.
 */

let checks = 0;
function check(name: string, test: () => void): void {
  test();
  checks++;
  console.log(`PASS ${name}`);
}

const sampler = {
  readDigital: () => false,
  readAnalog: () => 0,
  readMessages: () => [],
};

const board = deviceById('esp32-devkit-v1');
if (!board) throw new Error('esp32-devkit-v1 is missing from the catalog');

function sketch(files: SketchFile[]) {
  const combined = combineSketch(files);
  if (!combined) throw new Error('no sketch');
  return combined;
}

check('Arduino layout: the main tab first, other tabs alphabetically, then .cpp files', () => {
  const combined = sketch([
    { path: 'zeta.ino', content: '// zeta tab' },
    { path: 'helpers.cpp', content: '// helpers unit' },
    { path: 'main.ino', content: '// main tab' },
    { path: 'alpha.ino', content: '// alpha tab' },
  ]);
  assert.equal(combined.entry, 'main.ino');
  const order = ['main tab', 'alpha tab', 'zeta tab', 'helpers unit'].map((text) =>
    combined.source.indexOf(text),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

check('a project header is pasted where it is first included, and only once', () => {
  const combined = sketch([
    { path: 'main.ino', content: '#include "config.h"\n#include "config.h"\nvoid setup() {}' },
    { path: 'config.h', content: '#pragma once\nconst int LED = 2;' },
  ]);
  assert.equal(combined.source.split('const int LED = 2;').length - 1, 1);
  assert.deepEqual(combined.locate(2), { file: 'config.h', line: 2 });
});

check('PlatformIO layout: src/, include/, and a project library under lib/', () => {
  const paths = [
    'platformio.ini',
    'src/main.cpp',
    'src/motor.cpp',
    'include/pins.h',
    'lib/Blink/src/Blink.h',
    'lib/Blink/src/Blink.cpp',
    'lib/Unused/src/Unused.cpp',
    'docs/readme.md',
  ];
  assert.deepEqual(sketchSourcePaths(paths), [
    'src/main.cpp',
    'src/motor.cpp',
    'include/pins.h',
    'lib/Blink/src/Blink.h',
    'lib/Blink/src/Blink.cpp',
    'lib/Unused/src/Unused.cpp',
  ]);
  const combined = sketch([
    {
      path: 'src/main.cpp',
      content: '#include <Arduino.h>\n#include "pins.h"\n#include <Blink.h>',
    },
    { path: 'src/motor.cpp', content: '// motor' },
    { path: 'include/pins.h', content: '// pins' },
    { path: 'lib/Blink/src/Blink.h', content: '// blink header' },
    { path: 'lib/Blink/src/Blink.cpp', content: '// blink unit' },
    { path: 'lib/Unused/src/Unused.cpp', content: 'this is not C++ the simulator reads' },
  ]);
  for (const text of ['// pins', '// blink header', '// blink unit', '// motor']) {
    assert.ok(combined.source.includes(text), `${text} joined`);
  }
  assert.ok(!combined.source.includes('not C++'), 'an unused library stays out');
  assert.ok(combined.source.includes('#include <Arduino.h>'), 'platform headers are left alone');
});

check('functions and globals split across files run as one sketch', () => {
  const combined = sketch([
    {
      path: 'main.ino',
      content: [
        '#include "blink.h"',
        'void setup() {',
        '  Serial.begin(115200);',
        '  blinkTimes = 3;',
        '}',
        'void loop() {',
        '  Serial.println(twice(blinkTimes));',
        '  delay(1000);',
        '}',
      ].join('\n'),
    },
    {
      path: 'blink.h',
      content:
        '#ifndef BLINK_H\n#define BLINK_H\nextern int blinkTimes;\nint twice(int value);\n#endif',
    },
    {
      path: 'blink.cpp',
      content:
        '#include "blink.h"\nint blinkTimes = 0;\nint twice(int value) {\n  return value * 2;\n}',
    },
  ]);
  const compiled = FirmwareMachine.compile(board, combined.source, combined.locate);
  assert.equal(compiled.fault, null, compiled.fault?.message);
  compiled.machine!.advance(50, sampler);
  assert.equal(compiled.machine!.fault, null, compiled.machine!.fault?.message);
  assert.match(compiled.machine!.takeSerialOutput().join(''), /6/);
});

check('a fault names the file and the line inside it', () => {
  const combined = sketch([
    { path: 'main.ino', content: 'void setup() {}\nvoid loop() {\n  explode();\n}' },
    {
      path: 'boom.cpp',
      content: '// helper\nvoid explode() {\n  int zero = 0;\n  int x = 1 / zero;\n}',
    },
  ]);
  const compiled = FirmwareMachine.compile(board, combined.source, combined.locate);
  assert.ok(compiled.machine, compiled.fault?.message);
  compiled.machine.advance(50, sampler);
  assert.equal(compiled.machine.fault?.file, 'boom.cpp');
  assert.equal(compiled.machine.fault?.line, 4);

  const broken = sketch([
    { path: 'main.ino', content: 'void setup() {}\nvoid loop() {}' },
    { path: 'bad.cpp', content: 'void broken() {\n  int x = ;\n}' },
  ]);
  const syntax = FirmwareMachine.compile(board, broken.source, broken.locate);
  assert.equal(syntax.fault?.phase, 'compile');
  assert.equal(syntax.fault?.file, 'bad.cpp');
  assert.equal(syntax.fault?.line, 2);
});

check('an installed copy of a simulated library stays out of the simulation', () => {
  const combined = sketch([
    {
      path: 'main.ino',
      content:
        '#include <DHT.h>\nDHT dht(4, DHT22);\nvoid setup() { dht.begin(); }\nvoid loop() {}',
    },
    {
      path: 'lib/DHT_sensor_library/DHT.h',
      content: '#pragma once\nclass DHT { uint8_t data[5]; };',
    },
    {
      path: 'lib/DHT_sensor_library/DHT.cpp',
      content: '#include "DHT.h"\nvoid DHT::begin() {}',
    },
  ]);
  assert.doesNotMatch(combined.source, /uint8_t data/);
  assert.doesNotMatch(combined.source, /DHT::begin/);
  const compiled = FirmwareMachine.compile(board, combined.source, combined.locate);
  assert.equal(compiled.fault, null, compiled.fault?.message);
});

check('installed library files are not editor tabs', () => {
  assert.deepEqual(
    withoutManagedLibraries([
      'main.ino',
      'lib/Mine/Mine.h',
      'lib/DHT_sensor_library/DHT.h',
      'lib/DHT_sensor_library/library-source.json',
    ]),
    ['main.ino', 'lib/Mine/Mine.h'],
  );
});

console.log(`${checks}/${checks} sketch source checks passed`);

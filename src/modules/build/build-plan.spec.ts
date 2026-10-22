import { UnprocessableEntityException } from '@nestjs/common';

import {
  ARDUINO_CPP,
  MICROPYTHON,
  PLATFORMIO,
} from '../projects/board-catalog';
import { buildableBoard, flashLayoutFor, planBuild } from './build-plan';

const SKETCH = 'void setup() {}\nvoid loop() {}\n';

describe('planBuild', () => {
  it('sends a PlatformIO project its source folders and never its platformio.ini', () => {
    const plan = planBuild(
      { board: 'esp32-devkit-v1', framework: PLATFORMIO },
      [
        { path: 'platformio.ini', content: '[env]\nextra_scripts = evil.py\n' },
        { path: 'src/main.cpp', content: SKETCH },
        { path: 'include/pins.h', content: '#define LED 2\n' },
        { path: 'lib/blink/blink.cpp', content: '' },
        { path: 'evil.py', content: 'import os' },
        { path: 'README.md', content: '' },
      ],
    );

    expect(plan.files.map((file) => file.path)).toEqual([
      'src/main.cpp',
      'include/pins.h',
      'lib/blink/blink.cpp',
    ]);
    expect(plan).toMatchObject({
      boardId: 'esp32-devkit-v1',
      platform: 'espressif32',
      platformBoard: 'esp32doit-devkit-v1',
    });
  });

  it('moves an Arduino sketch and its root sources under src/', () => {
    const plan = planBuild(
      { board: 'arduino-uno-r3', framework: ARDUINO_CPP },
      [
        { path: 'main.ino', content: SKETCH },
        { path: 'helpers.h', content: '' },
        { path: 'notes.txt', content: '' },
        { path: 'docs/wiring.cpp', content: '' },
      ],
    );

    expect(plan.files.map((file) => file.path)).toEqual([
      'src/main.ino',
      'src/helpers.h',
    ]);
    expect(plan.platform).toBe('atmelavr');
  });

  it('refuses a project with nothing to compile', () => {
    let refusal: unknown;
    try {
      planBuild({ board: 'esp32-devkit-v1', framework: PLATFORMIO }, [
        { path: 'platformio.ini', content: '' },
      ]);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(UnprocessableEntityException);
    expect(
      (refusal as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'BUILD_NO_SOURCES' });
  });

  it('refuses boards and frameworks the builder does not install', () => {
    for (const project of [
      { board: 'esp32-s3-devkitc-1', framework: PLATFORMIO },
      { board: 'esp8266-nodemcu', framework: PLATFORMIO },
      { board: 'pico-w', framework: MICROPYTHON },
      { board: 'ESP32 DevKit V1', framework: PLATFORMIO },
      { board: 'esp32-devkit-v1', framework: MICROPYTHON },
    ]) {
      expect(() =>
        planBuild(project, [{ path: 'src/main.cpp', content: SKETCH }]),
      ).toThrow(UnprocessableEntityException);
    }
  });

  it('hashes the same sources the same regardless of order', () => {
    const files = [
      { path: 'src/main.cpp', content: SKETCH },
      { path: 'src/util.cpp', content: 'int x;' },
    ];
    const project = { board: 'esp32-devkit-38', framework: PLATFORMIO };

    expect(planBuild(project, files).sourceHash).toBe(
      planBuild(project, [...files].reverse()).sourceHash,
    );
  });

  it('hashes differently when a file, its path, or the target changes', () => {
    const project = { board: 'esp32-devkit-38', framework: PLATFORMIO };
    const base = planBuild(project, [
      { path: 'src/main.cpp', content: SKETCH },
    ]);

    expect(
      planBuild(project, [{ path: 'src/main.cpp', content: `${SKETCH} ` }])
        .sourceHash,
    ).not.toBe(base.sourceHash);
    expect(
      planBuild(project, [{ path: 'src/app.cpp', content: SKETCH }]).sourceHash,
    ).not.toBe(base.sourceHash);
    expect(
      planBuild({ ...project, board: 'esp32-devkit-v1' }, [
        { path: 'src/main.cpp', content: SKETCH },
      ]).sourceHash,
    ).not.toBe(base.sourceHash);
  });
});

describe('flash layout', () => {
  it('places ESP32 images at the Arduino core offsets', () => {
    expect(flashLayoutFor('espressif32')).toEqual([
      { name: 'bootloader.bin', offset: 0x1000 },
      { name: 'partitions.bin', offset: 0x8000 },
      { name: 'boot_app0.bin', offset: 0xe000 },
      { name: 'firmware.bin', offset: 0x10000 },
    ]);
  });

  it('flashes an AVR board from one HEX image', () => {
    expect(flashLayoutFor('atmelavr')).toEqual([
      { name: 'firmware.hex', offset: null },
    ]);
  });

  it('gives every buildable board a flash method', () => {
    expect(buildableBoard('arduino-nano').flash).toEqual({
      protocol: 'stk500v1',
      baudRate: 57_600,
    });
  });
});

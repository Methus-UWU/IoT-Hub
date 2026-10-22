import '@angular/compiler';
import assert from 'node:assert/strict';
import { Injector } from '@angular/core';
import {
  ADD_PORT_VALUE,
  REFRESH_PORTS_VALUE,
  buildPortOptions,
} from '../src/app/features/user/workspace/firmware/port-options';
import { SerialSessionStore } from '../src/app/features/user/workspace/firmware/serial-session.store';
import {
  boardFamily,
  portFingerprints,
  portMismatchesBoard,
  type SerialPortChoice,
} from '../src/app/features/user/workspace/firmware/web-serial';

/**
 * Port detection and choice without a browser: which ports are offered, how an unplugged
 * board stays selected and comes back, and when a port is flagged as the wrong board.
 */

let checks = 0;
async function check(name: string, test: () => void | Promise<void>): Promise<void> {
  await test();
  checks++;
  console.log(`PASS ${name}`);
}

function fakePort(usbVendorId?: number, usbProductId?: number) {
  return {
    readable: null,
    getInfo: () => ({ usbVendorId, usbProductId }),
    open: async () => undefined,
    close: async () => undefined,
  } as unknown as SerialPort;
}

function choice(id: string, usbVendorId?: number): SerialPortChoice {
  return {
    id,
    label: id,
    port: fakePort(usbVendorId),
    fingerprint: `${id}#0`,
    usbVendorId,
  };
}

const base = {
  unavailableReason: null,
  ports: [] as SerialPortChoice[],
  selectedPortId: '',
  selectedPortMissing: false,
  selectedPortLabel: '',
  board: 'ESP32 DevKit V1',
};

async function main(): Promise<void> {
  await check('an insecure page says HTTPS is needed and offers no actions', () => {
    const options = buildPortOptions({ ...base, unavailableReason: 'insecure' });
    assert.equal(options.length, 1);
    assert.equal(options[0].disabled, true);
    assert.match(options[0].label, /HTTPS/);
  });

  await check('an unsupported browser is told which browsers work', () => {
    const options = buildPortOptions({ ...base, unavailableReason: 'unsupported' });
    assert.equal(options.length, 1);
    assert.match(options[0].description ?? '', /Chrome/);
  });

  await check('no ports still offers refresh and the browser picker', () => {
    const values = buildPortOptions(base).map((option) => option.value);
    assert.deepEqual(values, ['', REFRESH_PORTS_VALUE, ADD_PORT_VALUE]);
  });

  await check('several ports are all listed for the user to choose', () => {
    const options = buildPortOptions({
      ...base,
      ports: [choice('port-1', 0x10c4), choice('port-2', 0x1a86)],
      selectedPortId: 'port-1',
    });
    assert.deepEqual(
      options.map((option) => option.value),
      ['port-1', 'port-2', REFRESH_PORTS_VALUE, ADD_PORT_VALUE],
    );
  });

  await check('an unplugged board stays selected and is shown as disconnected', () => {
    const options = buildPortOptions({
      ...base,
      selectedPortId: 'port-1',
      selectedPortMissing: true,
      selectedPortLabel: 'CP210x · 10c4:ea60',
    });
    assert.equal(options[0].value, 'port-1');
    assert.equal(options[0].disabled, true);
    assert.match(options[0].label, /CP210x/);
    assert.ok(!options.some((option) => option.label === 'ยังไม่พบอุปกรณ์'));
  });

  await check('identical boards get distinct, stable fingerprints', () => {
    const fingerprints = portFingerprints([
      fakePort(0x10c4, 0xea60),
      fakePort(0x10c4, 0xea60),
      fakePort(),
    ]);
    assert.deepEqual(fingerprints, ['10c4:ea60#0', '10c4:ea60#1', 'serial#0']);
  });

  await check('only a definite family mismatch is flagged', () => {
    assert.equal(boardFamily('ESP32 DevKit V1'), 'esp32');
    assert.equal(boardFamily('Arduino Uno'), 'avr');
    assert.equal(portMismatchesBoard(choice('esp', 0x303a), 'Arduino Uno'), true);
    assert.equal(portMismatchesBoard(choice('esp', 0x303a), 'ESP32-CAM'), false);
    // CP210x and CH340 sit on both families, so they never decide.
    assert.equal(portMismatchesBoard(choice('cp', 0x10c4), 'Arduino Uno'), false);
    const options = buildPortOptions({
      ...base,
      board: 'Arduino Uno',
      ports: [choice('esp', 0x303a)],
    });
    assert.match(options[0].description ?? '', /Arduino Uno/);
  });

  await check('a remembered board is reselected when it is plugged in', async () => {
    const cp210x = fakePort(0x10c4, 0xea60);
    const ch340 = fakePort(0x1a86, 0x7523);
    let plugged = [cp210x, ch340];
    const serial = Object.assign(new EventTarget(), { getPorts: async () => plugged });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { isSecureContext: true },
    });
    const store = Injector.create({ providers: [SerialSessionStore] }).get(SerialSessionStore);

    await store.refreshPorts();
    assert.equal(store.selectedPort()?.port, cp210x, 'the first port is detected and selected');

    assert.equal(await store.preferPort('1a86:7523#0'), true);
    assert.equal(store.selectedPort()?.port, ch340, 'the remembered board wins');
    assert.equal(await store.preferPort('dead:beef#0'), false);
    assert.equal(store.selectedPort()?.port, ch340, 'an absent board changes nothing');

    plugged = [cp210x];
    await store.refreshPorts();
    assert.equal(store.selectedPortMissing(), true, 'unplugging keeps the choice, marked missing');
    assert.match(store.selectedPortLabel(), /CH340/);

    plugged = [cp210x, ch340];
    await store.refreshPorts();
    assert.equal(store.selectedPortMissing(), false, 'replugging restores the same board');
    assert.equal(store.selectedPort()?.port, ch340);
  });

  console.log(`${checks}/${checks} port option checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

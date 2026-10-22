import '@angular/compiler';
import { Injector } from '@angular/core';
import assert from 'node:assert/strict';
import { SerialSessionStore } from '../src/app/features/user/workspace/firmware/serial-session.store';

async function main() {
  let opened = false;
  let openCount = 0;
  let releaseOpen: (() => void) | undefined;
  let heldOpen: Promise<void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    open: async () => {
      assert.equal(opened, false, 'never open a port owned by another operation');
      if (heldOpen) await heldOpen;
      opened = true;
      openCount++;
      port.readable = new ReadableStream({
        start: (c) => {
          controller = c;
        },
      });
    },
    close: async () => {
      assert.equal(port.readable?.locked ?? false, false, 'release reader before closing');
      opened = false;
      port.readable = null;
    },
  };
  const serial = Object.assign(new EventTarget(), { getPorts: async () => [port] });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true },
  });
  const injector = Injector.create({ providers: [SerialSessionStore] });
  const store = injector.get(SerialSessionStore);
  let destroyed = false;
  try {
    await store.refreshPorts();
    await store.withExclusivePort(async () => {
      assert.equal(opened, false);
      await port.open();
      await port.close();
    });
    assert.equal(store.state(), 'connected', 'successful upload starts the monitor');
    await assert.rejects(
      store.withExclusivePort(async () => {
        assert.equal(opened, false, 'monitor closed before failed upload');
        throw new Error('Upload failed');
      }),
      /Upload failed/,
    );
    assert.equal(store.state(), 'connected', 'failed upload restores an active monitor');
    await store.disconnect();
    await assert.rejects(
      store.withExclusivePort(async () => {
        throw new Error('Upload failed');
      }),
    );
    assert.equal(opened, false, 'failed upload does not start an unwanted monitor');

    await store.connect();
    let disconnect: Promise<void> | undefined;
    await store.withExclusivePort(async () => {
      disconnect = store.disconnect();
    });
    await disconnect;
    assert.equal(opened, false, 'explicit disconnect during upload wins over automatic restart');

    const count = openCount;
    await Promise.all([store.connect(), store.connect(), store.connect()]);
    assert.equal(openCount, count + 1, 'concurrent connect requests open only once');
    await store.setBaud(12345);
    assert.equal(store.baud(), 115200, 'unknown baud rejected');
    await Promise.all([store.setBaud(9600), store.setBaud(19200)]);
    assert.equal(store.state(), 'connected');
    assert.equal(store.baud(), 19200);
    controller!.enqueue(new TextEncoder().encode('before reconnect\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.disconnect();
    await store.connect();
    controller!.enqueue(new TextEncoder().encode('after reconnect\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ids = store.lines().map((line) => line.id);
    assert.equal(new Set(ids).size, ids.length, 'line identifiers stay unique across connections');

    store.lines.set([]);
    const emit = async (text: string | Uint8Array) => {
      controller!.enqueue(typeof text === 'string' ? new TextEncoder().encode(text) : text);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await emit('temperature: ');
    assert.equal(store.lines()[0]?.text, 'temperature: ', 'Serial.print renders without a newline');
    const partialId = store.lines()[0].id;
    await emit('25');
    assert.equal(store.lines().length, 1, 'fragments update one line');
    assert.equal(store.lines()[0].id, partialId);
    assert.equal(store.lines()[0].text, 'temperature: 25');
    await emit('\r');
    await emit('\n\n');
    assert.deepEqual(
      store.lines().map((line) => line.text),
      ['temperature: 25', ''],
    );
    const thai = new TextEncoder().encode('พร้อม');
    await emit(thai.slice(0, 1));
    await emit(thai.slice(1));
    assert.equal(store.lines().at(-1)?.text, 'พร้อม', 'UTF-8 survives byte boundaries');
    await emit('\n' + 'x'.repeat(5000) + '\n' + 'y'.repeat(5000));
    assert.ok(
      store.lines().every((line) => line.text.length <= 2048),
      'completed and partial lines are bounded',
    );
    assert.equal(
      store
        .lines()
        .slice(3)
        .map((line) => line.text)
        .join(''),
      'x'.repeat(5000) + 'y'.repeat(5000),
    );
    const countBeforeClose = store.lines().length;
    await store.disconnect();
    assert.equal(
      store.lines().length,
      countBeforeClose,
      'closing does not duplicate unfinished output',
    );

    await store.disconnect();
    heldOpen = new Promise((resolve) => {
      releaseOpen = resolve;
    });
    const pending = store.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    injector.destroy();
    destroyed = true;
    releaseOpen!();
    await pending;
    assert.equal(opened, false, 'destroy during open closes the late connection');
    console.log(
      'PASS serial session: exclusive uploads, failure recovery, disconnect intent, serialized connect/baud, live partial lines, UTF-8/CRLF, bounded output, unique logs, and teardown during open.',
    );
  } finally {
    if (!destroyed) injector.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

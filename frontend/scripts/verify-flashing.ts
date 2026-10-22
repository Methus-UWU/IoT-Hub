import assert from 'node:assert/strict';

import {
  IntelHexError,
  parseIntelHex,
} from '../src/app/features/user/workspace/firmware/intel-hex';
import { flashStk500v1 } from '../src/app/features/user/workspace/firmware/stk500v1-flasher';

/**
 * Flashing checks that need no board: the Intel HEX parser, and the STK500v1
 * flasher against an emulated optiboot that answers only after the DTR reset,
 * stores pages, and reads them back.
 */

let checks = 0;
async function check(name: string, test: () => Promise<void> | void): Promise<void> {
  await test();
  checks++;
  console.log(`PASS ${name}`);
}

function record(type: number, address: number, data: number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const checksum = (0x100 - (bytes.reduce((sum, byte) => sum + byte, 0) & 0xff)) & 0xff;
  return `:${[...bytes, checksum].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}
const EOF = ':00000001FF';

/** Emulated ATmega328P running optiboot, behind a Web Serial port. */
class FakeOptiboot {
  readonly flash = new Uint8Array(32 * 1024).fill(0xff);
  inBootloader = false;
  opened = false;
  private pending: number[] = [];
  private address = 0;
  private emit!: (bytes: number[]) => void;
  constructor(private readonly signature = [0x1e, 0x95, 0x0f]) {}

  port(): SerialPort {
    const board = this;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    this.emit = (bytes) => controller.enqueue(Uint8Array.from(bytes));
    return {
      open: async () => {
        board.opened = true;
      },
      close: async () => {
        board.opened = false;
      },
      setSignals: async (signals: SerialOutputSignals) => {
        if (signals.dataTerminalReady) board.inBootloader = true;
      },
      readable: new ReadableStream<Uint8Array>({ start: (c) => (controller = c) }),
      writable: new WritableStream<Uint8Array>({
        write: (chunk) => board.receive([...chunk]),
      }),
    } as unknown as SerialPort;
  }

  private receive(bytes: number[]): void {
    if (!this.inBootloader) return;
    this.pending.push(...bytes);
    for (;;) {
      const length = this.commandLength();
      if (length === null || this.pending.length < length) return;
      this.respond(this.pending.splice(0, length));
    }
  }

  private commandLength(): number | null {
    switch (this.pending[0]) {
      case undefined:
        return null;
      case 0x55:
        return 4;
      case 0x64:
        return this.pending.length < 3 ? Infinity : 5 + ((this.pending[1] << 8) | this.pending[2]);
      case 0x74:
        return 5;
      default:
        return 2;
    }
  }

  private respond(command: number[]): void {
    const ok = (payload: number[] = []) => this.emit([0x14, ...payload, 0x10]);
    switch (command[0]) {
      case 0x75:
        return ok(this.signature);
      case 0x55:
        this.address = ((command[2] << 8) | command[1]) * 2;
        return ok();
      case 0x64: {
        const size = (command[1] << 8) | command[2];
        this.flash.set(command.slice(4, 4 + size), this.address);
        return ok();
      }
      case 0x74: {
        const size = (command[1] << 8) | command[2];
        return ok([...this.flash.subarray(this.address, this.address + size)]);
      }
      default:
        return ok();
    }
  }
}

const silent = { log: () => undefined, progress: () => undefined };

async function main(): Promise<void> {
  await check('HEX records land at their addresses with 0xFF gaps', () => {
    const image = parseIntelHex([record(0, 0, [1, 2]), record(0, 4, [5]), EOF].join('\n'));
    assert.deepEqual([...image], [1, 2, 0xff, 0xff, 5]);
  });

  await check('HEX extended linear addresses are honoured', () => {
    const image = parseIntelHex([record(4, 0, [0, 1]), record(0, 0, [0xaa]), EOF].join('\r\n'));
    assert.equal(image[0x10000], 0xaa);
  });

  await check('HEX with a bad checksum, no EOF, or garbage is refused', () => {
    const line = record(0, 0, [1]);
    assert.throws(() => parseIntelHex(`${line.slice(0, -2)}00\n${EOF}`), IntelHexError);
    assert.throws(() => parseIntelHex(line), /truncated/);
    assert.throws(() => parseIntelHex('<html>not found</html>'), IntelHexError);
  });

  const program = Array.from({ length: 300 }, (_, index) => index & 0xff);
  const hex = new TextEncoder().encode(
    [record(0, 0, program.slice(0, 200)), record(0, 200, program.slice(200)), EOF].join('\n'),
  );

  await check('STK500v1 resets, writes, verifies, and closes the port', async () => {
    const board = new FakeOptiboot();
    const progress: number[] = [];
    await flashStk500v1(board.port(), hex, 115_200, {
      log: () => undefined,
      progress: (percent) => progress.push(percent),
    });
    assert.deepEqual([...board.flash.subarray(0, 300)], program);
    assert.equal(board.flash[300], 0xff);
    assert.equal(progress.at(-1), 100);
    assert.equal(board.opened, false);
  });

  await check('STK500v1 writes nothing to a board with another chip', async () => {
    const board = new FakeOptiboot([0x1e, 0x98, 0x01]);
    await assert.rejects(flashStk500v1(board.port(), hex, 115_200, silent), /not an ATmega328P/);
    assert.equal(board.flash[0], 0xff);
    assert.equal(board.opened, false);
  });

  console.log(`${checks}/${checks} flashing checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

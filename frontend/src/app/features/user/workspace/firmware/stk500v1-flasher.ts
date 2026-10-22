import type { FlashReporter } from './flash-reporter';
import { parseIntelHex } from './intel-hex';
import { SerialByteReader, SerialTimeoutError } from './serial-byte-reader';

/**
 * STK500v1 over Web Serial: the protocol the Arduino Uno's optiboot and the
 * Nano's older bootloader speak, as avrdude's `arduino` programmer does it.
 *
 * Every board this path flashes is an ATmega328P, so the signature is checked
 * before anything is written: a wrong board answers, and nothing is erased.
 */

const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const;

const ATMEGA328P_SIGNATURE = [0x1e, 0x95, 0x0f];
const PAGE_BYTES = 128;
const FLASH_MEMORY = 0x46; // 'F'
const RESPONSE_TIMEOUT_MS = 1_000;
/** Short, because optiboot gives up on a silent host after about a second. */
const SYNC_TIMEOUT_MS = 200;
const SYNC_ATTEMPTS = 10;

export class Stk500Error extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Stk500Session {
  constructor(
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
    private readonly reader: SerialByteReader,
  ) {}

  /** Sends a command and returns the payload between INSYNC and OK. */
  async command(
    bytes: number[],
    responseBytes = 0,
    timeoutMs = RESPONSE_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    await this.writer.write(Uint8Array.from([...bytes, STK.CRC_EOP]));
    const reply = await this.reader.read(responseBytes + 2, timeoutMs);
    if (reply[0] !== STK.INSYNC || reply[reply.length - 1] !== STK.OK) {
      throw new Stk500Error('The bootloader answered out of sync.');
    }
    return reply.subarray(1, reply.length - 1);
  }

  async sync(): Promise<void> {
    for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
      this.reader.discardBuffered();
      try {
        await this.command([STK.GET_SYNC], 0, SYNC_TIMEOUT_MS);
        return;
      } catch (error) {
        if (!(error instanceof SerialTimeoutError) && !(error instanceof Stk500Error)) throw error;
        await sleep(20);
      }
    }
    throw new Stk500Error(
      'The board did not enter its bootloader. Check the USB cable and the selected port, then try again.',
    );
  }

  async loadAddress(byteAddress: number): Promise<void> {
    const word = byteAddress >> 1;
    await this.command([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff]);
  }
}

/** Pulses DTR/RTS the way the Arduino IDE does; the board's reset capacitor does the rest. */
async function resetIntoBootloader(port: SerialPort): Promise<void> {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(250);
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await sleep(50);
}

export async function flashStk500v1(
  port: SerialPort,
  hexImage: Uint8Array,
  baudRate: number,
  reporter: FlashReporter,
): Promise<void> {
  const image = parseIntelHex(new TextDecoder().decode(hexImage));
  await port.open({ baudRate });
  const writer = port.writable!.getWriter();
  const reader = new SerialByteReader(port.readable!.getReader());

  try {
    const session = new Stk500Session(writer, reader);
    reporter.log('Resetting the board into its bootloader…');
    await resetIntoBootloader(port);
    await session.sync();

    const signature = [...(await session.command([STK.READ_SIGN], 3))];
    if (signature.join() !== ATMEGA328P_SIGNATURE.join()) {
      throw new Stk500Error(
        `This board reports chip signature ${signature.map((b) => b.toString(16).padStart(2, '0')).join(' ')}, not an ATmega328P. Nothing was written.`,
      );
    }

    await session.command([STK.ENTER_PROGMODE]);
    const pages = Math.ceil(image.length / PAGE_BYTES);
    reporter.log(`Writing ${image.length} bytes…`);

    for (let page = 0; page < pages; page++) {
      const address = page * PAGE_BYTES;
      const data = new Uint8Array(PAGE_BYTES).fill(0xff);
      data.set(image.subarray(address, address + PAGE_BYTES));
      await session.loadAddress(address);
      await session.command([STK.PROG_PAGE, 0x00, PAGE_BYTES, FLASH_MEMORY, ...data]);
      reporter.progress(Math.round(((page + 1) / pages) * 80));
    }

    reporter.log('Verifying…');
    for (let page = 0; page < pages; page++) {
      const address = page * PAGE_BYTES;
      await session.loadAddress(address);
      const written = await session.command(
        [STK.READ_PAGE, 0x00, PAGE_BYTES, FLASH_MEMORY],
        PAGE_BYTES,
      );
      const expected = image.subarray(address, address + PAGE_BYTES);
      if (expected.some((byte, index) => written[index] !== byte)) {
        throw new Stk500Error(`Verification failed at 0x${address.toString(16)}. Upload again.`);
      }
      reporter.progress(80 + Math.round(((page + 1) / pages) * 20));
    }

    await session.command([STK.LEAVE_PROGMODE]);
  } finally {
    writer.releaseLock();
    await reader.release();
    await port.close().catch(() => undefined);
  }
}

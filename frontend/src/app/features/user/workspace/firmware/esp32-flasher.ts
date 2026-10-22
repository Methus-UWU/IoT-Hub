import type { FlashReporter } from './flash-reporter';

/**
 * ESP32 flashing over Web Serial with esptool-js, Espressif's own port of
 * esptool. Loaded on demand: it is only needed at the moment of an upload.
 */

export interface FlashImage {
  address: number;
  data: Uint8Array;
}

export class Esp32FlashError extends Error {}

/** ROM bootloader speed; the stub then switches to the faster flashing baud. */
const ROM_BAUD = 115_200;

export async function flashEsp32(
  port: SerialPort,
  images: readonly FlashImage[],
  baudRate: number,
  reporter: FlashReporter,
): Promise<void> {
  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: baudRate,
    romBaudrate: ROM_BAUD,
    terminal: {
      clean: () => undefined,
      write: () => undefined,
      writeLine: (line: string) => {
        if (line.trim()) reporter.log(line.trim());
      },
    },
  });

  try {
    reporter.log('Connecting to the ESP32 bootloader…');
    await loader.main('default_reset');

    // The images are built for the classic ESP32; an S2/S3/C3 boots from other
    // offsets with another bootloader and would be left unbootable.
    const chip = loader.chip.CHIP_NAME;
    if (chip !== 'ESP32') {
      throw new Esp32FlashError(
        `This board is an ${chip}, but the project is built for a classic ESP32. Nothing was written.`,
      );
    }

    const total = images.reduce((sum, image) => sum + image.data.length, 0);
    const before = images.map((_, index) =>
      images.slice(0, index).reduce((sum, image) => sum + image.data.length, 0),
    );
    await loader.writeFlash({
      fileArray: images.map((image) => ({ address: image.address, data: image.data })),
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      // esptool-js counts compressed bytes per file, so weight each file's
      // fraction by its image size.
      reportProgress: (fileIndex, written, fileTotal) => {
        const done = before[fileIndex] + (written / fileTotal) * images[fileIndex].data.length;
        reporter.progress(Math.round((done / total) * 100));
      },
    });

    reporter.log('Restarting the board…');
    await loader.after('hard_reset');
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

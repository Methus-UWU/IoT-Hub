/**
 * Intel HEX to a flat program image, for the AVR flasher.
 *
 * Unwritten gaps are 0xFF, which is what erased AVR flash reads as, so a page
 * that straddles a gap is written exactly as an erased-then-programmed page
 * would read back.
 */

export class IntelHexError extends Error {}

/** Flash on the largest AVR this platform builds for (ATmega2560). */
const MAX_IMAGE_BYTES = 256 * 1024;

export function parseIntelHex(text: string): Uint8Array {
  const chunks: { address: number; data: Uint8Array }[] = [];
  let base = 0;
  let end = 0;
  let sawEof = false;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  lines.forEach((line, index) => {
    if (sawEof) return;
    if (!/^:([0-9A-Fa-f]{2})+$/.test(line) || line.length < 11) {
      throw new IntelHexError(`Line ${index + 1} is not an Intel HEX record.`);
    }

    const bytes = Uint8Array.from(line.slice(1).match(/../g)!, (pair) => parseInt(pair, 16));
    const length = bytes[0];
    if (bytes.length !== length + 5) {
      throw new IntelHexError(`Line ${index + 1} has the wrong length.`);
    }
    if (bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0) !== 0) {
      throw new IntelHexError(`Line ${index + 1} fails its checksum.`);
    }

    const offset = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + length);

    switch (type) {
      case 0x00: {
        const address = base + offset;
        end = Math.max(end, address + length);
        if (end > MAX_IMAGE_BYTES)
          throw new IntelHexError('The image is larger than any supported board.');
        chunks.push({ address, data });
        break;
      }
      case 0x01:
        sawEof = true;
        break;
      case 0x02:
        base = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x04:
        base = ((data[0] << 8) | data[1]) << 16;
        break;
      case 0x03:
      case 0x05:
        // Start addresses: meaningless to a bootloader that always jumps to 0.
        break;
      default:
        throw new IntelHexError(`Line ${index + 1} has unknown record type ${type}.`);
    }
  });

  if (!sawEof) throw new IntelHexError('The image is truncated: it has no end-of-file record.');
  if (end === 0) throw new IntelHexError('The image is empty.');

  const image = new Uint8Array(end).fill(0xff);
  for (const chunk of chunks) image.set(chunk.data, chunk.address);
  return image;
}

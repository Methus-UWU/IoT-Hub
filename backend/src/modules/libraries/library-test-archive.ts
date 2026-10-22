/**
 * Builds small tar archives for the library tests. Test support only; nothing in
 * the API writes archives.
 */
export interface TestTarEntry {
  path: string;
  content: string | Buffer;
  /** Tar type flag; '0' (file) by default, '2' for a symlink. */
  type?: string;
  link?: string;
  /** Written as a preceding pax header, as long names are in real archives. */
  paxPath?: string;
}

export function tarOf(entries: TestTarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    if (entry.paxPath) {
      const record = paxRecord('path', entry.paxPath);
      blocks.push(header('PaxHeader', record.length, 'x'), pad(record));
    }
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    blocks.push(
      header(entry.path, data.length, entry.type ?? '0', entry.link),
      pad(data),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function header(path: string, size: number, type: string, link = ''): Buffer {
  const block = Buffer.alloc(512);
  block.write(path.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100, 'latin1');
  block.write('0000000\0', 108, 'latin1');
  block.write('0000000\0', 116, 'latin1');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  block.write('00000000000\0', 136, 'latin1');
  block.write(type, 156, 'latin1');
  block.write(link.slice(0, 100), 157, 'utf8');
  block.write('ustar\0', 257, 'latin1');
  block.write('00', 263, 'latin1');
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return block;
}

function pad(data: Buffer): Buffer {
  const remainder = data.length % 512;
  return remainder
    ? Buffer.concat([data, Buffer.alloc(512 - remainder)])
    : data;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) {
    length = String(length).length + Buffer.byteLength(body);
  }
  return Buffer.from(`${length}${body}`, 'utf8');
}

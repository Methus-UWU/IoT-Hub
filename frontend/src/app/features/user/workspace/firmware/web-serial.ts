/**
 * Web Serial access to the user's own boards.
 *
 * The browser asks the user before any page can open a port, and only Chromium
 * desktop browsers implement it. The server never sees a port: hardware stays
 * on the user's machine.
 */

export interface SerialPortChoice {
  id: string;
  label: string;
  port: SerialPort;
  /**
   * USB identity, `vid:pid#n` (n counts identical boards). Web Serial exposes no COM or
   * /dev name and no serial number, so this is what survives a reload or a replug.
   */
  fingerprint: string;
  usbVendorId?: number;
}

/** Why Web Serial cannot be used here, or null when it can. */
export type SerialUnavailableReason = 'unsupported' | 'insecure';

/** Which flashing family a board or a USB bridge points to; `unknown` decides nothing. */
export type BoardFamily = 'esp32' | 'avr' | 'unknown';

/** USB-serial bridges found on the boards this platform supports. */
const BRIDGES: Readonly<Record<number, string>> = {
  0x10c4: 'CP210x',
  0x1a86: 'CH340',
  0x0403: 'FTDI',
  0x2341: 'Arduino',
  0x2a03: 'Arduino',
  0x303a: 'Espressif USB',
};

export function webSerialSupported(): boolean {
  return serialUnavailableReason() === null;
}

export function serialUnavailableReason(): SerialUnavailableReason | null {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return 'unsupported';
  return window.isSecureContext ? null : 'insecure';
}

/** `vid:pid#n` for each port, numbering ports that share a USB identity in list order. */
export function portFingerprints(ports: readonly SerialPort[]): string[] {
  const seen = new Map<string, number>();
  return ports.map((port) => {
    const { usbVendorId, usbProductId } = port.getInfo();
    const identity =
      usbVendorId === undefined ? 'serial' : `${hex(usbVendorId)}:${hex(usbProductId ?? 0)}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return `${identity}#${occurrence}`;
  });
}

export function boardFamily(board: string): BoardFamily {
  const name = board.toLowerCase();
  if (name.includes('esp32')) return 'esp32';
  if (/\b(uno|nano|mega|arduino)\b/.test(name)) return 'avr';
  return 'unknown';
}

/**
 * The family a USB vendor id implies, when it implies one.
 *
 * Only vendor ids that belong to one family count. CP210x and CH340 bridges sit on both
 * ESP32 and Arduino-compatible boards, and Arduino's own id also covers the Nano ESP32,
 * so those say nothing.
 */
export function portFamily(usbVendorId: number | undefined): BoardFamily {
  return usbVendorId === 0x303a ? 'esp32' : 'unknown';
}

/** True when the port is known to be a different family from the project's board. */
export function portMismatchesBoard(port: SerialPortChoice, board: string): boolean {
  const fromPort = portFamily(port.usbVendorId);
  const fromBoard = boardFamily(board);
  return fromPort !== 'unknown' && fromBoard !== 'unknown' && fromPort !== fromBoard;
}

export function describePort(port: SerialPort, index: number): string {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined) return `Serial port ${index + 1}`;
  const bridge = BRIDGES[usbVendorId] ?? 'USB serial';
  const ids = `${hex(usbVendorId)}:${hex(usbProductId ?? 0)}`;
  return `${bridge} · ${ids}`;
}

function hex(value: number): string {
  return value.toString(16).padStart(4, '0');
}

/** Ports this site was already allowed to use. */
export async function grantedPorts(): Promise<SerialPort[]> {
  return webSerialSupported() ? navigator.serial.getPorts() : [];
}

/** Opens the browser's port picker. Must run inside a click handler. */
export async function choosePort(): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort();
  } catch (error) {
    // The user closed the picker without choosing.
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

/** The browser or its policy refused to show the port picker at all. */
export function isSerialPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'SecurityError';
}

export interface SerialLine {
  id: number;
  timestamp: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/** A line longer than this is emitted in pieces rather than held forever. */
const MAX_LINE_LENGTH = 2_048;

/**
 * Reads a port as text lines until closed. One monitor per port; the flasher
 * needs the port to itself, so the monitor is closed before an upload.
 */
export class SerialMonitor {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private loop: Promise<void> | null = null;
  private closed = false;
  private nextId = 1;
  private partialLine: SerialLine | null = null;

  constructor(
    private readonly port: SerialPort,
    /** Repeated IDs update an unfinished line as Serial.print() chunks arrive. */
    private readonly onLine: (line: SerialLine) => void,
    /** Called when the port stops on its own, e.g. the board was unplugged. */
    private readonly onLost: () => void,
  ) {}

  async open(baudRate: number): Promise<void> {
    await this.port.open({ baudRate });
    this.loop = this.readLoop();
  }

  /** Closes the port once the read loop has let go of the stream; a locked port cannot close. */
  async close(): Promise<void> {
    this.closed = true;
    await this.reader?.cancel().catch(() => undefined);
    await this.loop;
    await this.port.close().catch(() => undefined);
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let partial = '';
    try {
      this.reader = this.port.readable?.getReader() ?? null;
      if (!this.reader) throw new Error('Serial port is not readable');
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        partial += decoder.decode(value, { stream: true });
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        while (partial.length > MAX_LINE_LENGTH) {
          lines.push(partial.slice(0, MAX_LINE_LENGTH));
          partial = partial.slice(MAX_LINE_LENGTH);
        }
        for (const line of lines) this.publishLine(line.replace(/\r$/, ''), true);
        if (partial) this.publishLine(partial.replace(/\r$/, ''), false);
      }
    } catch (error) {
      if (partial) {
        this.publishLine(partial.replace(/\r$/, ''), true);
        partial = '';
      }
      if (!this.closed) this.emit(`Serial port error: ${(error as Error).message}`, 'stderr');
    } finally {
      partial += decoder.decode();
      if (partial) this.publishLine(partial.replace(/\r$/, ''), true);
      this.reader?.releaseLock();
      this.reader = null;
      if (!this.closed) this.onLost();
    }
  }

  private publishLine(text: string, complete: boolean): void {
    while (text.length > MAX_LINE_LENGTH) {
      this.publishLine(text.slice(0, MAX_LINE_LENGTH), true);
      text = text.slice(MAX_LINE_LENGTH);
    }
    const line: SerialLine = {
      id: this.partialLine?.id ?? this.nextId++,
      timestamp: this.partialLine?.timestamp ?? new Date().toISOString(),
      stream: 'stdout',
      text,
    };
    this.partialLine = complete ? null : line;
    this.onLine(line);
  }

  private emit(text: string, stream: SerialLine['stream']): void {
    this.onLine({ id: this.nextId++, timestamp: new Date().toISOString(), stream, text });
  }
}

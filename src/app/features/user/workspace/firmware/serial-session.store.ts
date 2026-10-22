import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  SerialMonitor,
  choosePort,
  describePort,
  grantedPorts,
  portFingerprints,
  serialUnavailableReason,
  type SerialLine,
  type SerialPortChoice,
} from './web-serial';

export type SerialState = 'idle' | 'connecting' | 'connected' | 'error';
export const SERIAL_BAUD_RATES = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;
const MAX_SERIAL_LINES = 2000;

/** One hardware session per signed-in shell; views do not own the port. */
@Injectable()
export class SerialSessionStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly portIds = new WeakMap<SerialPort, string>();
  private nextPortId = 1;
  private nextLineId = 1;
  private monitor: SerialMonitor | null = null;
  private wanted = false;
  private intentVersion = 0;
  private operations: Promise<unknown> = Promise.resolve();

  readonly unavailableReason = serialUnavailableReason();
  readonly supported = this.unavailableReason === null;
  readonly ports = signal<readonly SerialPortChoice[]>([]);
  readonly selectedPortId = signal('');
  readonly selectedPort = computed(
    () => this.ports().find((port) => port.id === this.selectedPortId()) ?? null,
  );
  /** The chosen board was unplugged; its identity is kept so replugging it reconnects. */
  readonly selectedPortMissing = computed(
    () => this.selectedPortId() !== '' && this.selectedPort() === null,
  );
  /** Label of the last port that was selected, shown while it is unplugged. */
  readonly selectedPortLabel = signal('');
  readonly refreshing = signal(false);
  readonly state = signal<SerialState>('idle');
  readonly baud = signal(115200);
  readonly lines = signal<readonly SerialLine[]>([]);

  constructor() {
    const refresh = () => void this.refreshPorts();
    if (this.supported) {
      navigator.serial.addEventListener('connect', refresh);
      navigator.serial.addEventListener('disconnect', refresh);
    }
    this.destroyRef.onDestroy(() => {
      this.wanted = false;
      void this.enqueue(() => this.close());
      if (this.supported) {
        navigator.serial.removeEventListener('connect', refresh);
        navigator.serial.removeEventListener('disconnect', refresh);
      }
    });
  }

  /**
   * Re-reads the ports this site may use. No prompt is shown: a port the user never
   * granted stays invisible until they pick it in the browser's own dialog.
   */
  async refreshPorts(): Promise<void> {
    this.refreshing.set(true);
    try {
      const ports = await grantedPorts();
      if (this.destroyRef.destroyed) return;
      const fingerprints = portFingerprints(ports);
      this.ports.set(
        ports.map((port, index) => ({
          id: this.portId(port),
          label: describePort(port, index),
          port,
          fingerprint: fingerprints[index],
          usbVendorId: port.getInfo().usbVendorId,
        })),
      );
      // Remember a disconnected board's identity instead of opening a different one.
      if (!this.selectedPortId()) this.selectedPortId.set(this.ports()[0]?.id ?? '');
      this.rememberSelectedLabel();
      if (this.wanted) await this.enqueue(() => this.open());
    } catch {
      this.append('อ่านรายการพอร์ตไม่สำเร็จ กรุณาลองเลือกอุปกรณ์อีกครั้ง', 'stderr');
    } finally {
      this.refreshing.set(false);
    }
  }

  /**
   * Selects the port with this fingerprint if it is plugged in, e.g. the board a project
   * used last time. Returns whether such a port is present.
   */
  async preferPort(fingerprint: string | null): Promise<boolean> {
    const port = fingerprint
      ? this.ports().find((candidate) => candidate.fingerprint === fingerprint)
      : undefined;
    if (!port) return false;
    await this.selectPort(port.id);
    return true;
  }

  async addPort(): Promise<boolean> {
    const port = await choosePort();
    if (!port || this.destroyRef.destroyed) return false;
    await this.refreshPorts();
    await this.selectPort(this.portId(port));
    return true;
  }

  selectPort(id: string): Promise<void> {
    return this.enqueue(async () => {
      if (id === this.selectedPortId() || !this.ports().some((port) => port.id === id)) return;
      await this.close();
      this.selectedPortId.set(id);
      this.rememberSelectedLabel();
      this.lines.set([]);
      await this.open();
    });
  }

  setBaud(baud: number): Promise<void> {
    if (!SERIAL_BAUD_RATES.some((value) => value === baud)) return Promise.resolve();
    return this.enqueue(async () => {
      if (baud === this.baud()) return;
      await this.close();
      this.baud.set(baud);
      await this.open();
    });
  }

  connect(): Promise<void> {
    this.intentVersion++;
    this.wanted = true;
    return this.enqueue(() => this.open());
  }

  disconnect(): Promise<void> {
    this.intentVersion++;
    this.wanted = false;
    return this.enqueue(() => this.close());
  }

  /** Serialize flash and monitor access: a port can only have one reader. */
  withExclusivePort(operation: (port: SerialPortChoice) => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      const port = this.selectedPort();
      if (!port || this.destroyRef.destroyed) throw new Error('Select a device before uploading.');
      const intentVersion = this.intentVersion;
      await this.close();
      try {
        await operation(port);
        if (intentVersion === this.intentVersion) this.wanted = true;
      } finally {
        // Restore an active monitor even if the upload fails.
        await this.open();
      }
    });
  }

  private rememberSelectedLabel(): void {
    const port = this.selectedPort();
    if (port) this.selectedPortLabel.set(port.label);
  }

  private async open(): Promise<void> {
    const port = this.selectedPort();
    if (!this.wanted || !port || this.monitor || this.destroyRef.destroyed) return;
    this.state.set('connecting');
    let sourceLineId = 0;
    let sessionLineId = 0;
    const monitor = new SerialMonitor(
      port.port,
      (line) => {
        if (line.id !== sourceLineId) {
          sourceLineId = line.id;
          sessionLineId = this.nextLineId++;
        }
        const entry = { ...line, id: sessionLineId };
        this.lines.update((lines) => {
          const index = lines.findIndex((existing) => existing.id === sessionLineId);
          if (index < 0) return [...lines, entry].slice(-MAX_SERIAL_LINES);
          return lines.map((existing, position) => (position === index ? entry : existing));
        });
      },
      () => {
        if (this.monitor !== monitor) return;
        this.monitor = null;
        this.state.set('error');
        this.append('การเชื่อมต่อกับอุปกรณ์สิ้นสุดลง', 'stderr');
        void this.enqueue(async () => {
          await monitor.close();
        });
      },
    );
    this.monitor = monitor;
    try {
      await monitor.open(this.baud());
      if (this.monitor !== monitor) return;
      if (this.destroyRef.destroyed || !this.wanted) {
        await this.close();
        return;
      }
      this.state.set('connected');
    } catch {
      this.monitor = null;
      this.state.set('error');
      this.append('เปิดพอร์ตไม่สำเร็จ ตรวจสอบสาย USB และปิดโปรแกรมอื่นที่ใช้พอร์ตนี้', 'stderr');
    }
  }

  private async close(): Promise<void> {
    const monitor = this.monitor;
    this.monitor = null;
    await monitor?.close();
    this.state.set('idle');
  }

  private append(
    text: string,
    stream: SerialLine['stream'],
    timestamp = new Date().toISOString(),
  ): void {
    this.lines.update((lines) =>
      [...lines, { id: this.nextLineId++, text, stream, timestamp }].slice(-MAX_SERIAL_LINES),
    );
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation);
    this.operations = next.catch(() => undefined);
    return next;
  }

  private portId(port: SerialPort): string {
    let id = this.portIds.get(port);
    if (!id) {
      id = `port-${this.nextPortId++}`;
      this.portIds.set(port, id);
    }
    return id;
  }
}

import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { WorkspaceBuildService } from './workspace-build.service';

const execFileAsync = promisify(execFile);
const MAX_SERIAL_LINES = 2_000;
const OUTPUT_BATCH_SIZE = 500;

export interface WorkspaceDevice {
  port: string;
  description: string;
  hardwareId: string | null;
}

interface PlatformIoDevice {
  port?: unknown;
  description?: unknown;
  hwid?: unknown;
}

export interface SerialMonitorLine {
  id: number;
  timestamp: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

interface SerialMonitorSession {
  process: ChildProcessWithoutNullStreams;
  port: string;
  baud: number;
  running: boolean;
  exitCode: number | null;
  nextId: number;
  lines: SerialMonitorLine[];
  remainder: Record<'stdout' | 'stderr', string>;
}

@Injectable()
export class WorkspaceDeviceService implements OnModuleDestroy {
  private readonly platformioCommand: string;
  private readonly platformioEnvironment: NodeJS.ProcessEnv;
  private readonly sessions = new Map<string, SerialMonitorSession>();

  constructor(
    config: ConfigService,
    private readonly builds: WorkspaceBuildService,
  ) {
    const command = config.get<string>('PLATFORMIO_COMMAND') ?? 'pio';
    this.platformioCommand = this.resolveCommand(command);
    this.platformioEnvironment = this.buildEnvironment(
      config.get<string>('PLATFORMIO_CORE_DIR'),
    );
  }

  async listDevices(): Promise<{
    available: boolean;
    devices: WorkspaceDevice[];
    message: string | null;
  }> {
    const toolchain = await this.builds.toolchainStatus();
    if (!toolchain.available) {
      return {
        available: false,
        devices: [],
        message:
          'PlatformIO Core is not installed. Configure PLATFORMIO_COMMAND with the pio executable path.',
      };
    }

    try {
      const { stdout } = await execFileAsync(
        this.platformioCommand,
        ['device', 'list', '--serial', '--json-output'],
        {
          env: this.platformioEnvironment,
          timeout: 10_000,
          maxBuffer: 512 * 1024,
          windowsHide: true,
        },
      );
      const parsed: unknown = JSON.parse(stdout);
      const devices = Array.isArray(parsed)
        ? parsed.flatMap((item: unknown) => this.parseDevice(item))
        : [];
      return { available: true, devices, message: null };
    } catch (error: unknown) {
      return {
        available: true,
        devices: [],
        message: this.errorMessage(error, 'Could not list serial devices'),
      };
    }
  }

  async startMonitor(
    userId: string,
    projectId: string,
    port: string,
    baud: number,
  ) {
    const key = this.sessionKey(userId, projectId);
    const current = this.sessions.get(key);
    if (current?.running) {
      throw new ConflictException('Serial Monitor is already running');
    }

    const toolchain = await this.builds.toolchainStatus();
    if (!toolchain.available) {
      throw new ServiceUnavailableException(
        'PlatformIO Core is not installed. Configure PLATFORMIO_COMMAND with the pio executable path.',
      );
    }

    const monitorProcess = spawn(
      this.platformioCommand,
      ['device', 'monitor', '--port', port, '--baud', String(baud), '--quiet'],
      {
        env: this.platformioEnvironment,
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    const session: SerialMonitorSession = {
      process: monitorProcess,
      port,
      baud,
      running: true,
      exitCode: null,
      nextId: 0,
      lines: [],
      remainder: { stdout: '', stderr: '' },
    };
    this.sessions.set(key, session);

    monitorProcess.stdout.on('data', (chunk: Buffer) =>
      this.appendChunk(session, 'stdout', chunk),
    );
    monitorProcess.stderr.on('data', (chunk: Buffer) =>
      this.appendChunk(session, 'stderr', chunk),
    );
    monitorProcess.on('error', (error) => {
      this.appendLine(session, 'stderr', error.message);
      session.running = false;
    });
    monitorProcess.on('close', (exitCode) => {
      this.flushRemainders(session);
      session.running = false;
      session.exitCode = exitCode;
    });

    return { running: true, port, baud, cursor: 0 };
  }

  monitorOutput(userId: string, projectId: string, cursor: number) {
    const session = this.sessions.get(this.sessionKey(userId, projectId));
    if (!session) {
      return {
        running: false,
        port: null,
        baud: null,
        exitCode: null,
        cursor: 0,
        lines: [] as SerialMonitorLine[],
      };
    }

    const lines = session.lines
      .filter((line) => line.id >= cursor)
      .slice(0, OUTPUT_BATCH_SIZE);
    const nextCursor =
      lines.length > 0 ? lines[lines.length - 1].id + 1 : cursor;
    return {
      running: session.running,
      port: session.port,
      baud: session.baud,
      exitCode: session.exitCode,
      cursor: nextCursor,
      lines,
    };
  }

  stopMonitor(userId: string, projectId: string) {
    const session = this.sessions.get(this.sessionKey(userId, projectId));
    if (!session) return { running: false };
    if (session.running) session.process.kill();
    session.running = false;
    this.flushRemainders(session);
    return { running: false };
  }

  onModuleDestroy(): void {
    for (const session of this.sessions.values()) {
      if (session.running) session.process.kill();
    }
    this.sessions.clear();
  }

  private parseDevice(item: unknown): WorkspaceDevice[] {
    if (!item || typeof item !== 'object') return [];
    const device = item as PlatformIoDevice;
    if (typeof device.port !== 'string' || !device.port.trim()) return [];
    return [
      {
        port: device.port,
        description:
          typeof device.description === 'string' && device.description.trim()
            ? device.description
            : 'Serial device',
        hardwareId: typeof device.hwid === 'string' ? device.hwid : null,
      },
    ];
  }

  private appendChunk(
    session: SerialMonitorSession,
    stream: 'stdout' | 'stderr',
    chunk: Buffer,
  ): void {
    const parts = `${session.remainder[stream]}${chunk.toString('utf8')}`.split(
      /\r?\n/,
    );
    session.remainder[stream] = parts.pop() ?? '';
    for (const line of parts) this.appendLine(session, stream, line);
  }

  private appendLine(
    session: SerialMonitorSession,
    stream: 'stdout' | 'stderr',
    text: string,
  ): void {
    if (!text) return;
    session.lines.push({
      id: session.nextId++,
      timestamp: new Date().toISOString(),
      stream,
      text,
    });
    if (session.lines.length > MAX_SERIAL_LINES) {
      session.lines.splice(0, session.lines.length - MAX_SERIAL_LINES);
    }
  }

  private flushRemainders(session: SerialMonitorSession): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const remainder = session.remainder[stream];
      if (remainder) this.appendLine(session, stream, remainder);
      session.remainder[stream] = '';
    }
  }

  private sessionKey(userId: string, projectId: string): string {
    return `${userId}:${projectId}`;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (!error || typeof error !== 'object') return fallback;
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : fallback;
  }

  private resolveCommand(command: string): string {
    return command.includes('/') || command.includes('\\')
      ? resolve(command)
      : command;
  }

  private buildEnvironment(coreDir?: string): NodeJS.ProcessEnv {
    return coreDir
      ? { ...process.env, PLATFORMIO_CORE_DIR: resolve(coreDir) }
      : process.env;
  }
}

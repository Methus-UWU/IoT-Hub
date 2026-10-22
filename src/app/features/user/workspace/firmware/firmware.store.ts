import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { flashEsp32 } from './esp32-flasher';
import type { FlashReporter } from './flash-reporter';
import {
  ACTIVE_BUILD_STATUSES,
  FirmwareBuild,
  FirmwareBuildsClient,
} from './firmware-builds.client';
import { flashStk500v1 } from './stk500v1-flasher';
import { SerialSessionStore } from './serial-session.store';

export type BuildState = 'idle' | 'building' | 'success' | 'error';
export type FirmwareTask = 'build' | 'upload';

const POLL_INTERVAL_MS = 1_500;
/** After this long in the queue the user is told the build is waiting for a worker. */
const QUEUE_NOTICE_MS = 15_000;

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  compile: 'Compilation failed. The compiler output above shows where.',
  rejected: 'The compiler refused this project.',
  timeout: 'Compilation timed out.',
  worker_error: 'The compile worker stopped unexpectedly. Try again.',
  artifacts: 'Compilation finished without a flashable image.',
};

/**
 * Builds on the server, flashes and monitors over Web Serial.
 *
 * Provided per workspace page for build state; the shell owns the serial session.
 * The build itself runs on the server and outlives the page; returning finds it in
 * the project's build history.
 */
@Injectable()
export class FirmwareStore {
  private readonly builds = inject(FirmwareBuildsClient);
  readonly serial = inject(SerialSessionStore);
  private polling: AbortController | null = null;
  readonly supported = this.serial.supported;
  readonly buildState = signal<BuildState>('idle');
  readonly activeTask = signal<FirmwareTask>('build');
  readonly logs = signal<string[]>([
    'Compile console ready. Select Compile to compile on the server.',
  ]);
  /** Upload progress, 0–100; null when nothing is being written. */
  readonly progress = signal<number | null>(null);
  readonly lastBuild = signal<FirmwareBuild | null>(null);

  readonly unavailableReason = this.serial.unavailableReason;
  readonly ports = this.serial.ports;
  readonly selectedPortId = this.serial.selectedPortId;
  readonly selectedPort = this.serial.selectedPort;
  readonly selectedPortMissing = this.serial.selectedPortMissing;
  readonly selectedPortLabel = this.serial.selectedPortLabel;
  readonly serialState = this.serial.state;
  readonly serialBaud = this.serial.baud;
  readonly serialLines = this.serial.lines;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.polling?.abort());
  }

  refreshPorts(): Promise<void> {
    return this.serial.refreshPorts();
  }
  addPort(): Promise<boolean> {
    return this.serial.addPort();
  }
  selectPort(id: string): Promise<void> {
    return this.serial.selectPort(id);
  }
  preferPort(fingerprint: string | null): Promise<boolean> {
    return this.serial.preferPort(fingerprint);
  }
  connectMonitor(): Promise<void> {
    return this.serial.connect();
  }
  disconnectMonitor(): Promise<void> {
    return this.serial.disconnect();
  }
  toggleMonitor(): Promise<void> {
    return this.serialState() === 'connected' ? this.serial.disconnect() : this.serial.connect();
  }
  clearSerial(): void {
    this.serial.lines.set([]);
  }

  // ── Build and upload ─────────────────────────────────────────────────────

  /**
   * Builds the project as stored, then for `upload` writes it to the selected
   * board. The caller saves the editor's files first.
   */
  async run(projectId: string, task: FirmwareTask): Promise<boolean> {
    if (this.buildState() === 'building') return false;
    if (task === 'upload' && !this.selectedPort()) {
      this.fail(['Select a device before uploading.']);
      return false;
    }

    this.activeTask.set(task);
    this.buildState.set('building');
    this.progress.set(null);
    this.logs.set(['Requesting compilation…']);
    this.polling?.abort();
    const polling = (this.polling = new AbortController());

    try {
      const build = await this.startOrJoin(projectId);
      const finished = await this.waitFor(projectId, build, polling.signal);
      if (!finished) return false;
      this.lastBuild.set(finished);

      if (finished.status !== 'succeeded') {
        this.fail([
          ...this.logs(),
          finished.status === 'canceled'
            ? 'Compilation was canceled.'
            : (FAILURE_MESSAGES[finished.failureReason ?? ''] ?? 'Compilation failed.'),
        ]);
        return false;
      }

      const firmwareBytes = finished.artifacts.reduce(
        (sum, artifact) => sum + artifact.sizeBytes,
        0,
      );
      this.append(`Compilation successful · ${formatBytes(firmwareBytes)} of firmware.`);
      if (task === 'upload') await this.flash(projectId, finished);
      this.buildState.set('success');
      return true;
    } catch (error: unknown) {
      if (polling.signal.aborted) return false;
      this.fail([...this.logs(), ...errorLines(error)]);
      return false;
    } finally {
      this.progress.set(null);
      if (this.polling === polling) this.polling = null;
    }
  }

  /** Saves the last build's images, for boards the browser cannot flash. */
  async downloadLastBuild(projectId: string): Promise<void> {
    const build = this.lastBuild();
    if (!build || build.status !== 'succeeded') return;
    for (const artifact of build.artifacts) {
      const data = await this.builds.artifact(projectId, build.id, artifact.name);
      saveFile(data, artifact.name);
    }
  }

  private async startOrJoin(projectId: string): Promise<FirmwareBuild> {
    try {
      const { build, reused } = await this.builds.request(projectId);
      this.append(
        reused
          ? 'Sources unchanged since the last successful compile — reusing its firmware.'
          : 'Compilation queued on the server.',
      );
      return build;
    } catch (error: unknown) {
      // A build of this project is already running (another tab, or before a
      // reload): follow it instead of failing.
      const body = error instanceof HttpErrorResponse ? errorBody(error) : null;
      if (body?.code === 'BUILD_ALREADY_ACTIVE' && typeof body.buildId === 'string') {
        this.append('This project is already compiling — following it.');
        return this.builds.get(projectId, body.buildId);
      }
      throw error;
    }
  }

  private async waitFor(
    projectId: string,
    initial: FirmwareBuild,
    signal: AbortSignal,
  ): Promise<FirmwareBuild | null> {
    let build = initial;
    let started = false;
    let toldWaiting = false;
    const queuedAt = Date.now();

    while (ACTIVE_BUILD_STATUSES.includes(build.status)) {
      if (!(await sleep(POLL_INTERVAL_MS, signal))) return null;
      build = await this.builds.get(projectId, build.id);

      if (build.status === 'running' && !started) {
        started = true;
        this.append('Compiling…');
      } else if (
        build.status === 'queued' &&
        !toldWaiting &&
        Date.now() - queuedAt > QUEUE_NOTICE_MS
      ) {
        toldWaiting = true;
        this.append('Waiting for a free compile worker…');
      }
    }

    if (build.log) this.logs.update((lines) => [...lines, ...outputLines(build.log!)]);
    return build;
  }

  private async flash(projectId: string, build: FirmwareBuild): Promise<void> {
    const choice = this.selectedPort();
    if (!choice) throw new Error('Select a device before uploading.');
    if (!build.flash) throw new Error('This board cannot be flashed from the browser.');
    if (build.flash.protocol === 'stk500v2') {
      this.append(
        'This board cannot be flashed from the browser yet. Downloading firmware.hex instead.',
      );
      await this.downloadLastBuild(projectId);
      return;
    }

    const images = await Promise.all(
      build.artifacts.map(async (artifact) => ({
        artifact,
        data: await this.builds.artifact(projectId, build.id, artifact.name),
      })),
    );

    this.append(`Uploading to ${choice.label}…`);
    this.progress.set(0);
    const reporter: FlashReporter = {
      log: (line) => this.append(line),
      progress: (percent) => this.progress.set(percent),
    };

    const flash = build.flash;
    await this.serial.withExclusivePort(async (port) => {
      if (flash.protocol === 'esptool') {
        await flashEsp32(
          port.port,
          images.map(({ artifact, data }) => ({ address: artifact.flashOffset ?? 0, data })),
          flash.baudRate,
          reporter,
        );
      } else {
        const hex = images.find(({ artifact }) => artifact.name === 'firmware.hex');
        if (!hex) throw new Error('The compiled firmware has no firmware.hex to upload.');
        await flashStk500v1(port.port, hex.data, flash.baudRate, reporter);
      }

      this.append('Upload complete. The board is running the new firmware.');
    });
  }

  private append(line: string): void {
    this.logs.update((lines) => [...lines, line]);
  }

  private fail(lines: string[]): void {
    this.logs.set(lines);
    this.buildState.set('error');
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function outputLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function errorBody(
  error: HttpErrorResponse,
): { code?: string; message?: string; buildId?: unknown } | null {
  const body = error.error as {
    error?: { code?: string; message?: string; buildId?: unknown };
  } | null;
  return body && typeof body === 'object' && body.error ? body.error : null;
}

function errorLines(error: unknown): string[] {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return ['The server is unreachable. Check your connection and try again.'];
    const body = errorBody(error);
    // A 5xx carries only a generic message, so the code says what happened.
    if (body?.code === 'BUILD_WORKER_NOT_CONFIGURED') {
      return ['Firmware compilation is not enabled on this server yet.'];
    }
    return [body?.message ?? `The request failed (${error.status}).`];
  }
  return [portErrorMessage(error)];
}

/** Web Serial reports a busy or vanished port as a DOMException with a terse message. */
function portErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'InvalidStateError')
      return 'The port is already open in another tab or program.';
    if (error.name === 'NetworkError')
      return 'The device could not be opened. Is it still plugged in?';
  }
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function saveFile(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(
    new Blob([data as BlobPart], { type: 'application/octet-stream' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

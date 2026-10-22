import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectsApiService } from '../../../../../core/services/projects-api.service';
import { WorkspaceContextService } from '../../../../../core/services/workspace-context.service';
import { attachFirmware, clearFirmware, firmwareFor } from '../simulation/firmware/firmware-bus';
import { FirmwareMachine, type FirmwareFault } from '../simulation/firmware/firmware-machine';
import type { VirtualDevice } from '../models/virtual-device.model';
import { loadSketch, type CombinedSketch } from '../../sketch-sources';

/**
 * Loads the project's sketch and binds it to the boards on the canvas.
 *
 * The source of truth is the project's own files, the same ones the IDE edits —
 * not a copy held by the canvas. Pressing Start therefore runs what the user
 * last saved, which is the only behaviour that will not surprise them.
 *
 * Compilation happens per board rather than once, because each board resolves
 * sketch pin numbers against its own pin map: `digitalWrite(13, …)` is a header
 * pin on an Uno and GPIO13 on an ESP32.
 */

export interface BoardFirmwareState {
  readonly instanceId: string;
  readonly boardName: string;
  readonly fault: FirmwareFault | null;
}

@Injectable({ providedIn: 'root' })
export class FirmwareLoaderService {
  private readonly api = inject(ProjectsApiService);
  private readonly workspace = inject(WorkspaceContextService);
  /** Invalidates pending reads on Stop, navigation, or a newer Start. */
  private runId = 0;

  /** Per-board compile and run state, for the toolbar to report. */
  readonly boards = signal<readonly BoardFirmwareState[]>([]);
  /** Lines the running sketches have printed, newest last. */
  readonly serial = signal<readonly string[]>([]);
  /** Set when the project has no file a sketch could live in. */
  readonly loadError = signal<string | null>(null);

  /**
   * Compiles the project's sketch onto every placed board.
   *
   * Returns without attaching anything when the project has no source file: a
   * diagram of parts with no firmware is a legitimate thing to simulate, and the
   * electrical behaviour still works.
   */
  async start(
    projectId: string,
    boards: readonly { instanceId: string; definition: VirtualDevice }[],
  ): Promise<void> {
    this.stop();
    const runId = this.runId;
    // A run starts with an empty monitor; stopping leaves the last run on screen.
    this.serial.set([]);
    if (!boards.length) {
      this.loadError.set('ยังไม่มีบอร์ดบนแคนวาส จึงไม่มีตัวรันโค้ด');
      return;
    }

    const sketch = await this.loadSource(projectId, runId);
    if (runId !== this.runId || sketch === null) return;

    const states: BoardFirmwareState[] = [];
    for (const board of boards) {
      const compiled = FirmwareMachine.compile(board.definition, sketch.source, sketch.locate);
      if (compiled.machine) attachFirmware(board.instanceId, compiled.machine);
      states.push({
        instanceId: board.instanceId,
        boardName: board.definition.name,
        fault: compiled.fault,
      });
    }
    this.boards.set(states);
  }

  /** Drains what the running sketches printed. Called on each tick by the page. */
  pumpSerial(): void {
    const states = this.boards();
    const updated = states.map((board) => {
      const fault = firmwareFor(board.instanceId)?.fault ?? board.fault;
      return fault === board.fault ? board : { ...board, fault };
    });
    if (updated.some((board, index) => board !== states[index])) this.boards.set(updated);
    const machines = this.boards()
      .map((board) => firmwareFor(board.instanceId))
      .filter((machine): machine is FirmwareMachine => machine !== null);
    if (!machines.length) return;

    const incoming = machines.flatMap((machine) => machine.takeSerialOutput());
    if (!incoming.length) return;

    // Serial arrives as fragments, not lines: `print` then `println` is one line
    // in two calls, so the text is joined before it is split. What is already on
    // screen is joined back with the newlines that split it — joining lines with
    // nothing would weld every earlier line into one.
    const combined = [this.serial().join('\n'), ...incoming].join('');
    const lines = combined.split('\n');
    this.serial.set(lines.slice(-200));
  }

  /** Current fault on a board, refreshed from the machine rather than cached. */
  faultFor(instanceId: string): FirmwareFault | null {
    const state = this.boards().find((board) => board.instanceId === instanceId);
    if (state?.fault) return state.fault;
    return firmwareFor(instanceId)?.fault ?? null;
  }

  /**
   * Detaches every sketch, keeping what they printed.
   *
   * A monitor that empties itself the moment the simulation stops is useless for
   * reading the last thing a sketch said, which is usually why it was stopped.
   */
  stop(): void {
    this.runId++;
    clearFirmware();
    this.boards.set([]);
    this.loadError.set(null);
  }

  /** Empties the monitor on request. */
  clear(): void {
    this.serial.set([]);
  }

  /** Rate the running sketches opened the port at, 0 before any `Serial.begin`. */
  sketchBaud(): number {
    for (const board of this.boards()) {
      const baud = firmwareFor(board.instanceId)?.serialBaud ?? 0;
      if (baud > 0) return baud;
    }
    return 0;
  }

  /** Every file of the sketch, joined the way Arduino IDE builds it. */
  private async loadSource(projectId: string, runId: number): Promise<CombinedSketch | null> {
    const workspaceId = this.workspace.activeWorkspaceId();
    if (!workspaceId) {
      this.loadError.set('ยังไม่ได้เลือกเวิร์กสเปซ จึงโหลดโค้ดของโปรเจกต์ไม่ได้');
      return null;
    }

    try {
      const files = await firstValueFrom(this.api.listFiles(workspaceId, projectId));
      if (runId !== this.runId) return null;
      const sketch = await loadSketch(
        files.map((file) => file.path),
        async (path) =>
          (await firstValueFrom(this.api.readFile(workspaceId, projectId, path))).content,
      );
      if (runId !== this.runId) return null;
      if (!sketch) {
        this.loadError.set('โปรเจกต์นี้ยังไม่มีไฟล์ .ino หรือ .cpp ให้รัน');
        return null;
      }
      return sketch;
    } catch {
      if (runId !== this.runId) return null;
      // A failed read is not a reason to refuse the whole simulation — the
      // circuit still behaves, it just has no sketch driving it.
      this.loadError.set('โหลดไฟล์โค้ดไม่สำเร็จ ตัวจำลองจะทำงานเฉพาะส่วนวงจร');
      return null;
    }
  }
}

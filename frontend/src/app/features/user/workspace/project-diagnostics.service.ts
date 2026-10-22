import { Injector, Service, inject } from '@angular/core';

import { ProjectDiagnostics } from '../../../core/models/project-ai.model';
import { loadSketch } from './sketch-sources';
import { ProjectFilesClient } from './project-files.client';
import { ProjectCanvasService } from './virtual-device/services/project-canvas.service';

/**
 * What is wrong with the open project, as this browser can see it.
 *
 * The circuit checker and the firmware interpreter both live in the client, so the server
 * has no way to know that a sketch does not compile or that a module's GND is unwired.
 * This service runs those same checks on demand — without the simulator canvas being open —
 * so the assistant can be told about the fault the user is looking at.
 *
 * Everything is best effort. A project whose files or layout cannot be read produces fewer
 * findings, never an error: a chat message must not fail because diagnostics could not be
 * gathered.
 *
 * The heavy imports — the device catalog, the solver, the firmware parser — are loaded
 * dynamically. They belong to the simulator chunk, and pulling them into the IDE's chunk
 * would make every editor session download a catalog it may never use.
 */

const MAX_FINDINGS = 20;
const MAX_LINES = 40;
const MAX_LINE_LENGTH = 300;

export interface IdeOutput {
  /** Serial monitor tail, newest last. */
  readonly serial?: readonly string[];
  /** Firmware build log tail. */
  readonly build?: readonly string[];
  readonly buildState?: 'idle' | 'building' | 'success' | 'error';
}

@Service()
export class ProjectDiagnosticsService {
  private readonly canvas = inject(ProjectCanvasService);
  private readonly files = inject(ProjectFilesClient);
  private readonly injector = inject(Injector);

  async collect(projectId: string, ide: IdeOutput = {}): Promise<ProjectDiagnostics | undefined> {
    const [circuit, firmware, simulated] = await Promise.all([
      this.checkCircuit(projectId).catch(() => undefined),
      this.compileSketch(projectId).catch(() => undefined),
      this.simulatorSerial().catch(() => undefined),
    ]);

    // What the sketch printed in the simulator is the more specific evidence: it comes
    // from this project's own code. The hardware monitor is the fallback.
    const serial = simulated?.length ? simulated : ide.serial;

    const diagnostics: ProjectDiagnostics = {
      ...(circuit?.length ? { wiring: circuit } : {}),
      ...(firmware ? { firmware } : {}),
      ...(serial?.length ? { serial: tail(serial) } : {}),
      ...(ide.build?.length ? { build: tail(ide.build) } : {}),
      ...(ide.buildState ? { buildState: ide.buildState } : {}),
    };

    return Object.keys(diagnostics).length ? diagnostics : undefined;
  }

  /**
   * What the sketch printed the last time the simulator ran.
   *
   * The loader is a root service shared with the simulator page, so its output survives the
   * user switching back to the editor. It is resolved through the injector rather than
   * injected as a field to keep the firmware chunk out of the IDE's bundle.
   */
  private async simulatorSerial(): Promise<readonly string[]> {
    const { FirmwareLoaderService } =
      await import('./virtual-device/services/firmware-loader.service');
    return this.injector.get(FirmwareLoaderService).serial();
  }

  /** Runs the canvas wiring rules over the saved layout. */
  private async checkCircuit(projectId: string): Promise<ProjectDiagnostics['wiring']> {
    const [{ validateCircuit }, { deviceById }, components, connections] = await Promise.all([
      import('./virtual-device/simulation/wire-validation'),
      import('./virtual-device/devices/device-catalog'),
      this.canvas.load(projectId),
      this.canvas.loadConnections(projectId),
    ]);

    const placed = components.flatMap((component) => {
      const definition = deviceById(component.definitionId);
      return definition
        ? [
            {
              instanceId: component.id,
              definition,
              properties: component.state as Record<string, string | number | boolean>,
            },
          ]
        : [];
    });
    const known = new Set(placed.map((device) => device.instanceId));

    const wires = connections
      .filter((wire) => known.has(wire.from.componentId) && known.has(wire.to.componentId))
      .map((wire) => ({
        id: wire.id,
        start: { type: 'device' as const, deviceId: wire.from.componentId, pinId: wire.from.pinId },
        end: { type: 'device' as const, deviceId: wire.to.componentId, pinId: wire.to.pinId },
        waypoints: [],
        color: wire.color,
        kind: wire.kind,
      }));

    return validateCircuit({ devices: placed, connections: wires })
      .slice(0, MAX_FINDINGS)
      .map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        title: clamp(issue.title, 200),
        detail: clamp(issue.detail, 400),
      }));
  }

  /**
   * Compiles the project's sketch against its own board.
   *
   * Pin numbers resolve per board, so the compile needs the board that is actually placed;
   * without one there is nothing to compile against and the fault is left unreported.
   */
  private async compileSketch(projectId: string): Promise<ProjectDiagnostics['firmware']> {
    const paths = await this.files.list(projectId);
    const [{ deviceById }, { isBoardCategory }, { FirmwareMachine }, components, sketch] =
      await Promise.all([
        import('./virtual-device/devices/device-catalog'),
        import('./virtual-device/device-library.models'),
        import('./virtual-device/simulation/firmware/firmware-machine'),
        this.canvas.load(projectId),
        loadSketch(paths, async (path) => (await this.files.read(projectId, path)).content),
      ]);
    if (!sketch) return undefined;

    const board = components
      .map((component) => deviceById(component.definitionId))
      .find((definition) => definition && isBoardCategory(definition.catalog.categoryId));
    if (!board) return undefined;

    const compiled = FirmwareMachine.compile(board, sketch.source, sketch.locate);
    if (!compiled.fault) return undefined;

    return {
      phase: compiled.fault.phase,
      line: compiled.fault.line,
      message: clamp(compiled.fault.message, 400),
      file: compiled.fault.file ?? sketch.entry,
    };
  }
}

function tail(lines: readonly string[]): string[] {
  return lines.slice(-MAX_LINES).map((line) => clamp(line, MAX_LINE_LENGTH));
}

function clamp(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

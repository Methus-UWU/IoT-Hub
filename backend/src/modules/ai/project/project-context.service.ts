import { Injectable, Optional } from '@nestjs/common';

import { findDevice } from '../../projects/catalog/device-catalog';
import { CircuitState, findBoard } from '../../projects/pin-assignment';
import { ProjectCircuitService } from '../../projects/project-circuit.service';
import { ProjectFilesService } from '../../projects/project-files.service';
import { Project } from '../../projects/project.repository';
import { DashboardsService } from '../../dashboards/dashboards.service';
import type { DashboardBase } from './dashboard-draft';
import { describeOnboardLed } from './onboard-led';
import { DraftFile } from './project-draft';

/**
 * The project the assistant is working in, gathered before the model is asked anything.
 *
 * This is the answer to "which ESP32? which sensor?" — the user should never have to say.
 * It is also the security boundary the whole feature rests on: the context is built from
 * one project id, which the controller has already proved the caller may read, and there
 * is no path here that reaches a component, a wire, or a file outside it.
 *
 * Pin lists are summarised rather than dumped. A breadboard declares 882 holes; sending
 * them would crowd out the parts that matter and teach the model nothing, so a large part
 * is described by its shape and the model asks `get_device_pinout` if it needs the detail.
 */

/** Above this a part's pins are summarised instead of listed. */
const PIN_LIST_LIMIT = 40;

export interface ProjectContextFile {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface ProjectContext {
  readonly project: Project;
  readonly circuit: CircuitState;
  readonly files: readonly ProjectContextFile[];
  /** Content of every file, keyed by path, for the draft to patch against. */
  readonly fileContents: ReadonlyMap<string, DraftFile>;
  readonly activeFile: string | null;
  /** Absent when the dashboard could not be loaded; the turn then has no dashboard tools. */
  readonly dashboard?: DashboardBase;
}

@Injectable()
export class ProjectContextService {
  constructor(
    private readonly circuits: ProjectCircuitService,
    private readonly files: ProjectFilesService,
    @Optional() private readonly dashboards?: DashboardsService,
  ) {}

  /**
   * Loads everything one request may need, in one pass.
   *
   * File contents are loaded eagerly because a patch has to be made against the current
   * text — an assistant that answers from a listing alone is the one that replaces
   * `main.ino` wholesale and deletes the user's Wi-Fi setup.
   */
  async build(
    project: Project,
    activeFile: string | null,
  ): Promise<ProjectContext> {
    const [circuit, summaries, dashboard] = await Promise.all([
      this.circuits.load(project.id),
      this.files.list(project.id),
      // A dashboard that fails to load must not cost the user a wiring or code answer.
      this.dashboards?.get(project.id).catch(() => undefined),
    ]);

    const contents = await Promise.all(
      summaries.map(async (summary) => {
        const file = await this.files.read(project.id, summary.path);
        return [summary.path, { content: file.content, exists: true }] as const;
      }),
    );

    const requested = activeFile?.trim() || null;
    return {
      project,
      circuit,
      files: summaries.map((summary) => ({
        path: summary.path,
        sizeBytes: summary.sizeBytes,
      })),
      fileContents: new Map<string, DraftFile>(contents),
      // Only a file the project actually has may be called active; anything else would
      // put a filename the model then writes to into the prompt.
      activeFile:
        requested && summaries.some((s) => s.path === requested)
          ? requested
          : null,
      ...(dashboard ? { dashboard } : {}),
    };
  }

  /**
   * The context block prepended to every request, in the form the model reads best.
   *
   * Prose rather than JSON: this is describing a physical arrangement, and "DHT22 DATA →
   * ESP32 GPIO4" survives a model's attention better than a nested object. Ids appear only
   * where the model needs them to call a tool.
   */
  render(context: ProjectContext): string {
    const lines: string[] = [];
    const { circuit } = context;
    const board = findBoard(circuit);

    lines.push('# Current project');
    lines.push(`- id: ${context.project.id}`);
    lines.push(`- name: ${context.project.name}`);
    lines.push(`- framework: ${context.project.framework || 'unspecified'}`);
    lines.push(
      `- board: ${board ? `${labelWithModel(board.definitionId, board.label)} (component id ${board.id})` : 'none placed'}`,
    );
    const onboardLed = board ? describeOnboardLed(board.definitionId) : null;
    if (onboardLed) lines.push(`- ${onboardLed}`);
    if (!board && context.project.board) {
      lines.push(
        `- project board field: ${context.project.board} — no board component is on the canvas, so there is no pinout to wire against`,
      );
    }

    lines.push('');
    lines.push('# Components in this project');
    const peripherals = circuit.components.filter(
      (component) => component.id !== board?.id,
    );
    if (!peripherals.length) {
      lines.push('- none besides the board');
    }
    for (const component of peripherals) {
      const definition = findDevice(component.definitionId);
      if (!definition) {
        lines.push(
          `- ${component.label} (component id ${component.id}, definition ${component.definitionId}) — no pinout available; do not wire this part`,
        );
        continue;
      }

      const pins =
        definition.pins.length > PIN_LIST_LIMIT
          ? `${definition.pins.length} pins — call get_device_pinout for detail`
          : definition.pins.map((pin) => `${pin.name}[${pin.type}]`).join(' ');
      lines.push(
        `- ${component.label} (${definition.model}, component id ${component.id}, definition ${definition.id}) — pins: ${pins}`,
      );
    }

    lines.push('');
    lines.push('# Existing connections');
    if (!circuit.connections.length) {
      lines.push('- none');
    }
    const labels = new Map(
      circuit.components.map((component) => [component.id, component.label]),
    );
    for (const connection of circuit.connections) {
      lines.push(
        `- ${labels.get(connection.from.componentId) ?? connection.from.componentId}:${connection.from.pinId} -> ${
          labels.get(connection.to.componentId) ?? connection.to.componentId
        }:${connection.to.pinId} (${connection.kind})`,
      );
    }

    lines.push('');
    lines.push('# Source files');
    if (!context.files.length) {
      lines.push('- none');
    }
    for (const file of context.files) {
      const active =
        file.path === context.activeFile
          ? ' (active file, open in the editor)'
          : '';
      lines.push(`- ${file.path} · ${file.sizeBytes} bytes${active}`);
    }

    if (context.dashboard) {
      const { document, datastreams } = context.dashboard;
      lines.push('');
      lines.push('# Dashboard');
      lines.push(
        `- ${document.widgets.length} widgets; datastreams: ${
          datastreams.map((stream) => stream.key).join(', ') || 'none'
        } — call read_dashboard for detail`,
      );
    }

    return lines.join('\n');
  }
}

function labelWithModel(definitionId: string, label: string): string {
  const definition = findDevice(definitionId);
  if (!definition) return `${label} (${definitionId}, pinout unavailable)`;
  return definition.name === label
    ? definition.name
    : `${label} — ${definition.name}`;
}

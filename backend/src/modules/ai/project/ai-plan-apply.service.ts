import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import {
  ValidatedConnection,
  WiringError,
  validateConnection,
} from '../../projects/pin-assignment';
import { ProjectCircuitService } from '../../projects/project-circuit.service';
import { ProjectComponentsService } from '../../projects/project-components.service';
import { ProjectConnectionsService } from '../../projects/project-connections.service';
import { ProjectFilesService } from '../../projects/project-files.service';
import { Project } from '../../projects/project.repository';
import { isPlaceholderRef } from './project-draft';
import { resolveSettings } from '../../projects/catalog/device-catalog';
import { PlanActionDto } from './dto/project-ai.dto';
import { DashboardsService } from '../../dashboards/dashboards.service';
import { parseDatastreamTemplates } from '../../dashboards/datastream-rules';

/**
 * Applies a plan the user accepted.
 *
 * The plan arrives from the browser, which makes it untrusted input no matter that this
 * server produced it. So it is replayed rather than trusted: every wire is put back through
 * the assignment engine against *live* state, every component id is resolved inside this
 * project, and every file goes through the same save path as an editor autosave, with its
 * quotas and its path checks.
 *
 * Validation runs to completion before the first write. That ordering is what makes the
 * change atomic in the way that matters here — a plan that has gone stale (the user moved a
 * wire in another tab, deleted the sensor, edited the file) is refused whole, instead of
 * leaving code that names a pin the diagram no longer uses.
 *
 * A write can still fail after validation — a plan ceiling, a lost row — and there is no
 * cross-service transaction to lean on. Components and wires created before the failure are
 * removed again so the canvas is not left holding half a change. Files are the exception
 * and are written last, precisely because a file save cannot be undone without inventing a
 * revision the user never had.
 */

export interface ApplyResult {
  readonly componentsAdded: number;
  /** The parts this plan placed, so the client can lay them out beside the board. */
  readonly createdComponentIds: readonly string[];
  readonly connectionsAdded: number;
  readonly connectionsRemoved: number;
  readonly filesWritten: readonly string[];
  /** True when the plan replaced the project's dashboard. */
  readonly dashboardUpdated?: boolean;
}

@Injectable()
export class AiPlanApplyService {
  private readonly logger = new Logger(AiPlanApplyService.name);

  constructor(
    private readonly circuits: ProjectCircuitService,
    private readonly components: ProjectComponentsService,
    private readonly connections: ProjectConnectionsService,
    private readonly files: ProjectFilesService,
    @Optional() private readonly dashboards?: DashboardsService,
  ) {}

  async apply(
    userId: string,
    project: Project,
    actions: readonly PlanActionDto[],
  ): Promise<ApplyResult> {
    const state = await this.circuits.load(project.id);

    // Placeholder refs stand for components this plan creates. Resolving them here, before
    // any write, is what catches a wire that names a component nothing introduces.
    const pending = new Map<string, PlanActionDto>();
    for (const action of actions) {
      if (action.type !== 'add_device') continue;
      if (
        !action.ref ||
        !isPlaceholderRef(action.ref) ||
        !action.definitionId
      ) {
        throw stale('A staged device is missing its reference or definition');
      }
      pending.set(action.ref, action);
    }

    for (const action of actions) {
      if (action.type === 'connect') {
        if (!action.from || !action.to)
          throw stale('A staged wire is missing an endpoint');
        for (const endpoint of [action.from, action.to]) {
          if (isPlaceholderRef(endpoint.componentId)) {
            if (!pending.has(endpoint.componentId)) {
              throw stale(
                `Wire references ${endpoint.componentId}, which this plan does not create`,
              );
            }
            continue;
          }
          if (
            !state.components.some((item) => item.id === endpoint.componentId)
          ) {
            throw stale(
              'A component in this proposal is no longer in the project',
            );
          }
        }
        continue;
      }

      if (action.type === 'configure') {
        if (
          !action.componentId ||
          !state.components.some((item) => item.id === action.componentId)
        ) {
          throw stale(
            'A part this proposal would configure is no longer in the project',
          );
        }
        continue;
      }

      if (action.type === 'disconnect') {
        if (!action.connectionId) throw stale('A staged removal names no wire');
        if (
          !state.connections.some((item) => item.id === action.connectionId)
        ) {
          throw stale('A wire this proposal would remove is already gone');
        }
        continue;
      }

      if (
        action.type === 'write_file' &&
        (!action.path || action.content === undefined)
      ) {
        throw stale('A staged file change is missing its path or content');
      }

      if (action.type === 'set_dashboard') {
        if (!this.dashboards || !action.document) {
          throw stale('A staged dashboard change is missing its layout');
        }
        for (const reference of dashboardReferences(action)) {
          if (
            isPlaceholderRef(reference)
              ? !pending.has(reference)
              : !state.components.some((item) => item.id === reference)
          ) {
            throw stale(
              'A part this dashboard binds to is no longer in the project',
            );
          }
        }
      }
    }

    const createdComponentIds: string[] = [];
    const createdConnectionIds: string[] = [];
    let connectionsRemoved = 0;
    let dashboardUpdated = false;

    try {
      // Components first: a wire cannot reference a row that does not exist yet.
      const refToId = new Map<string, string>();
      for (const [ref, action] of pending) {
        const definitionId = action.definitionId as string;
        const created = await this.components.add(userId, project.id, {
          definitionId,
          ...(action.label ? { label: action.label } : {}),
          state: settingsOrStale(definitionId, action.settings),
        });
        refToId.set(ref, created.id);
        createdComponentIds.push(created.id);
      }

      // Settings on parts already in the project merge over what the user set.
      for (const action of actions) {
        if (action.type !== 'configure') continue;
        const componentId = action.componentId as string;
        const current = (await this.components.list(project.id)).find(
          (item) => item.id === componentId,
        );
        if (!current)
          throw stale('A part this proposal would configure is gone');
        await this.components.update(project.id, componentId, {
          state: {
            ...current.state,
            ...settingsOrStale(current.definitionId, action.settings),
          },
        });
      }

      // Removals before additions, so a rewire frees its pin before the new wire claims it.
      for (const action of actions) {
        if (action.type !== 'disconnect') continue;
        await this.connections.remove(
          project.id,
          action.connectionId as string,
        );
        connectionsRemoved++;
      }

      let live = await this.circuits.load(project.id);
      for (const action of actions) {
        if (action.type !== 'connect') continue;

        const from = {
          componentId:
            refToId.get(action.from!.componentId) ?? action.from!.componentId,
          pinId: action.from!.pinId,
        };
        const to = {
          componentId:
            refToId.get(action.to!.componentId) ?? action.to!.componentId,
          pinId: action.to!.pinId,
        };

        // The engine decides again, against the state this apply has produced so far. The
        // `kind` and `color` the client sent are ignored in favour of what it returns.
        let validated: ValidatedConnection;
        try {
          validated = validateConnection(live, from, to);
        } catch (error) {
          if (
            error instanceof WiringError &&
            error.code === 'CONNECTION_ALREADY_EXISTS'
          ) {
            continue;
          }
          throw error;
        }

        const created = await this.connections.add(userId, project.id, {
          from: validated.from,
          to: validated.to,
          color: validated.color,
          kind: validated.kind,
        });
        createdConnectionIds.push(created.id);

        live = {
          components: live.components,
          connections: [
            ...live.connections,
            {
              id: created.id,
              from: validated.from,
              to: validated.to,
              kind: validated.kind,
            },
          ],
        };
      }

      // The dashboard after the parts it binds to exist, and before files: it is one
      // transaction that can still fail, and a failure here undoes the canvas too.
      for (const action of actions) {
        if (action.type !== 'set_dashboard' || !this.dashboards) continue;
        const resolve = (id: string) => refToId.get(id) ?? id;
        const document = structuredClone(action.document) as {
          widgets?: { deviceId?: unknown }[];
        };
        for (const widget of document.widgets ?? []) {
          if (typeof widget.deviceId === 'string')
            widget.deviceId = resolve(widget.deviceId);
        }
        const references = new Map(
          (action.datastreams ?? []).map((raw) => {
            const record = raw as { key?: unknown; componentId?: unknown };
            return [record.key, record.componentId] as const;
          }),
        );
        const datastreams = parseDatastreamTemplates(action.datastreams).map(
          (stream) => {
            const componentId = references.get(stream.key);
            return {
              ...stream,
              componentId:
                typeof componentId === 'string' && componentId
                  ? resolve(componentId)
                  : null,
            };
          },
        );
        const current = await this.dashboards.get(project.id);
        const baseVersion = action.baseVersion ?? 0;
        // The dashboard changed since the plan was made: refuse rather than overwrite.
        if (current.version !== baseVersion) {
          throw stale('The dashboard changed after this proposal was made');
        }
        await this.dashboards.replace(
          project.id,
          document,
          datastreams,
          {
            templateId: current.templateId,
            templateVersion: current.templateVersion,
          },
          baseVersion === 0 ? null : baseVersion,
        );
        dashboardUpdated = true;
      }
    } catch (error) {
      await this.rollback(
        project.id,
        createdConnectionIds,
        createdComponentIds,
      );
      if (error instanceof WiringError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    // Files last. They are the only part of a plan that cannot be rolled back, so nothing
    // that might still fail runs after them.
    const filesWritten: string[] = [];
    for (const action of actions) {
      if (action.type !== 'write_file') continue;

      const path = action.path as string;
      const current = await this.files.read(project.id, path).catch(() => null);

      await this.files.save(project.id, {
        path,
        content: action.content as string,
        ...(current ? { expectedVersion: current.version } : {}),
      });
      filesWritten.push(path);
    }

    return {
      componentsAdded: createdComponentIds.length,
      createdComponentIds,
      connectionsAdded: createdConnectionIds.length,
      connectionsRemoved,
      filesWritten,
      dashboardUpdated,
    };
  }

  /**
   * Undoes the canvas half of a partly-applied plan.
   *
   * Best effort by necessity: if a delete fails there is nothing better to try, and losing
   * the original error would be worse than leaving one extra row. Each failure is logged
   * with the row that survived so it can be found.
   */
  private async rollback(
    projectId: string,
    connectionIds: readonly string[],
    componentIds: readonly string[],
  ): Promise<void> {
    for (const id of [...connectionIds].reverse()) {
      await this.connections.remove(projectId, id).catch((error: unknown) => {
        this.logger.error(
          `Rollback left connection ${id} in project ${projectId}: ${String(error)}`,
        );
      });
    }
    for (const id of [...componentIds].reverse()) {
      await this.components.remove(projectId, id).catch((error: unknown) => {
        this.logger.error(
          `Rollback left component ${id} in project ${projectId}: ${String(error)}`,
        );
      });
    }
  }
}

/** Component ids or placeholders a staged dashboard names, from its widgets and datastreams. */
function dashboardReferences(action: PlanActionDto): string[] {
  const widgets = (action.document?.['widgets'] ?? []) as {
    deviceId?: unknown;
  }[];
  const streams = (action.datastreams ?? []) as { componentId?: unknown }[];
  return [
    ...widgets.map((widget) => widget.deviceId),
    ...streams.map((stream) => stream.componentId),
  ].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

function stale(message: string): ConflictException {
  return new ConflictException({
    code: 'AI_PLAN_STALE',
    message: `${message}. Ask again so the assistant can read the current project.`,
  });
}

/**
 * The plan's settings, re-checked against the catalog. The plan comes back from the
 * browser, so a value the part does not accept is refused here, not stored.
 */
function settingsOrStale(
  definitionId: string,
  requested: unknown,
): Record<string, string | number | boolean> {
  const result = resolveSettings(definitionId, requested);
  if (!result.ok) throw stale(result.reason);
  return { ...result.settings };
}

import { Injectable } from '@nestjs/common';

import {
  CircuitState,
  PinoutEntry,
  findBoard,
  pinoutOf,
  resolveComponent,
} from './pin-assignment';
import {
  ProjectComponentRepository,
  ProjectConnectionRepository,
} from './project.repository';

/**
 * Reads a project's circuit as one snapshot.
 *
 * The wiring rules in `pin-assignment.ts` are pure functions over a `CircuitState`; this
 * is the only place that state is built from the database. Keeping the load separate is
 * what lets the same rules judge a proposed change that has not been written yet.
 *
 * Authorization is the caller's job. Every route that reaches this has already resolved
 * workspace membership and confirmed the project lives in that workspace, so a project id
 * arriving here is one the caller may read.
 */
@Injectable()
export class ProjectCircuitService {
  constructor(
    private readonly components: ProjectComponentRepository,
    private readonly connections: ProjectConnectionRepository,
  ) {}

  async load(projectId: string): Promise<CircuitState> {
    const [components, connections] = await Promise.all([
      this.components.list(projectId),
      this.connections.list(projectId),
    ]);

    return {
      components: components.map((component) => ({
        id: component.id,
        definitionId: component.definitionId,
        label: component.label || component.definitionId,
      })),
      connections: connections.map((connection) => ({
        id: connection.id,
        from: connection.from,
        to: connection.to,
        kind: connection.kind,
      })),
    };
  }

  /** The board a project's firmware runs on, or null when it holds none. */
  board(state: CircuitState) {
    return findBoard(state);
  }

  pinout(state: CircuitState, componentId: string): readonly PinoutEntry[] {
    return pinoutOf(state, resolveComponent(state, componentId));
  }
}

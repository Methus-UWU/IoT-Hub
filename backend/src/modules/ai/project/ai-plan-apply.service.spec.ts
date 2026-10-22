import { ConflictException } from '@nestjs/common';

import {
  CircuitComponent,
  CircuitConnection,
} from '../../projects/pin-assignment';
import { ProjectCircuitService } from '../../projects/project-circuit.service';
import { ProjectComponentsService } from '../../projects/project-components.service';
import { ProjectConnectionsService } from '../../projects/project-connections.service';
import { ProjectFilesService } from '../../projects/project-files.service';
import { Project } from '../../projects/project.repository';
import { AiPlanApplyService } from './ai-plan-apply.service';
import { PlanActionDto } from './dto/project-ai.dto';

const BOARD = 'component-board';
const DHT = 'component-dht';

const PROJECT: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'test',
  slug: 'test',
  description: '',
  board: 'ESP32 DevKit V1',
  framework: 'Arduino C++',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * A stand-in for the project's stored circuit and files.
 *
 * The apply service is where a proposal meets live state, so what these fakes have to
 * model faithfully is the *state changing underneath a plan* — a component deleted, a
 * write refused. Everything else is a pass-through.
 */
class Fakes {
  components: CircuitComponent[] = [
    { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    { id: DHT, definitionId: 'dht22', label: 'DHT22' },
  ];
  connections: CircuitConnection[] = [];
  files = new Map<string, { content: string; version: number }>();
  addComponentFails = false;
  addConnectionFailsAfter = Number.POSITIVE_INFINITY;
  removedComponents: string[] = [];
  removedConnections: string[] = [];
  private sequence = 0;

  circuits = {
    load: () =>
      Promise.resolve({
        components: [...this.components],
        connections: [...this.connections],
      }),
  } as unknown as ProjectCircuitService;

  componentsService = {
    add: (
      _userId: string,
      _projectId: string,
      input: { definitionId: string; label?: string },
    ) => {
      if (this.addComponentFails)
        return Promise.reject(new Error('limit reached'));
      const id = `component-new-${++this.sequence}`;
      this.components.push({
        id,
        definitionId: input.definitionId,
        label: input.label ?? input.definitionId,
      });
      return Promise.resolve({ id });
    },
    remove: (_projectId: string, componentId: string) => {
      this.removedComponents.push(componentId);
      this.components = this.components.filter(
        (item) => item.id !== componentId,
      );
      return Promise.resolve();
    },
  } as unknown as ProjectComponentsService;

  connectionsService = {
    add: (
      _userId: string,
      _projectId: string,
      input: {
        from: { componentId: string; pinId: string };
        to: { componentId: string; pinId: string };
        kind: 'power' | 'ground' | 'signal';
        color: string;
      },
    ) => {
      if (this.connections.length >= this.addConnectionFailsAfter) {
        return Promise.reject(new Error('connection limit reached'));
      }
      const id = `wire-new-${++this.sequence}`;
      this.connections.push({
        id,
        from: input.from,
        to: input.to,
        kind: input.kind,
      });
      return Promise.resolve({ id, ...input });
    },
    remove: (_projectId: string, connectionId: string) => {
      this.removedConnections.push(connectionId);
      this.connections = this.connections.filter(
        (item) => item.id !== connectionId,
      );
      return Promise.resolve();
    },
  } as unknown as ProjectConnectionsService;

  filesService = {
    read: (_projectId: string, path: string) => {
      const file = this.files.get(path);
      return file
        ? Promise.resolve({ path, ...file })
        : Promise.reject(new Error('not found'));
    },
    save: (
      _projectId: string,
      request: { path: string; content: string; expectedVersion?: number },
    ) => {
      const existing = this.files.get(request.path);
      this.files.set(request.path, {
        content: request.content,
        version: (existing?.version ?? 0) + 1,
      });
      return Promise.resolve({ path: request.path });
    },
  } as unknown as ProjectFilesService;

  service(): AiPlanApplyService {
    return new AiPlanApplyService(
      this.circuits,
      this.componentsService,
      this.connectionsService,
      this.filesService,
    );
  }
}

describe('AiPlanApplyService', () => {
  it('creates the staged part and resolves the wire that references it', async () => {
    const fakes = new Fakes();
    fakes.components = [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    ];

    const actions: PlanActionDto[] = [
      {
        type: 'add_device',
        ref: 'new:1',
        definitionId: 'dht22',
        label: 'DHT22',
      },
      {
        type: 'connect',
        from: { componentId: 'new:1', pinId: 'DATA' },
        to: { componentId: BOARD, pinId: 'GPIO4' },
        kind: 'signal',
      },
    ];

    const result = await fakes.service().apply('user-1', PROJECT, actions);

    expect(result).toMatchObject({ componentsAdded: 1, connectionsAdded: 1 });
    expect(fakes.connections[0].from.componentId).toBe('component-new-1');
  });

  it('re-derives the wire kind rather than trusting the client', async () => {
    const fakes = new Fakes();

    // A tampered plan claiming a ground wire between a data pin and a GPIO.
    await fakes.service().apply('user-1', PROJECT, [
      {
        type: 'connect',
        from: { componentId: DHT, pinId: 'DATA' },
        to: { componentId: BOARD, pinId: 'GPIO4' },
        kind: 'ground',
        color: '#000000',
      },
    ]);

    expect(fakes.connections[0].kind).toBe('signal');
  });

  it('canonicalises a pin named by its silkscreen alias', async () => {
    const fakes = new Fakes();

    await fakes.service().apply('user-1', PROJECT, [
      {
        type: 'connect',
        from: { componentId: DHT, pinId: 'DATA' },
        to: { componentId: BOARD, pinId: 'D4' },
        kind: 'signal',
      },
    ]);

    expect(fakes.connections[0].to.pinId).toBe('GPIO4');
  });

  it('refuses the whole plan when a component it names is gone', async () => {
    const fakes = new Fakes();
    fakes.components = [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    ];

    await expect(
      fakes.service().apply('user-1', PROJECT, [
        {
          type: 'connect',
          from: { componentId: DHT, pinId: 'DATA' },
          to: { componentId: BOARD, pinId: 'GPIO4' },
          kind: 'signal',
        },
      ]),
    ).rejects.toThrow(ConflictException);

    expect(fakes.connections).toHaveLength(0);
  });

  it('refuses a wire naming a placeholder no action creates', async () => {
    const fakes = new Fakes();

    await expect(
      fakes.service().apply('user-1', PROJECT, [
        {
          type: 'connect',
          from: { componentId: 'new:9', pinId: 'DATA' },
          to: { componentId: BOARD, pinId: 'GPIO4' },
          kind: 'signal',
        },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to remove a wire that is already gone, and writes nothing', async () => {
    const fakes = new Fakes();

    await expect(
      fakes.service().apply('user-1', PROJECT, [
        { type: 'disconnect', connectionId: 'wire-vanished', summary: 'x' },
        { type: 'write_file', path: 'main.ino', content: 'void setup() {}' },
      ]),
    ).rejects.toThrow(ConflictException);

    expect(fakes.files.size).toBe(0);
  });

  it('undoes the parts it created when a later write fails', async () => {
    const fakes = new Fakes();
    fakes.components = [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    ];
    fakes.addConnectionFailsAfter = 1;

    await expect(
      fakes.service().apply('user-1', PROJECT, [
        {
          type: 'add_device',
          ref: 'new:1',
          definitionId: 'dht22',
          label: 'DHT22',
        },
        {
          type: 'connect',
          from: { componentId: 'new:1', pinId: 'DATA' },
          to: { componentId: BOARD, pinId: 'GPIO4' },
          kind: 'signal',
        },
        {
          type: 'connect',
          from: { componentId: 'new:1', pinId: 'VCC' },
          to: { componentId: BOARD, pinId: '3V3' },
          kind: 'power',
        },
        { type: 'write_file', path: 'main.ino', content: 'void setup() {}' },
      ]),
    ).rejects.toThrow('connection limit reached');

    expect(fakes.removedComponents).toEqual(['component-new-1']);
    expect(fakes.connections).toHaveLength(0);
    // The file is never touched: it is written only after the canvas half succeeded.
    expect(fakes.files.size).toBe(0);
  });

  it('writes files with the version it just read, so a stale plan cannot blind-write', async () => {
    const fakes = new Fakes();
    fakes.files.set('main.ino', { content: 'old', version: 7 });
    const save = jest.spyOn(fakes.filesService, 'save');

    await fakes.service().apply('user-1', PROJECT, [
      {
        type: 'write_file',
        path: 'main.ino',
        content: 'new',
        created: false,
      },
    ]);

    expect(save).toHaveBeenCalledWith(
      PROJECT.id,
      expect.objectContaining({ expectedVersion: 7 }),
    );
  });

  it('creates a file the project does not have without stating a version', async () => {
    const fakes = new Fakes();
    const save = jest.spyOn(fakes.filesService, 'save');

    await fakes.service().apply('user-1', PROJECT, [
      {
        type: 'write_file',
        path: 'sensors.h',
        content: '#pragma once',
        created: true,
      },
    ]);

    expect(save).toHaveBeenCalledWith(PROJECT.id, {
      path: 'sensors.h',
      content: '#pragma once',
    });
  });

  it('skips a wire someone else already drew instead of failing the plan', async () => {
    const fakes = new Fakes();
    fakes.connections = [
      {
        id: 'wire-1',
        from: { componentId: DHT, pinId: 'DATA' },
        to: { componentId: BOARD, pinId: 'GPIO4' },
        kind: 'signal',
      },
    ];

    const result = await fakes.service().apply('user-1', PROJECT, [
      {
        type: 'connect',
        from: { componentId: DHT, pinId: 'DATA' },
        to: { componentId: BOARD, pinId: 'GPIO4' },
        kind: 'signal',
      },
    ]);

    expect(result.connectionsAdded).toBe(0);
  });
});

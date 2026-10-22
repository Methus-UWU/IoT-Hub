import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { EntitlementService } from '../billing/entitlement.service';
import { LIMIT_KEYS } from '../billing/entitlement';
import { CREATABLE_BOARD_DEFINITIONS } from './board-catalog';
import { findDevice } from './catalog/device-catalog';
import { CreateProjectDto } from './dto/project.dto';
import { ProjectComponentsService } from './project-components.service';
import {
  CreateComponentInput,
  CreateFileInput,
  CreateProjectInput,
  ProjectComponentRepository,
  ProjectRepository,
} from './project.repository';
import { ProjectsService } from './projects.service';

describe('Project creation with catalog devices', () => {
  const boardId = 'esp32-devkit-v1';
  const base = { name: 'Room monitor', boardId };
  const plan = {
    code: 'free',
    name: 'Free',
    limits: {
      [LIMIT_KEYS.maxProjects]: 3,
      [LIMIT_KEYS.maxComponentsPerProject]: 3,
    },
  };
  const findPlanForUser = jest.fn();
  const usageForUser = jest.fn();
  const createProjectWithBoard = jest.fn();
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    findPlanForUser.mockResolvedValue(plan);
    usageForUser.mockResolvedValue({ projectCount: 0 });
    createProjectWithBoard.mockImplementation(
      (
        project: CreateProjectInput,
        board: CreateComponentInput,
        devices: CreateComponentInput[],
      ) =>
        Promise.resolve({
          project: { ...project, id: 'created-project' },
          components: [board, ...devices].map((component, index) => ({
            ...component,
            id: `component-${index}`,
          })),
        }),
    );
    const entitlements = new EntitlementService({
      findPlanForUser,
      usageForUser,
      buildMillisSince: jest.fn().mockResolvedValue(0),
    });
    const projects = {
      slugExists: jest.fn().mockResolvedValue(false),
    } as unknown as ProjectRepository;
    const components = {
      createProjectWithBoard,
    } as unknown as ProjectComponentRepository;
    service = new ProjectsService(
      projects,
      components,
      new ProjectComponentsService(components, entitlements),
      entitlements,
    );
  });

  it('commits a board and the selected real peripherals through one repository operation', async () => {
    const result = await service.create('user', 'workspace', {
      ...base,
      deviceIds: ['dht22', 'led'],
    });
    expect(
      result.components.map((component) => component.definitionId),
    ).toEqual([boardId, 'dht22', 'led']);
    expect(
      new Set(
        result.components.map((component) => `${component.x}:${component.y}`),
      ).size,
    ).toBe(3);
    expect(createProjectWithBoard).toHaveBeenCalledTimes(1);
    expect(result.framework).toBe('PlatformIO');
  });

  it('writes an Arduino IDE sketch, and no PlatformIO config, for Arduino C++', async () => {
    const result = await service.create('user', 'workspace', {
      ...base,
      framework: 'Arduino C++',
    });
    expect(result.framework).toBe('Arduino C++');
    const [call] = createProjectWithBoard.mock.calls as [
      unknown,
      unknown,
      unknown,
      CreateFileInput[],
    ][];
    expect(call[3].map((file) => file.path)).toEqual(['main.ino']);
    expect(call[3][0].content).toContain('void setup()');
  });

  it('commits a PlatformIO config and sketch for the board in the same operation', async () => {
    await service.create('user', 'workspace', {
      ...base,
      deviceIds: ['dht22', 'dht22'],
    });
    const [call] = createProjectWithBoard.mock.calls as [
      unknown,
      unknown,
      unknown,
      CreateFileInput[],
    ][];
    const files = call[3];
    expect(files.map((file) => file.path)).toEqual([
      'platformio.ini',
      'src/main.cpp',
    ]);
    const [config, sketch] = files;
    expect(config.content).toContain(`[env:${boardId}]`);
    expect(config.content).toContain('platform = espressif32');
    expect(config.content).toContain('board = esp32doit-devkit-v1');
    expect(config.content).toContain('framework = arduino');
    // One entry per library, however many parts share it.
    expect(config.content.match(/adafruit\/DHT sensor library/g)).toHaveLength(
      1,
    );
    expect(sketch.content).toContain('#include <Arduino.h>');
    expect(sketch.sizeBytes).toBe(Buffer.byteLength(sketch.content));
    expect(sketch.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('allows starting with the board alone', async () => {
    const result = await service.create('user', 'workspace', base);
    expect(result.components).toHaveLength(1);
  });

  it('creates repeated peripherals when a quantity greater than one is selected', async () => {
    const result = await service.create('user', 'workspace', {
      ...base,
      deviceIds: ['dht22', 'dht22'],
    });
    expect(
      result.components.map((component) => component.definitionId),
    ).toEqual([boardId, 'dht22', 'dht22']);
  });

  it.each(['unknown-device', 'arduino-uno-r3'])(
    'rejects invalid peripheral %s before writing',
    async (id) => {
      await expect(
        service.create('user', 'workspace', { ...base, deviceIds: [id] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createProjectWithBoard).not.toHaveBeenCalled();
    },
  );

  it('counts the board toward the complete initial component quota', async () => {
    await expect(
      service.create('user', 'workspace', {
        ...base,
        deviceIds: ['dht22', 'led', 'resistor'],
      }),
    ).rejects.toMatchObject({
      response: { code: 'COMPONENT_LIMIT_REACHED', limit: 3 },
    });
    expect(createProjectWithBoard).not.toHaveBeenCalled();
  });

  it('enforces the project quota before writing any component', async () => {
    usageForUser.mockResolvedValueOnce({ projectCount: 3 });
    await expect(
      service.create('user', 'workspace', base),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createProjectWithBoard).not.toHaveBeenCalled();
  });

  it('offers only boards with an actual catalog pinout and rejects unsupported new boards', async () => {
    expect(CREATABLE_BOARD_DEFINITIONS.length).toBeGreaterThan(0);
    for (const board of CREATABLE_BOARD_DEFINITIONS) {
      expect(findDevice(board.id)?.isBoard).toBe(true);
      expect(findDevice(board.id)?.pins.length).toBeGreaterThan(0);
    }
    await expect(
      service.create('user', 'workspace', { ...base, boardId: 'pico-w' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createProjectWithBoard).not.toHaveBeenCalled();
  });

  it.each([
    { ...base, name: '   ' },
    { ...base, framework: 'MicroPython' },
  ])('rejects invalid setup %j', async (input) => {
    await expect(
      service.create('user', 'workspace', input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createProjectWithBoard).not.toHaveBeenCalled();
  });
});

describe('CreateProjectDto validation', () => {
  const base = { name: 'Room monitor', boardId: 'esp32-devkit-v1' };
  it.each([
    { deviceIds: [42] },
    { deviceIds: ['../../outside'] },
    { deviceIds: Array.from({ length: 50 }, (_, index) => `device-${index}`) },
    { name: '  ' },
    { name: 'x'.repeat(81) },
  ])('rejects malformed or oversized input %j', async (input) => {
    const dto = plainToInstance(CreateProjectDto, { ...base, ...input });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('accepts a bounded optional peripheral list and trims the name', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...base,
      name: ' Room monitor ',
      deviceIds: ['dht22', 'dht22'],
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Room monitor');
  });
});

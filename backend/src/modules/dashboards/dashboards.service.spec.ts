import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { Project } from '../projects/project.repository';
import {
  DashboardDocumentError,
  parseDashboardDocument,
} from './dashboard-document';
import { DashboardTemplatesService } from './dashboard-templates.service';
import { DashboardsService } from './dashboards.service';
import {
  FakeDashboardRepository,
  FakeTemplateRepository,
  fakeComponents,
} from './dashboards.fake';

const WORKSPACE = 'workspace-1';
const PROJECT = 'project-1';
const OTHER = 'project-2';

function widget(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'gauge',
    title: id,
    datasource: '',
    deviceId: '',
    layouts: {
      desktop: { x: 0, y: 0, cols: 3, rows: 3 },
      tablet: { x: 0, y: 0, cols: 3, rows: 3 },
      mobile: { x: 0, y: 0, cols: 4, rows: 3 },
    },
    ...overrides,
  };
}

function project(id: string, board = 'ESP32 DevKit V1'): Project {
  return {
    id,
    workspaceId: WORKSPACE,
    name: id,
    slug: id,
    description: '',
    board,
    framework: 'Arduino',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const temperature = {
  key: 'temperature',
  name: 'Temperature',
  dataType: 'number' as const,
  unit: '°C',
  min: -40,
  max: 80,
  source: 'temperature',
  componentId: null,
};

function setup() {
  const repository = new FakeDashboardRepository();
  const components = fakeComponents({
    [PROJECT]: [
      { id: 'board-1', definitionId: 'esp32-devkit-v1' },
      { id: 'dht-1', definitionId: 'dht22' },
    ],
    [OTHER]: [{ id: 'uno-1', definitionId: 'arduino-uno-r3' }],
  });
  const dashboards = new DashboardsService(repository, components);
  const templates = new DashboardTemplatesService(
    new FakeTemplateRepository(),
    dashboards,
    components,
  );
  return { repository, dashboards, templates };
}

describe('parseDashboardDocument', () => {
  it('rebuilds a document and drops what it does not know', () => {
    const document = parseDashboardDocument({
      name: 'Greenhouse',
      widgets: [widget('a', { extra: 'dropped', settings: { accent: 'red' } })],
      injected: true,
    });
    expect(document).not.toHaveProperty('injected');
    expect(document.widgets[0]).not.toHaveProperty('extra');
    expect(document.widgets[0].settings.accent).toBe('#545454');
  });

  it('refuses unknown widget types and duplicate ids', () => {
    expect(() =>
      parseDashboardDocument({ widgets: [widget('a', { type: 'script' })] }),
    ).toThrow(DashboardDocumentError);
    expect(() =>
      parseDashboardDocument({ widgets: [widget('a'), widget('a')] }),
    ).toThrow(/used twice/);
  });

  it('keeps widgets on the grid and never overlapping', () => {
    const document = parseDashboardDocument({
      widgets: [
        widget('a'),
        widget('b'),
        widget('c', {
          layouts: { desktop: { x: 50, y: -3, cols: 99, rows: 99 } },
        }),
      ],
    });
    const [a, b, c] = document.widgets;
    expect(b.layouts.desktop.y).toBe(
      a.layouts.desktop.y + a.layouts.desktop.rows,
    );
    // Clamped to the gauge's maximum size and inside 12 columns.
    expect(c.layouts.desktop.cols).toBe(6);
    expect(c.layouts.desktop.x + c.layouts.desktop.cols).toBeLessThanOrEqual(
      12,
    );
    expect(c.layouts.mobile.cols).toBeLessThanOrEqual(4);
  });
});

describe('DashboardsService', () => {
  it('creates once, then updates only at the version it read', async () => {
    const { dashboards } = setup();
    expect((await dashboards.get(PROJECT)).version).toBe(0);

    const created = await dashboards.save(PROJECT, { widgets: [widget('a')] });
    expect(created.version).toBe(1);
    await expect(dashboards.save(PROJECT, { widgets: [] })).rejects.toThrow(
      ConflictException,
    );

    const updated = await dashboards.save(PROJECT, { widgets: [] }, 1);
    expect(updated.version).toBe(2);
    await expect(
      dashboards.save(PROJECT, { widgets: [] }, 1),
    ).rejects.toMatchObject({
      response: { code: 'DASHBOARD_VERSION_CONFLICT', currentVersion: 2 },
    });
  });

  it('refuses a widget bound to a datastream or a part the project lacks', async () => {
    const { dashboards } = setup();
    await expect(
      dashboards.save(PROJECT, {
        widgets: [widget('a', { datasource: 'humidity' })],
      }),
    ).rejects.toMatchObject({
      response: { code: 'DASHBOARD_UNKNOWN_DATASTREAM' },
    });
    await expect(
      dashboards.save(PROJECT, {
        widgets: [widget('a', { deviceId: 'uno-1' })],
      }),
    ).rejects.toMatchObject({ response: { code: 'DASHBOARD_UNKNOWN_DEVICE' } });

    await dashboards.createDatastream(PROJECT, {
      ...temperature,
      componentId: 'dht-1',
    });
    const saved = await dashboards.save(PROJECT, {
      widgets: [widget('a', { datasource: 'temperature', deviceId: 'dht-1' })],
    });
    expect(saved.document.widgets[0].datasource).toBe('temperature');
  });

  it('keeps datastream keys unique and refuses to remove one a widget reads', async () => {
    const { dashboards } = setup();
    const stream = await dashboards.createDatastream(PROJECT, temperature);
    await expect(
      dashboards.createDatastream(PROJECT, temperature),
    ).rejects.toMatchObject({
      response: { code: 'DATASTREAM_KEY_TAKEN' },
    });
    await expect(
      dashboards.createDatastream(PROJECT, {
        ...temperature,
        key: 'x',
        componentId: 'uno-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    await dashboards.save(PROJECT, {
      widgets: [widget('a', { datasource: 'temperature' })],
    });
    await expect(
      dashboards.deleteDatastream(PROJECT, stream.id),
    ).rejects.toMatchObject({
      response: { code: 'DATASTREAM_IN_USE' },
    });
    await expect(dashboards.deleteDatastream(OTHER, stream.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('DashboardTemplatesService', () => {
  it('reuses one template on several projects without sharing their edits', async () => {
    const { dashboards, templates } = setup();
    await dashboards.createDatastream(PROJECT, {
      ...temperature,
      componentId: 'dht-1',
    });
    await dashboards.save(PROJECT, {
      widgets: [widget('a', { datasource: 'temperature', deviceId: 'dht-1' })],
    });
    const template = await templates.createFromProject(
      WORKSPACE,
      'alice',
      project(PROJECT),
      {
        name: 'Smart Home Monitor',
        visibility: 'workspace',
      },
    );
    expect(template.boardId).toBe('esp32-devkit-v1');

    const applied = await templates.apply(
      WORKSPACE,
      'bob',
      'editor',
      template.id,
      project(OTHER, 'Arduino Uno'),
      { expectedVersion: null },
    );
    // The datastream comes along; the other project's part does not.
    expect(applied.dashboard.datastreams.map((stream) => stream.key)).toEqual([
      'temperature',
    ]);
    expect(applied.dashboard.document.widgets[0].deviceId).toBe('');
    expect(applied.dashboard.templateId).toBe(template.id);
    expect(applied.warnings[0]).toMatch(/arduino-uno-r3/);

    // Rearranging the copy leaves the template as it was.
    await dashboards.save(OTHER, { widgets: [] }, applied.dashboard.version);
    const detail = await templates.get(WORKSPACE, 'bob', 'editor', template.id);
    expect(detail.document.widgets).toHaveLength(1);
  });

  it('versions a template and applies an older version on request', async () => {
    const { dashboards, templates } = setup();
    await dashboards.save(PROJECT, { widgets: [widget('a')] });
    const template = await templates.createFromProject(
      WORKSPACE,
      'alice',
      project(PROJECT),
      {
        name: 'Monitor',
      },
    );
    await dashboards.save(PROJECT, { widgets: [widget('a'), widget('b')] }, 1);
    const next = await templates.addVersionFromProject(
      WORKSPACE,
      'alice',
      'editor',
      template.id,
      project(PROJECT),
    );
    expect(next.latestVersion).toBe(2);

    const old = await templates.apply(
      WORKSPACE,
      'alice',
      'editor',
      template.id,
      project(OTHER),
      {
        version: 1,
        expectedVersion: null,
      },
    );
    expect(old.dashboard.document.widgets).toHaveLength(1);
    expect(old.dashboard.templateVersion).toBe(1);
  });

  it('hides private templates and lets only the creator or an admin change one', async () => {
    const { dashboards, templates } = setup();
    await dashboards.save(PROJECT, { widgets: [widget('a')] });
    const mine = await templates.createFromProject(
      WORKSPACE,
      'alice',
      project(PROJECT),
      {
        name: 'Private',
      },
    );
    expect(await templates.list(WORKSPACE, 'bob')).toHaveLength(0);
    await expect(
      templates.get(WORKSPACE, 'bob', 'admin', mine.id),
    ).rejects.toThrow(NotFoundException);

    const shared = await templates.updateMetadata(
      WORKSPACE,
      'alice',
      'editor',
      mine.id,
      {
        visibility: 'workspace',
      },
    );
    expect(shared.visibility).toBe('workspace');
    await expect(
      templates.delete(WORKSPACE, 'bob', 'editor', mine.id),
    ).rejects.toThrow(ForbiddenException);

    const copy = await templates.duplicate(WORKSPACE, 'bob', 'editor', mine.id);
    expect(copy.visibility).toBe('private');
    expect(copy.createdBy).toBe('bob');
    await templates.delete(WORKSPACE, 'carol', 'admin', mine.id);
    expect(await templates.list(WORKSPACE, 'alice')).toHaveLength(0);
  });

  it('refuses to save an empty dashboard as a template', async () => {
    const { templates } = setup();
    await expect(
      templates.createFromProject(WORKSPACE, 'alice', project(PROJECT), {
        name: 'Empty',
      }),
    ).rejects.toMatchObject({ response: { code: 'DASHBOARD_EMPTY' } });
  });
});

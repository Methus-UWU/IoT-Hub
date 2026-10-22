import { ConflictException } from '@nestjs/common';

import { emptyDashboard } from '../../dashboards/dashboard-document';
import { DashboardsService } from '../../dashboards/dashboards.service';
import { FakeDashboardRepository } from '../../dashboards/dashboards.fake';
import type { CircuitComponent } from '../../projects/pin-assignment';
import type { ProjectCircuitService } from '../../projects/project-circuit.service';
import type { ProjectComponentsService } from '../../projects/project-components.service';
import type { ProjectConnectionsService } from '../../projects/project-connections.service';
import type { ProjectFilesService } from '../../projects/project-files.service';
import type { Project } from '../../projects/project.repository';
import { assertPlanIsCoherent, previewOf } from './ai-plan';
import { AiPlanApplyService } from './ai-plan-apply.service';
import { executeToolCall } from './ai-tool-executor';
import { PlanActionDto } from './dto/project-ai.dto';
import { ProjectDraft } from './project-draft';

const BOARD = 'component-board';
const DHT = 'component-dht';

const PROJECT = { id: 'project-1', workspaceId: 'workspace-1' } as Project;

function draft(): ProjectDraft {
  const result = new ProjectDraft(
    {
      components: [
        { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
        { id: DHT, definitionId: 'dht22', label: 'DHT22' },
      ],
      connections: [],
    },
    new Map(),
  );
  result.attachDashboard({
    version: 0,
    document: emptyDashboard(),
    datastreams: [],
  });
  return result;
}

function call(
  target: ProjectDraft,
  name: string,
  args: Record<string, unknown> = {},
) {
  return executeToolCall(target, {
    id: name,
    name,
    rawArguments: JSON.stringify(args),
  });
}

describe('assistant dashboard tools', () => {
  it('binds widgets only to datastreams from parts the project has', () => {
    const target = draft();
    expect(
      call(target, 'define_datastream', {
        key: 'soil',
        name: 'Soil',
        dataType: 'number',
        componentId: 'component-missing',
      }).ok,
    ).toBe(false);
    expect(
      call(target, 'place_widget', { type: 'gauge', datastream: 'temperature' })
        .ok,
    ).toBe(false);

    expect(
      call(target, 'define_datastream', {
        key: 'temperature',
        name: 'Temperature',
        dataType: 'number',
        unit: '°C',
        componentId: DHT,
        source: 'temperature',
      }).ok,
    ).toBe(true);
    expect(
      call(target, 'place_widget', { type: 'gauge', datastream: 'temperature' })
        .ok,
    ).toBe(true);
    expect(
      call(target, 'place_widget', {
        type: 'line-chart',
        datastream: 'temperature',
      }).ok,
    ).toBe(true);

    const widgets = target.dashboard()!.widgets();
    const [gauge, chart] = widgets.map((widget) => widget.layouts.desktop);
    const overlap =
      gauge.x < chart.x + chart.cols &&
      chart.x < gauge.x + gauge.cols &&
      gauge.y < chart.y + chart.rows &&
      chart.y < gauge.y + gauge.rows;
    expect(overlap).toBe(false);
    expect(widgets[0].deviceId).toBe(DHT);
  });

  it('turns the staged dashboard into one previewed action, after the parts', () => {
    const target = draft();
    call(target, 'define_datastream', {
      key: 'humidity',
      name: 'Humidity',
      dataType: 'number',
      componentId: DHT,
    });
    call(target, 'place_widget', {
      type: 'value',
      title: 'Humidity',
      datastream: 'humidity',
    });
    call(target, 'arrange_dashboard');

    const actions = target.actions();
    expect(actions.at(-1)?.type).toBe('set_dashboard');
    expect(() => assertPlanIsCoherent(actions)).not.toThrow();
    const preview = previewOf(actions, (id) => target.labelOf(id));
    expect(preview.map((line) => line.kind)).toEqual([
      'dashboard',
      'dashboard',
    ]);
    expect(preview[1].text).toContain('← humidity');
  });

  it('proposes nothing for the dashboard when it was only read', () => {
    const target = draft();
    expect(call(target, 'read_dashboard').content).toContain('Widgets:');
    expect(target.actions()).toHaveLength(0);
  });
});

describe('applying a dashboard proposal', () => {
  function fakes() {
    const components: CircuitComponent[] = [
      { id: BOARD, definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    ];
    let sequence = 0;
    const componentsService = {
      add: (
        _user: string,
        _project: string,
        input: { definitionId: string },
      ) => {
        const id = `component-new-${++sequence}`;
        components.push({
          id,
          definitionId: input.definitionId,
          label: input.definitionId,
        });
        return Promise.resolve({ id });
      },
      remove: (_project: string, id: string) => {
        components.splice(
          components.findIndex((component) => component.id === id),
          1,
        );
        return Promise.resolve();
      },
      list: () =>
        Promise.resolve(
          components.map((component) => ({ ...component, state: {} })),
        ),
    } as unknown as ProjectComponentsService;
    const repository = new FakeDashboardRepository();
    const dashboards = new DashboardsService(repository, componentsService);
    const service = new AiPlanApplyService(
      {
        load: () =>
          Promise.resolve({ components: [...components], connections: [] }),
      } as unknown as ProjectCircuitService,
      componentsService,
      {} as ProjectConnectionsService,
      {} as ProjectFilesService,
      dashboards,
    );
    return { components, repository, dashboards, service };
  }

  const plan = (baseVersion: number): PlanActionDto[] =>
    [
      {
        type: 'add_device',
        ref: 'new:1',
        definitionId: 'dht22',
        label: 'DHT22',
      },
      {
        type: 'set_dashboard',
        baseVersion,
        document: {
          name: 'Room',
          widgets: [
            {
              id: 'ai-widget-1',
              type: 'gauge',
              title: 'Temperature',
              datasource: 'temperature',
              deviceId: 'new:1',
              layouts: {},
            },
          ],
        },
        datastreams: [
          {
            key: 'temperature',
            name: 'Temperature',
            dataType: 'number',
            componentId: 'new:1',
          },
        ],
      },
    ] as PlanActionDto[];

  it('writes the dashboard bound to the part the same plan created', async () => {
    const { service, dashboards } = fakes();
    const result = await service.apply('user-1', PROJECT, plan(0));

    expect(result.dashboardUpdated).toBe(true);
    const created = result.createdComponentIds[0];
    const view = await dashboards.get(PROJECT.id);
    expect(view.datastreams[0]).toMatchObject({
      key: 'temperature',
      componentId: created,
    });
    expect(view.document.widgets[0].deviceId).toBe(created);
  });

  it('refuses when the dashboard changed after the proposal, and undoes the parts', async () => {
    const { service, dashboards, components } = fakes();
    await dashboards.save(PROJECT.id, { widgets: [] });

    await expect(service.apply('user-1', PROJECT, plan(0))).rejects.toThrow(
      ConflictException,
    );
    expect(components.map((component) => component.id)).toEqual([BOARD]);
  });
});

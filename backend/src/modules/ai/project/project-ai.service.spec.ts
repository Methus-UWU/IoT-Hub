import { ConfigService } from '@nestjs/config';
import { AiTaskProfile } from '../dto/ai-chat.dto';
import {
  AiProviderRequest,
  AiProviderResult,
} from '../providers/ai-provider.interface';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { CatalogModel } from '../providers/model-catalog.types';
import { ModelSelectorService } from '../providers/model-selector.service';
import { OpenRouterProvider } from '../providers/openrouter.provider';
import { Project } from '../../projects/project.repository';
import {
  ProjectContext,
  ProjectContextService,
} from './project-context.service';
import { ProjectAiService } from './project-ai.service';

const project: Project = {
  id: 'project-test',
  workspaceId: 'workspace-test',
  name: 'Temperature',
  slug: 'temperature',
  description: '',
  board: 'ESP32',
  framework: 'Arduino C++',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const context: ProjectContext = {
  project,
  circuit: {
    components: [
      { id: 'board', definitionId: 'esp32-devkit-v1', label: 'ESP32' },
    ],
    connections: [],
  },
  files: [],
  fileContents: new Map(),
  activeFile: null,
};
function model(
  id: string,
  overrides: Partial<CatalogModel> = {},
): CatalogModel {
  return {
    id,
    name: id,
    vendor: id.split('/')[0],
    description: '',
    contextLength: 128000,
    maxCompletionTokens: 8192,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    isFree: true,
    supportsReasoning: true,
    supportsTools: true,
    moderated: false,
    ...overrides,
  };
}

describe('ProjectAiService model failover', () => {
  const catalogModels = [
    model('first/model', { totalParamsBillions: 550 }),
    model('second/model', {
      totalParamsBillions: 120,
      maxCompletionTokens: 2000,
    }),
    model('third/model', { totalParamsBillions: 70 }),
    model('fourth/model', { totalParamsBillions: 10 }),
    model('paid/model', { isFree: false, totalParamsBillions: 1000 }),
    model('text/model', { supportsTools: false, totalParamsBillions: 1000 }),
  ];
  function setup(
    projectContext: ProjectContext = context,
    env: Record<string, string> = {},
  ) {
    const config = new ConfigService({
      AI_ALLOW_PAID_MODELS: 'false',
      ...env,
    });
    const selector = new ModelSelectorService(config);
    const generate = jest.fn<Promise<AiProviderResult>, [AiProviderRequest]>();
    const service = new ProjectAiService(
      {
        build: () => Promise.resolve(projectContext),
        render: () => 'ESP32 test project',
      } as unknown as ProjectContextService,
      {
        load: () =>
          Promise.resolve({
            models: catalogModels,
            stale: false,
            fetchedAt: '',
          }),
      } as ModelCatalogService,
      selector,
      { generate } as unknown as OpenRouterProvider,
      config,
    );
    return { service, generate, selector };
  }

  it('returns a complete sensor/wiring/source proposal after a required datasheet read', async () => {
    const { service, generate } = setup({
      ...context,
      activeFile: 'main.ino',
      files: [{ path: 'main.ino', sizeBytes: 32 }],
      fileContents: new Map([
        [
          'main.ino',
          { content: 'void setup() {}\nvoid loop() {}', exists: true },
        ],
      ]),
    });
    generate
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'search',
            name: 'search_device_catalog',
            rawArguments: '{"query":"temperature"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'datasheet',
            name: 'read_device_datasheet',
            rawArguments: '{"definitionId":"dht22"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'add',
            name: 'add_device',
            rawArguments: JSON.stringify({
              definitionId: 'dht22',
              wirePins: ['DATA', 'VCC', 'GND'],
            }),
          },
        ],
      })
      .mockImplementationOnce((request) => {
        const assignment = request.messages.find(
          (turn) => 'toolCallId' in turn && turn.toolCallId === 'add',
        );
        const pin = /Use (\d+) as the pin number/.exec(
          assignment?.content ?? '',
        )?.[1];
        expect(pin).toBeDefined();
        return Promise.resolve({
          content: '',
          toolCalls: [
            {
              id: 'write',
              name: 'write_source_file',
              rawArguments: JSON.stringify({
                path: 'main.ino',
                content: `#include <DHT.h>\nDHT dht(${pin}, DHT22);\nvoid setup() { Serial.begin(115200); dht.begin(); }\nvoid loop() { Serial.println(dht.readTemperature()); delay(2000); }`,
              }),
            },
          ],
        });
      })
      .mockResolvedValueOnce({ content: 'The proposal is ready' });
    const result = await service.chat(project, {
      messages: [{ role: 'user', content: 'Monitor room temperature' }],
    });
    expect(generate).toHaveBeenCalledTimes(5);
    expect(generate.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', name: 'get_board_pinout' }),
        expect.objectContaining({
          role: 'tool',
          name: 'read_source_file',
          content: 'void setup() {}\nvoid loop() {}',
        }),
      ]),
    );
    expect(
      result.plan?.actions.filter((action) => action.type === 'connect'),
    ).toHaveLength(3);
    expect(
      result.plan?.actions.filter((action) => action.type === 'write_file'),
    ).toHaveLength(1);
    expect(context.circuit.components).toHaveLength(1);
  });

  it('adds up the token usage of every round in a turn', async () => {
    const { service, generate } = setup();
    generate
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'search',
            name: 'search_device_catalog',
            rawArguments: '{"query":"temperature"}',
          },
        ],
        usage: { inputTokens: 1000, outputTokens: 100 },
      })
      .mockResolvedValueOnce({
        content: 'Here is what I found',
        usage: { inputTokens: 1500, outputTokens: 200 },
      });
    const result = await service.chat(project, {
      messages: [{ role: 'user', content: 'Which temperature sensors exist?' }],
    });
    expect(result.usage).toEqual({ inputTokens: 2500, outputTokens: 300 });
  });

  it('aborts the whole generation at twenty minutes even when a provider never returns', async () => {
    jest.useFakeTimers();
    try {
      const { service, generate } = setup();
      generate.mockImplementation(() => new Promise(() => {}));
      const result = service.chat(project, {
        messages: [{ role: 'user', content: 'Build a circuit' }],
      });
      const rejected = expect(result).rejects.toMatchObject({
        response: { code: 'AI_GENERATION_TIMEOUT' },
      });
      await jest.advanceTimersByTimeAsync(20 * 60_000);
      await rejected;
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not start a provider request after the browser has cancelled', async () => {
    const { service, generate } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.chat(
        project,
        { messages: [{ role: 'user', content: 'Build' }] },
        controller.signal,
      ),
    ).rejects.toMatchObject({ response: { code: 'AI_GENERATION_CANCELLED' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses balanced selection for a short automatic hardware request, with at most three eligible tool models', async () => {
    const { service, generate, selector } = setup();
    const rank = jest.spyOn(selector, 'rank');
    generate.mockResolvedValue({ content: 'A proposal' });
    await service.chat(project, {
      messages: [{ role: 'user', content: 'Add a sensor' }],
    });
    expect(rank).toHaveBeenCalledWith(catalogModels, AiTaskProfile.Balanced);
    const request = generate.mock.calls[0][0];
    expect([request.model, ...request.fallbackModels!]).toHaveLength(3);
    expect([request.model, ...request.fallbackModels!]).not.toEqual(
      expect.arrayContaining(['paid/model']),
    );
    expect([request.model, ...request.fallbackModels!]).not.toEqual(
      expect.arrayContaining(['text/model']),
    );
    expect(request.maxOutputTokens).toBe(2000);
  });

  describe('AI_PROJECT_MODEL', () => {
    async function sentModels(env: Record<string, string>) {
      const { service, generate } = setup(context, env);
      generate.mockResolvedValue({ content: 'A proposal' });
      await service.chat(project, {
        messages: [{ role: 'user', content: 'Add a sensor' }],
      });
      const request = generate.mock.calls[0][0];
      return [request.model, ...(request.fallbackModels ?? [])];
    }

    it('puts the pinned model first and keeps ranked models as fallbacks', async () => {
      const models = await sentModels({
        AI_ALLOW_PAID_MODELS: 'true',
        AI_PROJECT_MODEL: 'paid/model',
      });

      expect(models[0]).toBe('paid/model');
      expect(models).toHaveLength(3);
      expect(new Set(models).size).toBe(3);
    });

    it('uses a pinned paid model with paid models off, and keeps every fallback free', async () => {
      const models = await sentModels({ AI_PROJECT_MODEL: 'paid/model' });

      expect(models[0]).toBe('paid/model');
      expect(models).toHaveLength(3);
      // Only the pin is paid: the ranked fallbacks stay under the free-only policy.
      expect(
        models
          .slice(1)
          .every((id) => catalogModels.find((m) => m.id === id)?.isFree),
      ).toBe(true);
    });

    it('tries pinned models in order, skipping ids the catalog lacks, before ranked ones', async () => {
      const models = await sentModels({
        AI_PROJECT_MODEL: 'paid/model, gone/model, fourth/model,paid/model',
      });

      expect(models.slice(0, 2)).toEqual(['paid/model', 'fourth/model']);
      expect(models).toHaveLength(3);
      expect(new Set(models).size).toBe(3);
    });

    it('still refuses a paid model a user names, when only the operator pinned one', async () => {
      const { service } = setup(context, { AI_PROJECT_MODEL: 'paid/model' });

      await expect(
        service.chat(project, {
          model: 'paid/model',
          messages: [{ role: 'user', content: 'Add a sensor' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'AI_MODEL_NOT_ALLOWED' } });
    });

    it('ignores a pinned model the catalog does not list', async () => {
      const models = await sentModels({ AI_PROJECT_MODEL: 'gone/model' });

      expect(models).not.toContain('gone/model');
      expect(models).toHaveLength(3);
    });
  });

  it('refuses the latency tier even when the client asks for it by name', async () => {
    const { service, generate, selector } = setup();
    const rank = jest.spyOn(selector, 'rank');
    generate.mockResolvedValue({ content: 'A proposal' });

    const result = await service.chat(project, {
      profile: AiTaskProfile.Fast,
      messages: [{ role: 'user', content: 'Add a sensor' }],
    });

    // A project turn is a tool loop, so it is ranked as balanced whatever was asked.
    expect(rank).toHaveBeenCalledWith(catalogModels, AiTaskProfile.Balanced);
    expect(rank).not.toHaveBeenCalledWith(catalogModels, AiTaskProfile.Fast);
    // What the client asked for is still what comes back, so the UI does not silently
    // redraw the user's choice as something they did not pick.
    expect(result.profile).toBe(AiTaskProfile.Fast);
  });

  it('puts one short line next to the accept button when a tool is refused', async () => {
    const { service, generate } = setup();
    generate
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'wire',
            name: 'wire_to_board',
            rawArguments: JSON.stringify({
              componentId: 'nothing-here',
              devicePin: 'DATA',
            }),
          },
          {
            id: 'write',
            name: 'write_source_file',
            rawArguments: JSON.stringify({
              path: 'main.ino',
              content: 'void setup() {}\nvoid loop() {}\n',
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'A proposal' });

    const result = await service.chat(project, {
      messages: [{ role: 'user', content: 'Wire the sensor' }],
    });

    expect(result.plan?.warnings).toHaveLength(1);
    const [warning] = result.plan!.warnings;
    expect(warning).toContain('wire_to_board: ');
    expect(warning).not.toContain('\n');
    expect(warning.length).toBeLessThanOrEqual(220);
  });

  it('continues the same draft and tool results with the model that actually served the fallback', async () => {
    const { service, generate } = setup();
    generate
      .mockResolvedValueOnce({
        content: '',
        servedModel: 'second/model',
        toolCalls: [
          {
            id: 'datasheet',
            name: 'read_device_datasheet',
            rawArguments: JSON.stringify({ definitionId: 'dht22' }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        servedModel: 'second/model',
        toolCalls: [
          {
            id: 'add',
            name: 'add_device',
            rawArguments: JSON.stringify({ definitionId: 'dht22' }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: 'Proposed DHT22',
        servedModel: 'second/model',
      });
    const result = await service.chat(project, {
      messages: [{ role: 'user', content: 'Add a sensor' }],
    });
    const continued = generate.mock.calls[2][0];
    expect(continued.model).toBe('second/model');
    expect(continued.fallbackModels).not.toContain('second/model');
    expect(continued.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', toolCallId: 'add' }),
      ]),
    );
    expect(result.vendor).toBe('second');
    expect(result.plan?.actions).toEqual([
      expect.objectContaining({ type: 'add_device', definitionId: 'dht22' }),
    ]);
    expect(context.circuit.components).toHaveLength(1);
  });

  it('honors an explicit model and rejects a paid override without calling the provider', async () => {
    const { service, generate } = setup();
    generate.mockResolvedValue({ content: 'Explanation' });
    await service.chat(project, {
      model: 'third/model',
      messages: [{ role: 'user', content: 'Explain' }],
    });
    expect(generate.mock.calls[0][0]).toMatchObject({
      model: 'third/model',
      fallbackModels: [],
    });
    generate.mockClear();
    await expect(
      service.chat(project, {
        model: 'paid/model',
        messages: [{ role: 'user', content: 'Explain' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'AI_MODEL_NOT_ALLOWED' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('allows a hardware workflow to reach the source write after more than eight tool rounds', async () => {
    const { service, generate } = setup();
    for (let round = 0; round < 9; round++) {
      generate.mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: `pins-${round}`, name: 'get_board_pinout', rawArguments: '{}' },
        ],
      });
    }
    generate
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'write',
            name: 'write_source_file',
            rawArguments: JSON.stringify({
              path: 'main.ino',
              content: 'void setup() {}\nvoid loop() {}\n',
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'The proposal is ready' });
    const result = await service.chat(project, {
      messages: [{ role: 'user', content: 'Build a room monitor' }],
    });
    expect(result.plan?.actions).toEqual([
      expect.objectContaining({ type: 'write_file', path: 'main.ino' }),
    ]);
  });

  it('tells the model a write cut off at the output limit was truncated, not malformed', async () => {
    const { service, generate } = setup();
    generate
      .mockResolvedValueOnce({
        content: '',
        truncated: true,
        toolCalls: [
          {
            id: 'cut',
            name: 'write_source_file',
            rawArguments: '{"path":"main.ino","content":"void setup() {',
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Shorter version coming' });

    await service.chat(project, {
      messages: [{ role: 'user', content: 'Build a music box' }],
    });

    const secondRound = generate.mock.calls[1][0].messages;
    const answer = secondRound[secondRound.length - 1];
    expect(answer).toMatchObject({ role: 'tool', toolCallId: 'cut' });
    expect(answer.content).toContain('output length limit');
  });

  it('refuses an unfinished tool loop instead of offering a partial plan for acceptance', async () => {
    const { service, generate } = setup();
    generate.mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'read', name: 'get_board_pinout', rawArguments: '{}' }],
    });
    await expect(
      service.chat(project, {
        messages: [{ role: 'user', content: 'Build a circuit' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'AI_GENERATION_INCOMPLETE' } });
    expect(generate.mock.calls.length).toBeLessThanOrEqual(41);
  });

  it('does not request an unapproved model id reported by the provider', async () => {
    const { service, generate } = setup();
    generate
      .mockResolvedValueOnce({
        content: '',
        servedModel: 'unapproved/paid',
        toolCalls: [
          { id: 'pins', name: 'get_board_pinout', rawArguments: '{}' },
        ],
      })
      .mockResolvedValueOnce({ content: 'Board pinout' });
    await service.chat(project, {
      messages: [{ role: 'user', content: 'Read board pins' }],
    });
    for (const [request] of generate.mock.calls) {
      const requested = [request.model, ...(request.fallbackModels ?? [])];
      expect(requested).toHaveLength(3);
      expect(requested).not.toContain('unapproved/paid');
    }
  });
});

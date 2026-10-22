import { ConfigService } from '@nestjs/config';
import { AiCreditsService } from '../ai-credits/ai-credits.service';
import { AiService } from './ai.service';
import { AiTaskProfile } from './dto/ai-chat.dto';
import { ModelCatalogService } from './providers/model-catalog.service';
import { CatalogModel } from './providers/model-catalog.types';
import { ModelSelectorService } from './providers/model-selector.service';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { SystemContextService } from './system-context.service';

function model(id: string, isFree = true): CatalogModel {
  return {
    id,
    name: id,
    vendor: id.split('/')[0],
    description: '',
    contextLength: 128000,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    isFree,
    supportsReasoning: false,
    supportsTools: true,
    moderated: false,
  };
}

describe('Admin AI shared model policy', () => {
  function setup(order: string[] = []) {
    const models = [
      model('free/model'),
      model('primary/model', false),
      model('backup/model', false),
    ];
    const config = new ConfigService({
      AI_PROJECT_MODEL: 'backup/model',
      AI_ALLOW_PAID_MODELS: 'false',
    });
    const selector = new ModelSelectorService(config);
    const modelOrder = jest.fn().mockResolvedValue(order);
    const generate = jest
      .fn()
      .mockResolvedValue({ content: 'Reply', servedModel: 'backup/model' });
    const service = new AiService(
      { load: async () => ({ models }) } as ModelCatalogService,
      selector,
      { generate } as unknown as OpenRouterProvider,
      { build: async () => 'Read-only context' } as SystemContextService,
      config,
      { modelOrder } as unknown as AiCreditsService,
    );
    return { service, generate, modelOrder, selector, models };
  }

  it('uses the IDE candidates even when an older client sends a different model or tier', async () => {
    const order = ['primary/model', 'backup/model'];
    const { service, generate, selector, models } = setup(order);
    const messages = [{ role: 'user' as const, content: 'Hello' }];
    const result = await service.chat({
      messages,
      includeSystemContext: true,
      model: 'free/model',
      profile: AiTaskProfile.Deep,
    });
    const expected = selector.assistantCandidates(
      models,
      selector.inferProfile(messages),
      order,
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expected[0].id,
        fallbackModels: expected.slice(1).map((entry) => entry.id),
        systemPrompt: expect.stringContaining('Read-only context'),
      }),
    );
    expect(result).toMatchObject({
      model: 'backup/model',
      vendor: 'backup',
      profile: 'auto',
      autoSelected: true,
    });
  });

  it('uses the IDE environment pins when central settings are automatic', async () => {
    const { service, generate } = setup();
    await service.chat({
      messages: [{ role: 'user', content: 'Hello' }],
      includeSystemContext: false,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'backup/model',
        fallbackModels: ['free/model'],
      }),
    );
  });

  it('reads current settings again for the next message and propagates cancellation', async () => {
    const { service, generate, modelOrder } = setup(['primary/model']);
    const dto = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      includeSystemContext: false,
    };
    await service.chat(dto);
    modelOrder.mockResolvedValue(['backup/model']);
    const signal = new AbortController().signal;
    await service.chat(dto, signal);
    expect(generate.mock.calls.map(([request]) => request.model)).toEqual([
      'primary/model',
      'backup/model',
    ]);
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ signal }),
    );
  });

  it('does not silently switch policy when central settings cannot be read', async () => {
    const { service, generate, modelOrder } = setup();
    modelOrder.mockRejectedValue(new Error('Settings unavailable'));
    await expect(
      service.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        includeSystemContext: false,
      }),
    ).rejects.toThrow('Settings unavailable');
    expect(generate).not.toHaveBeenCalled();
  });
});

import { ConfigService } from '@nestjs/config';
import { AiProviderRequest } from './ai-provider.interface';
import { ModelCatalogService } from './model-catalog.service';
import { OpenRouterProvider } from './openrouter.provider';

describe('OpenRouterProvider', () => {
  const request: AiProviderRequest = {
    model: 'primary:free',
    systemPrompt: 'Test project',
    messages: [{ role: 'user', content: 'Read the board' }],
    maxOutputTokens: 1000,
  };
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let provider: OpenRouterProvider;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    provider = new OpenRouterProvider(
      new ConfigService({ OPENROUTER_API_KEY: 'test-key' }),
      { baseUrl: 'https://provider.invalid' } as ModelCatalogService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('recognizes an upstream error carried inside HTTP 200 without exposing its details', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        error: {
          code: 502,
          message: 'private upstream detail',
          metadata: { raw: 'private request' },
        },
      }),
    );
    await expect(provider.generate(request)).rejects.toMatchObject({
      response: {
        code: 'AI_PROVIDER_ERROR',
        message: 'AI provider request failed (502). Please try again.',
      },
    });
  });

  it('retries a round that came back empty, and uses what the retry returned', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ choices: [{ message: {} }] }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: 'An answer' } }] }),
      );

    await expect(provider.generate(request)).resolves.toMatchObject({
      content: 'An answer',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up when the round is empty twice, without retrying further', async () => {
    // A fresh Response per call: a body can only be read once, and reusing one would
    // fail the retry for the wrong reason.
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ choices: [{ message: {} }] })),
    );

    await expect(provider.generate(request)).rejects.toMatchObject({
      response: { code: 'AI_PROVIDER_EMPTY' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a round whose body was not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"choices": [', { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: 'An answer' } }] }),
      );

    await expect(provider.generate(request)).resolves.toMatchObject({
      content: 'An answer',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP errors even when the response is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(provider.generate(request)).rejects.toMatchObject({
      response: {
        code: 'AI_PROVIDER_ERROR',
        message: 'AI provider request failed (503). Please try again.',
      },
    });
  });

  it.each([200, 429])(
    'reports provider rate limiting as HTTP 429 even when the upstream status is %s',
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { error: { code: 429, message: 'upstream rate limit details' } },
          { status },
        ),
      );
      await expect(provider.generate(request)).rejects.toMatchObject({
        status: 429,
        response: { code: 'AI_RATE_LIMITED' },
      });
    },
  );

  it('accepts a tool-only response and preserves the served model for the next round', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        model: 'backup:free',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  function: { name: 'get_board_pinout', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
    );
    const result = await provider.generate({
      ...request,
      fallbackModels: ['backup:free'],
      tools: [
        {
          name: 'get_board_pinout',
          description: 'Read pins',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    expect(result).toMatchObject({
      content: '',
      servedModel: 'backup:free',
      toolCalls: [
        { id: 'call-1', name: 'get_board_pinout', rawArguments: '{}' },
      ],
    });
    const body = JSON.parse(
      fetchMock.mock.calls[0][1]!.body as string,
    ) as Record<string, unknown>;
    expect(body['models']).toEqual(['primary:free', 'backup:free']);
    expect(body['model']).toBeUndefined();
    expect(body['provider']).toEqual({
      require_parameters: true,
      sort: 'latency',
    });
  });

  it.each([
    ['price', 'price'],
    ['throughput', 'throughput'],
    ['cheapest', 'latency'],
  ])(
    'orders providers by AI_PROVIDER_SORT=%s (sends %s)',
    async (configured, sent) => {
      const sorted = new OpenRouterProvider(
        new ConfigService({
          OPENROUTER_API_KEY: 'test-key',
          AI_PROVIDER_SORT: configured,
        }),
        { baseUrl: 'https://provider.invalid' } as ModelCatalogService,
      );
      fetchMock.mockResolvedValue(
        Response.json({ choices: [{ message: { content: 'Hello' } }] }),
      );

      await sorted.generate({
        ...request,
        tools: [
          {
            name: 'get_board_pinout',
            description: 'Read pins',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as {
        provider?: { sort?: string };
      };
      expect(body.provider?.sort).toBe(sent);
    },
  );

  it('keeps explicit single-model requests single-model', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ choices: [{ message: { content: 'Hello' } }] }),
    );
    await provider.generate(request);
    const body = JSON.parse(
      fetchMock.mock.calls[0][1]!.body as string,
    ) as Record<string, unknown>;
    expect(body['model']).toBe('primary:free');
    expect(body['models']).toBeUndefined();
    expect(body['tools']).toBeUndefined();
  });

  it('forwards cancellation into a bounded upstream signal', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementation((_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new Error('aborted'));
    });
    await expect(
      provider.generate({ ...request, signal: controller.signal }),
    ).rejects.toThrow('unavailable or timed out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

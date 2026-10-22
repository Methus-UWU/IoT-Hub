import { ConfigService } from '@nestjs/config';

import { GeminiChatRequest, GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  const request: GeminiChatRequest = {
    systemPrompt: 'Advise',
    messages: [{ role: 'user', content: 'Which sensor?' }],
    reasoningEffort: 'low',
  };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  function provider(env: Record<string, string> = {}) {
    return new GeminiProvider(
      new ConfigService({ GEMINI_API_KEY: 'test-key', ...env }),
    );
  }

  it('is not configured without a key, and never calls out', async () => {
    const unconfigured = new GeminiProvider(new ConfigService({}));
    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.generate(request)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the system prompt, the conversation, and the reasoning effort', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        model: 'gemini-served',
        choices: [{ message: { content: ' An answer ' } }],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      }),
    );

    await expect(
      provider({ GEMINI_MODEL: 'gemini-test' }).generate(request),
    ).resolves.toEqual({
      content: 'An answer',
      model: 'gemini-served',
      usage: { inputTokens: 12, outputTokens: 34 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gemini-test',
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'Advise' },
        { role: 'user', content: 'Which sensor?' },
      ],
    });
  });

  it('maps a 429 to AI_RATE_LIMITED without forwarding the upstream body', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { message: 'private upstream detail' } },
        { status: 429 },
      ),
    );

    const failure = provider().generate(request);
    await expect(failure).rejects.toMatchObject({
      status: 429,
      response: { code: 'AI_RATE_LIMITED' },
    });
    await expect(failure).rejects.not.toMatchObject({
      response: { message: expect.stringContaining('private') as string },
    });
  });

  it('treats an empty answer as a provider failure', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ choices: [{ message: { content: '' } }] }),
    );
    await expect(provider().generate(request)).rejects.toMatchObject({
      response: { code: 'AI_PROVIDER_EMPTY' },
    });
  });
});

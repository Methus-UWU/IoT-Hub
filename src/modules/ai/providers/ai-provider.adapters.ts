import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiProviderId } from '../dto/ai-chat.dto';
import {
  AiProviderAdapter,
  AiProviderDescriptor,
  AiProviderRequest,
  AiProviderResult,
} from './ai-provider.interface';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function uniqueModels(defaultModel: string, models: string[]): string[] {
  return [...new Set([...models, defaultModel])];
}

async function requestJson(
  url: string,
  init: RequestInit,
  providerLabel: string,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal,
    });
  } catch {
    throw new BadGatewayException(
      `${providerLabel} is unavailable or timed out`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new BadGatewayException(
      `${providerLabel} request failed with status ${response.status}`,
    );
  }

  const record = asRecord(payload);
  if (!record) {
    throw new BadGatewayException(
      `${providerLabel} returned an invalid response`,
    );
  }
  return record;
}

function requireApiKey(
  config: ConfigService,
  key: string,
  label: string,
): string {
  const value = config.get<string>(key)?.trim();
  if (!value) {
    throw new ServiceUnavailableException(`${label} API key is not configured`);
  }
  return value;
}

function openAiOutput(payload: JsonRecord): string | undefined {
  const direct = stringValue(payload['output_text']);
  if (direct) return direct;

  for (const item of asArray(payload['output'])) {
    const output = asRecord(item);
    if (!output || output['type'] !== 'message') continue;
    for (const contentItem of asArray(output['content'])) {
      const content = asRecord(contentItem);
      if (content?.['type'] === 'output_text') {
        const text = stringValue(content['text']);
        if (text) return text;
      }
    }
  }
  return undefined;
}

async function generateOpenRouterChat(
  config: ConfigService,
  providerLabel: string,
  request: AiProviderRequest,
): Promise<AiProviderResult> {
  const apiKey = requireApiKey(config, 'OPENROUTER_API_KEY', 'OpenRouter');
  const baseUrl =
    config.get<string>('OPENROUTER_BASE_URL')?.replace(/\/$/, '') ||
    'https://openrouter.ai/api/v1';
  const payload = await requestJson(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          ...request.messages,
        ],
        max_tokens: 1600,
      }),
    },
    providerLabel,
    request.signal,
  );

  const choice = asRecord(asArray(payload['choices'])[0]);
  const message = asRecord(choice?.['message']);
  const text = stringValue(message?.['content']);
  if (!text) {
    throw new BadGatewayException(`${providerLabel} returned no text output`);
  }

  const usage = asRecord(payload['usage']);
  return {
    content: text,
    usage: usage
      ? {
          inputTokens: numberValue(usage['prompt_tokens']),
          outputTokens: numberValue(usage['completion_tokens']),
        }
      : undefined,
  };
}

@Injectable()
export class OpenAiProvider implements AiProviderAdapter {
  readonly id = AiProviderId.OpenAi;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-5.4-mini';
    return {
      id: this.id,
      label: 'OpenAI',
      description: 'Reasoning and system analysis',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
      ]),
      configured: Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim()),
    };
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = requireApiKey(this.config, 'OPENAI_API_KEY', 'OpenAI');
    const baseUrl =
      this.config.get<string>('OPENAI_BASE_URL')?.replace(/\/$/, '') ||
      'https://api.openai.com/v1';
    const payload = await requestJson(
      `${baseUrl}/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          instructions: request.systemPrompt,
          input: request.messages,
          max_output_tokens: 1600,
        }),
      },
      'OpenAI',
      request.signal,
    );

    const content = openAiOutput(payload);
    if (!content)
      throw new BadGatewayException('OpenAI returned no text output');
    const usage = asRecord(payload['usage']);
    return {
      content,
      usage: usage
        ? {
            inputTokens: numberValue(usage['input_tokens']),
            outputTokens: numberValue(usage['output_tokens']),
          }
        : undefined,
    };
  }
}

@Injectable()
export class AnthropicProvider implements AiProviderAdapter {
  readonly id = AiProviderId.Anthropic;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5';
    return {
      id: this.id,
      label: 'Claude',
      description: 'Long-form analysis',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
      ]),
      configured: Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim()),
    };
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = requireApiKey(this.config, 'ANTHROPIC_API_KEY', 'Anthropic');
    const baseUrl =
      this.config.get<string>('ANTHROPIC_BASE_URL')?.replace(/\/$/, '') ||
      'https://api.anthropic.com/v1';
    const payload = await requestJson(
      `${baseUrl}/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          system: request.systemPrompt,
          messages: request.messages,
          max_tokens: 1600,
        }),
      },
      'Anthropic',
      request.signal,
    );

    const content = asArray(payload['content'])
      .map((item) => asRecord(item))
      .find((item) => item?.['type'] === 'text');
    const text = stringValue(content?.['text']);
    if (!text)
      throw new BadGatewayException('Anthropic returned no text output');
    const usage = asRecord(payload['usage']);
    return {
      content: text,
      usage: usage
        ? {
            inputTokens: numberValue(usage['input_tokens']),
            outputTokens: numberValue(usage['output_tokens']),
          }
        : undefined,
    };
  }
}

@Injectable()
export class GeminiProvider implements AiProviderAdapter {
  readonly id = AiProviderId.Gemini;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-2.5-flash';
    return {
      id: this.id,
      label: 'Google Gemini',
      description: 'Fast multimodal reasoning',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
      ]),
      configured: Boolean(this.config.get<string>('GEMINI_API_KEY')?.trim()),
    };
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = requireApiKey(this.config, 'GEMINI_API_KEY', 'Gemini');
    const baseUrl =
      this.config.get<string>('GEMINI_BASE_URL')?.replace(/\/$/, '') ||
      'https://generativelanguage.googleapis.com/v1beta';
    const payload = await requestJson(
      `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: request.systemPrompt }] },
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: 1600 },
        }),
      },
      'Gemini',
      request.signal,
    );

    const candidate = asRecord(asArray(payload['candidates'])[0]);
    const candidateContent = asRecord(candidate?.['content']);
    const part = asRecord(asArray(candidateContent?.['parts'])[0]);
    const text = stringValue(part?.['text']);
    if (!text) throw new BadGatewayException('Gemini returned no text output');
    const usage = asRecord(payload['usageMetadata']);
    return {
      content: text,
      usage: usage
        ? {
            inputTokens: numberValue(usage['promptTokenCount']),
            outputTokens: numberValue(usage['candidatesTokenCount']),
          }
        : undefined,
    };
  }
}

@Injectable()
export class DeepSeekProvider implements AiProviderAdapter {
  readonly id = AiProviderId.DeepSeek;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('DEEPSEEK_MODEL')?.trim() || 'deepseek-chat';
    return {
      id: this.id,
      label: 'DeepSeek',
      description: 'Efficient technical reasoning',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'deepseek-reasoner',
        'deepseek-chat',
      ]),
      configured: Boolean(this.config.get<string>('DEEPSEEK_API_KEY')?.trim()),
    };
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = requireApiKey(this.config, 'DEEPSEEK_API_KEY', 'DeepSeek');
    const baseUrl =
      this.config.get<string>('DEEPSEEK_BASE_URL')?.replace(/\/$/, '') ||
      'https://api.deepseek.com';
    const payload = await requestJson(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...request.messages,
          ],
          max_tokens: 1600,
        }),
      },
      'DeepSeek',
      request.signal,
    );

    const choice = asRecord(asArray(payload['choices'])[0]);
    const message = asRecord(choice?.['message']);
    const text = stringValue(message?.['content']);
    if (!text)
      throw new BadGatewayException('DeepSeek returned no text output');
    const usage = asRecord(payload['usage']);
    return {
      content: text,
      usage: usage
        ? {
            inputTokens: numberValue(usage['prompt_tokens']),
            outputTokens: numberValue(usage['completion_tokens']),
          }
        : undefined,
    };
  }
}

@Injectable()
export class MetaProvider implements AiProviderAdapter {
  readonly id = AiProviderId.Meta;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('META_MODEL')?.trim() ||
      'meta-llama/llama-3.3-70b-instruct:free';
    return {
      id: this.id,
      label: 'Meta',
      description: 'Free Llama instruct models via OpenRouter',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'meta-llama/llama-3.3-70b-instruct:free',
        'meta-llama/llama-3.2-3b-instruct:free',
      ]),
      configured: Boolean(
        this.config.get<string>('OPENROUTER_API_KEY')?.trim(),
      ),
    };
  }

  generate(request: AiProviderRequest): Promise<AiProviderResult> {
    return generateOpenRouterChat(this.config, 'Meta Llama', request);
  }
}

@Injectable()
export class GemmaProvider implements AiProviderAdapter {
  readonly id = AiProviderId.Gemma;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('GEMMA_MODEL')?.trim() ||
      'google/gemma-4-31b-it:free';
    return {
      id: this.id,
      label: 'Google Gemma',
      description: 'Free Gemma 4 models via OpenRouter',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
      ]),
      configured: Boolean(
        this.config.get<string>('OPENROUTER_API_KEY')?.trim(),
      ),
    };
  }

  generate(request: AiProviderRequest): Promise<AiProviderResult> {
    return generateOpenRouterChat(this.config, 'Google Gemma', request);
  }
}

@Injectable()
export class NvidiaProvider implements AiProviderAdapter {
  readonly id = AiProviderId.Nvidia;

  constructor(private readonly config: ConfigService) {}

  descriptor(): AiProviderDescriptor {
    const defaultModel =
      this.config.get<string>('NVIDIA_MODEL')?.trim() ||
      'nvidia/nemotron-3-ultra-550b-a55b:free';
    return {
      id: this.id,
      label: 'NVIDIA',
      description: 'Free Nemotron models via OpenRouter',
      defaultModel,
      models: uniqueModels(defaultModel, [
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-nano-30b-a3b:free',
      ]),
      configured: Boolean(
        this.config.get<string>('OPENROUTER_API_KEY')?.trim(),
      ),
    };
  }

  generate(request: AiProviderRequest): Promise<AiProviderResult> {
    return generateOpenRouterChat(this.config, 'NVIDIA Nemotron', request);
  }
}

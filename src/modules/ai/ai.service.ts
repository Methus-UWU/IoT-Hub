import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AiChatDto, AiProviderId } from './dto/ai-chat.dto';
import {
  AnthropicProvider,
  DeepSeekProvider,
  GemmaProvider,
  GeminiProvider,
  MetaProvider,
  NvidiaProvider,
  OpenAiProvider,
} from './providers/ai-provider.adapters';
import {
  AiProviderAdapter,
  AiProviderDescriptor,
} from './providers/ai-provider.interface';
import { SystemContextService } from './system-context.service';

const BASE_SYSTEM_PROMPT = `You are the IoT Hub administration assistant.
Help an authenticated administrator analyze platform health, logs, infrastructure, database behavior, users, security signals, and operational incidents.
Answer in the same language as the administrator. Be concise, evidence-based, and clearly separate observations, hypotheses, and recommended next steps.
Never claim that you changed, restarted, deleted, or deployed anything. You only analyze and recommend actions.
Never reveal secrets, environment variables, access tokens, API keys, passwords, or private connection strings.`;

export interface AiChatResult {
  id: string;
  provider: AiProviderId;
  model: string;
  content: string;
  createdAt: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

@Injectable()
export class AiService {
  private readonly providers: Map<AiProviderId, AiProviderAdapter>;

  constructor(
    openAi: OpenAiProvider,
    anthropic: AnthropicProvider,
    gemini: GeminiProvider,
    gemma: GemmaProvider,
    deepSeek: DeepSeekProvider,
    meta: MetaProvider,
    nvidia: NvidiaProvider,
    private readonly systemContext: SystemContextService,
  ) {
    this.providers = new Map(
      [openAi, anthropic, gemini, gemma, deepSeek, meta, nvidia].map(
        (provider) => [provider.id, provider],
      ),
    );
  }

  listProviders(): AiProviderDescriptor[] {
    return [...this.providers.values()].map((provider) =>
      provider.descriptor(),
    );
  }

  async chat(dto: AiChatDto, signal?: AbortSignal): Promise<AiChatResult> {
    const provider = this.providers.get(dto.provider);
    if (!provider) throw new BadRequestException('Unsupported AI provider');

    const descriptor = provider.descriptor();
    const model = dto.model?.trim() || descriptor.defaultModel;
    if (!descriptor.models.includes(model)) {
      throw new BadRequestException(
        `Model "${model}" is not enabled for ${descriptor.label}`,
      );
    }

    const liveContext = dto.includeSystemContext
      ? await this.systemContext.build()
      : 'Live system context was not requested.';
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\nCurrent read-only system context:\n${liveContext}`;
    const result = await provider.generate({
      model,
      messages: dto.messages,
      systemPrompt,
      signal,
    });

    return {
      id: randomUUID(),
      provider: dto.provider,
      model,
      content: result.content,
      createdAt: new Date().toISOString(),
      usage: result.usage,
    };
  }
}

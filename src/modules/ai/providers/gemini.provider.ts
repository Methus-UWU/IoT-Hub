import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiChatMessageDto } from '../dto/ai-chat.dto';
import { asArray, asRecord, numberValue, stringValue } from './json-values';

/** Gemini's OpenAI-compatible surface; the request shape matches OpenRouter's. */
const DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Hot-swapped by Google to the current Flash-Lite release, so no version is pinned.
 * Lite rather than Flash: on the free tier Flash often answers 503 under load, and a
 * Gemini failure falls through to OpenRouter's much smaller daily quota.
 */
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

/**
 * Gemini 3 models always think, and the thinking shares the output budget, so the
 * ceiling is far above OpenRouter's prose-only default.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Kept short on purpose: a Gemini failure falls back to OpenRouter, and both
 * attempts must fit inside the gateway's request timeout.
 */
const REQUEST_TIMEOUT_MS = 60_000;

export type GeminiReasoningEffort = 'low' | 'medium' | 'high';

export interface GeminiChatRequest {
  systemPrompt: string;
  messages: AiChatMessageDto[];
  reasoningEffort: GeminiReasoningEffort;
  signal?: AbortSignal;
}

export interface GeminiChatResult {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Plain-conversation access to the Gemini API, used by the IoT advisor.
 *
 * Deliberately narrower than `OpenRouterProvider`: no tools and no catalog. Tool
 * calling and model ranking for project generation stay on OpenRouter, where they
 * are tuned and tested; this adapter only answers questions.
 */
@Injectable()
export class GeminiProvider {
  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.apiKey());
  }

  async generate(request: GeminiChatRequest): Promise<GeminiChatResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('Gemini API key is not configured');
    }

    const model =
      this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_MODEL;
    const baseUrl = (
      this.config.get<string>('GEMINI_BASE_URL')?.trim() || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    const maxOutputTokens =
      Number(this.config.get<string>('GEMINI_MAX_OUTPUT_TOKENS')) ||
      DEFAULT_MAX_OUTPUT_TOKENS;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...request.messages.map(({ role, content }) => ({ role, content })),
          ],
          max_tokens: maxOutputTokens,
          reasoning_effort: request.reasoningEffort,
        }),
        signal: request.signal
          ? AbortSignal.any([
              request.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Gemini is unavailable or timed out');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    // An error body is never forwarded: it may echo the request contents.
    if (!response.ok) {
      if (response.status === 429) {
        throw new HttpException(
          {
            code: 'AI_RATE_LIMITED',
            message:
              'ผู้ให้บริการ AI จำกัดจำนวนคำขออยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadGatewayException({
        code: 'AI_PROVIDER_ERROR',
        message: `AI provider request failed (${response.status}). Please try again.`,
      });
    }

    const record = asRecord(payload);
    const message = asRecord(
      asRecord(asArray(record?.['choices'])[0])?.['message'],
    );
    const content = stringValue(message?.['content'])?.trim();
    if (!content) {
      throw new BadGatewayException({
        code: 'AI_PROVIDER_EMPTY',
        message: 'AI returned an empty answer. Please try again.',
      });
    }

    const usage = asRecord(record?.['usage']);
    return {
      content,
      model: stringValue(record?.['model']) ?? model,
      usage: usage
        ? {
            inputTokens: numberValue(usage['prompt_tokens']),
            outputTokens: numberValue(usage['completion_tokens']),
          }
        : undefined,
    };
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('GEMINI_API_KEY')?.trim() || undefined;
  }
}

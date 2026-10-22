import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AiConversationTurn,
  AiProviderAdapter,
  AiProviderRequest,
  AiProviderResult,
  AiToolCall,
} from './ai-provider.interface';
import { asArray, asRecord, numberValue, stringValue } from './json-values';
import { ModelCatalogService } from './model-catalog.service';

/**
 * A round with nothing usable in it: neither prose nor a tool call, or a body that was
 * not a JSON object at all (a free upstream cut off mid-response). Retried once, never
 * surfaced as itself.
 */
class EmptyResponseError extends Error {}

/**
 * One model round. A free model writing a whole sketch can take well over a minute;
 * cutting it at 60 s threw away turns that were nearly done.
 */
const ROUND_TIMEOUT_MS = 180_000;

/**
 * How OpenRouter orders the providers serving one model. `latency` is the default;
 * `price` takes a discounted provider first (a model can be 90% cheaper on one
 * host than on its vendor's own), at the cost of whatever speed that host has.
 */
const PROVIDER_SORTS = ['latency', 'price', 'throughput'] as const;
type ProviderSort = (typeof PROVIDER_SORTS)[number];

/**
 * The single upstream for AI chat.
 *
 * Every vendor reachable from this app is reached through OpenRouter's
 * OpenAI-compatible endpoint, so there is one request shape, one API key, and
 * one place where a model id is sent. The id always comes from the caller,
 * which resolved it against the live catalog.
 */
@Injectable()
export class OpenRouterProvider implements AiProviderAdapter {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: ModelCatalogService,
  ) {}

  /**
   * One model round, with a single retry when the round comes back empty or unreadable.
   *
   * A model occasionally returns neither prose nor a tool call, or a body that does not
   * parse — an upstream hiccup, not a decision. Treating that as fatal threw away a turn that was most of the way through a
   * plan, which the user sees as the assistant failing on a request it had nearly
   * finished. One retry costs a few seconds and the same request may be routed elsewhere;
   * twice in a row is a real failure and is reported.
   */
  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    try {
      return await this.request(request);
    } catch (error) {
      if (!(error instanceof EmptyResponseError)) throw error;
      request.signal?.throwIfAborted();
      try {
        return await this.request(request);
      } catch (retryError) {
        if (!(retryError instanceof EmptyResponseError)) throw retryError;
        throw new BadGatewayException({
          code: 'AI_PROVIDER_EMPTY',
          message:
            'AI ตอบกลับว่าง ๆ สองครั้งติดกัน ยังไม่มีการใช้แผนกับโปรเจกต์ กรุณาลองใหม่อีกครั้ง',
        });
      }
    }
  }

  /** `AI_PROVIDER_SORT`; anything unrecognised keeps the latency default. */
  private providerSort(): ProviderSort {
    const configured = this.config.get<string>('AI_PROVIDER_SORT')?.trim();
    return PROVIDER_SORTS.find((sort) => sort === configured) ?? 'latency';
  }

  private async request(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OpenRouter API key is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.catalog.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(request.fallbackModels?.length
            ? { models: [request.model, ...request.fallbackModels] }
            : { model: request.model }),
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...request.messages.map(toWireMessage),
          ],
          max_tokens: request.maxOutputTokens,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                // `tool_choice` is deliberately omitted. Letting the model decide is the
                // default once tools are present, and sending the field explicitly makes
                // OpenRouter drop every endpoint that does not advertise `tool_choice`
                // support — which answers a normal tool request with HTTP 404 "No
                // endpoints found" instead of running it.
                provider: {
                  require_parameters: true,
                  sort: this.providerSort(),
                },
              }
            : {}),
        }),
        signal: request.signal
          ? AbortSignal.any([
              request.signal,
              AbortSignal.timeout(ROUND_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(ROUND_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('OpenRouter is unavailable or timed out');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const upstreamError = asRecord(asRecord(payload)?.['error']);
    if (!response.ok || upstreamError) {
      // OpenRouter may send HTTP 200 headers before an upstream error occurs.
      // Never forward provider error metadata: it may include request contents.
      const status = numberValue(upstreamError?.['code']) ?? response.status;
      if (status === 429) {
        throw new HttpException(
          {
            code: 'AI_RATE_LIMITED',
            message:
              'ผู้ให้บริการ AI จำกัดจำนวนคำขอในขณะนี้ กรุณาลองใหม่ภายหลัง ยังไม่มีการใช้แผนกับโปรเจกต์',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadGatewayException({
        code: 'AI_PROVIDER_ERROR',
        message: `AI provider request failed (${status}). Please try again.`,
      });
    }

    const record = asRecord(payload);
    if (!record) throw new EmptyResponseError();

    const choice = asRecord(asArray(record['choices'])[0]);
    const message = asRecord(choice?.['message']);
    const text = stringValue(message?.['content']) ?? '';
    const toolCalls = readToolCalls(message?.['tool_calls']);

    // A turn that asks for tools legitimately carries no prose, so "no text" is only an
    // error when the model also asked for nothing to run.
    if (!text && !toolCalls.length) {
      throw new EmptyResponseError();
    }

    const usage = asRecord(record['usage']);
    return {
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
      servedModel: stringValue(record['model']),
      ...(stringValue(choice?.['finish_reason']) === 'length'
        ? { truncated: true }
        : {}),
      usage: usage
        ? {
            inputTokens: numberValue(usage['prompt_tokens']),
            outputTokens: numberValue(usage['completion_tokens']),
          }
        : undefined,
    };
  }
}

/**
 * Maps one conversation turn to the OpenAI-compatible wire shape.
 *
 * Plain `{ role, content }` turns pass through, which is why ordinary chat needed no
 * change. The two tool-carrying shapes do not: an assistant turn requesting tools moves
 * its calls into `tool_calls`, and a result turn becomes a `tool` message naming the call
 * it answers. Getting either wrong makes the upstream reject the whole conversation, not
 * just the turn.
 */
function toWireMessage(
  turn: AiConversationTurn | { role: string; content: string },
) {
  if ('toolCallId' in turn) {
    return {
      role: 'tool',
      tool_call_id: turn.toolCallId,
      name: turn.name,
      content: turn.content,
    };
  }

  if ('toolCalls' in turn) {
    return {
      role: 'assistant',
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.rawArguments },
      })),
    };
  }

  return { role: turn.role, content: turn.content };
}

/** Reads the tool calls off a response, ignoring entries too malformed to run. */
function readToolCalls(value: unknown): AiToolCall[] {
  const calls: AiToolCall[] = [];

  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const fn = asRecord(record?.['function']);
    const name = stringValue(fn?.['name']);
    const id = stringValue(record?.['id']);
    if (!name || !id) continue;

    calls.push({
      id,
      name,
      // Some models emit an empty string for a no-argument call. Normalising it to `{}`
      // here keeps every caller from having to special-case that.
      rawArguments: stringValue(fn?.['arguments'])?.trim() || '{}',
    });
  }

  return calls;
}

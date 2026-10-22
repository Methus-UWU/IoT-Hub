import { AiChatMessageDto } from '../dto/ai-chat.dto';

/**
 * One tool the model may ask for.
 *
 * `parameters` is a JSON Schema object. It is passed through untouched, so the schema a
 * tool declares is the contract the upstream enforces on the arguments — but never the
 * only one: everything a model sends back is re-validated here before it can act.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool the model asked to run, exactly as the upstream reported it. */
export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON text. Unparsed on purpose: a model can emit something that is not JSON. */
  rawArguments: string;
}

/**
 * A turn in a tool-using conversation.
 *
 * `assistant` turns may carry tool calls instead of text; a `tool` turn is the result fed
 * back for one of them and must name the call it answers.
 */
export type AiConversationTurn =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string; toolCalls: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AiProviderRequest {
  model: string;
  /** Ordered, policy-approved alternatives for upstream model failover. */
  fallbackModels?: string[];
  messages: AiChatMessageDto[] | AiConversationTurn[];
  systemPrompt: string;
  /** Clamped against the model's own completion ceiling by the caller. */
  maxOutputTokens: number;
  /** Offered to the model; omitted entirely when empty so plain chat is unaffected. */
  tools?: AiToolDefinition[];
  signal?: AbortSignal;
}

export interface AiProviderResult {
  content: string;
  /** Present when the model wants tools run before it can answer. */
  toolCalls?: AiToolCall[];
  /** The id the upstream actually served, which can differ after routing. */
  servedModel?: string;
  /** The reply stopped at the output-token limit, so a tool call may be cut short. */
  truncated?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiProviderAdapter {
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

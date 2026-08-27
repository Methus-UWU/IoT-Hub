import { AiChatMessageDto, AiProviderId } from '../dto/ai-chat.dto';

export interface AiProviderDescriptor {
  id: AiProviderId;
  label: string;
  description: string;
  defaultModel: string;
  models: string[];
  configured: boolean;
}

export interface AiProviderRequest {
  model: string;
  messages: AiChatMessageDto[];
  systemPrompt: string;
  signal?: AbortSignal;
}

export interface AiProviderResult {
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  descriptor(): AiProviderDescriptor;
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

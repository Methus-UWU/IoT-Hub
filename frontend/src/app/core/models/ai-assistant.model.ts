/** What the request needs from a model; `auto` lets the backend decide. */
export type AiTaskProfile = 'auto' | 'fast' | 'balanced' | 'deep';

/** One entry of the live OpenRouter catalog served by `GET admin/ai/catalog`. */
export interface AiCatalogModel {
  id: string;
  name: string;
  vendor: string;
  contextLength: number;
  isFree: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
  promptPricePerMillion: number;
  completionPricePerMillion: number;
  paramsBillions?: number;
}

export interface AiVendorGroup {
  id: string;
  label: string;
  models: AiCatalogModel[];
}

export interface AiProfileOption {
  id: AiTaskProfile;
  label: string;
  description: string;
  recommendedModel?: AiCatalogModel;
}

export interface AiCatalog {
  configured: boolean;
  /** True when the backend served a cached or fallback catalog. */
  stale: boolean;
  fetchedAt: string;
  allowPaidModels: boolean;
  profiles: AiProfileOption[];
  vendors: AiVendorGroup[];
}

export type AiChatRole = 'user' | 'assistant';

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: Date;
  model?: string;
  vendor?: string;
  profile?: AiTaskProfile;
  autoSelected?: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  /** Null when the conversation runs on automatic model selection. */
  model: string | null;
  profile: AiTaskProfile;
  messages: AiChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AiChatApiMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatRequest {
  messages: AiChatApiMessage[];
  includeSystemContext: boolean;
}

export interface AiChatResponse {
  id: string;
  model: string;
  vendor: string;
  profile: AiTaskProfile;
  autoSelected: boolean;
  content: string;
  createdAt: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export type AiProfileTier = 'auto' | 'balanced' | 'deep';
export const AI_PROFILE_TIERS: readonly AiProfileTier[] = [
  'auto',
  'balanced',
  'deep',
];

export interface AiProfileRecord {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tier: AiProfileTier;
  instructions: string;
  /** Null for a system profile. */
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiProfileInput {
  name: string;
  description: string;
  model: string | null;
  tier: AiProfileTier;
  instructions: string;
}

export type AiPlanState = 'pending' | 'applied' | 'failed' | 'dismissed';

export interface AiMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan: unknown;
  planState: AiPlanState | null;
  planError: string | null;
  model: string | null;
  createdAt: Date;
}

export type NewAiMessage = Omit<AiMessageRecord, 'id' | 'createdAt'>;

export interface AiConversationRecord {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  profileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiConversationSummary extends AiConversationRecord {
  messageCount: number;
}

export abstract class AiProfileRepository {
  /** The system profiles and the user's own, system first. */
  abstract listVisible(userId: string): Promise<AiProfileRecord[]>;

  abstract findById(id: string): Promise<AiProfileRecord | null>;

  abstract countOwned(userId: string): Promise<number>;

  abstract create(
    ownerId: string | null,
    input: AiProfileInput,
  ): Promise<AiProfileRecord>;

  abstract update(
    id: string,
    patch: Partial<AiProfileInput>,
  ): Promise<AiProfileRecord>;

  abstract delete(id: string): Promise<void>;
}

export abstract class AiConversationRepository {
  /** Newest first. */
  abstract list(
    userId: string,
    projectId: string,
  ): Promise<AiConversationSummary[]>;

  abstract find(id: string): Promise<AiConversationRecord | null>;

  /**
   * Creates a conversation and, in the same transaction, deletes the user's least
   * recently used ones in this project beyond `keep`.
   */
  abstract create(
    userId: string,
    projectId: string,
    profileId: string | null,
    keep: number,
  ): Promise<AiConversationRecord>;

  abstract update(
    id: string,
    patch: { title?: string; profileId?: string | null },
  ): Promise<AiConversationRecord>;

  abstract delete(id: string): Promise<void>;

  /** The last `limit` messages, oldest first. */
  abstract messages(
    conversationId: string,
    limit: number,
  ): Promise<AiMessageRecord[]>;

  /**
   * Adds a message and marks the conversation as used. `title` is set only when the
   * conversation has none yet.
   */
  abstract appendMessage(
    conversationId: string,
    message: NewAiMessage,
    title?: string,
  ): Promise<AiMessageRecord>;

  /** Returns false when the message is not in that conversation. */
  abstract updatePlanState(
    conversationId: string,
    messageId: string,
    state: AiPlanState,
    error: string | null,
  ): Promise<boolean>;
}

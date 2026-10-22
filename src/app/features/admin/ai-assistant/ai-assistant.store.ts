import { Service, computed, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';

import { AiCatalog, AiChatMessage, AiConversation } from '../../../core/models/ai-assistant.model';
import { LoggerService } from '../../../core/services/logger.service';
import { AiAssistantService } from './ai-assistant.service';

const CONVERSATION_STORAGE_KEY = 'iot-hub.admin.ai-conversations.v2';
const MAX_SAVED_CONVERSATIONS = 30;

@Service()
export class AiAssistantStore {
  private readonly service = inject(AiAssistantService);
  private readonly logger = inject(LoggerService);

  private readonly _catalog = signal<AiCatalog | null>(null);
  private readonly _messages = signal<AiChatMessage[]>([]);
  private readonly _conversations = signal<AiConversation[]>(loadSavedConversations());
  private readonly _activeConversationId = signal<string | null>(null);
  private readonly _loadingCatalog = signal(false);
  private readonly _sending = signal(false);
  private readonly _error = signal<string | null>(null);
  private activeRequest: Subscription | null = null;
  private loaded = false;

  readonly catalog = this._catalog.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly activeConversationId = this._activeConversationId.asReadonly();
  readonly loadingCatalog = this._loadingCatalog.asReadonly();
  readonly sending = this._sending.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMessages = computed(() => this._messages().length > 0);
  readonly conversations = computed(() =>
    [...this._conversations()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
  );
  readonly configured = computed(() => this._catalog()?.configured ?? false);
  readonly stale = computed(() => this._catalog()?.stale ?? false);

  loadCatalog(): void {
    if (this.loaded || this._loadingCatalog()) return;

    this._loadingCatalog.set(true);
    this.service
      .getCatalog()
      .pipe(finalize(() => this._loadingCatalog.set(false)))
      .subscribe({
        next: (catalog) => {
          this.loaded = true;
          this._catalog.set(catalog);
        },
        error: (error: unknown) => {
          this.logger.error('Unable to load the AI model catalog', error);
          this._error.set('โหลดรายการ AI model ไม่สำเร็จ ระบบจะเลือกโมเดลให้อัตโนมัติ');
        },
      });
  }

  send(content: string): void {
    const prompt = content.trim();
    if (!prompt || this._sending()) return;

    const userMessage: AiChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      createdAt: new Date(),
    };
    this._messages.update((messages) => [...messages, userMessage]);
    this.saveUserMessage(prompt);
    this._sending.set(true);
    this._error.set(null);

    const history = this._messages().map(({ role, content: messageContent }) => ({
      role,
      content: messageContent,
    }));
    const subscription = this.service
      .chat({
        messages: history,
        includeSystemContext: true,
      })
      .pipe(
        finalize(() => {
          this._sending.set(false);
          this.activeRequest = null;
        }),
      )
      .subscribe({
        next: (response) => {
          this._messages.update((messages) => [
            ...messages,
            {
              id: response.id,
              role: 'assistant',
              content: response.content,
              createdAt: new Date(response.createdAt),
              model: response.model,
              vendor: response.vendor,
              profile: response.profile,
              autoSelected: response.autoSelected,
            },
          ]);
          this.syncActiveConversation();
        },
        error: (error: unknown) => {
          this.logger.error('AI assistant request failed', error);
          this._error.set(
            'AI ตอบกลับไม่สำเร็จ กรุณาตรวจสอบ OpenRouter API key และการเชื่อมต่อแล้วลองใหม่',
          );
        },
      });
    this.activeRequest = subscription.closed ? null : subscription;
  }

  stopGeneration(): void {
    if (!this._sending()) return;

    this.activeRequest?.unsubscribe();
    this.activeRequest = null;
    this._sending.set(false);
    this._error.set(null);
  }

  clearConversation(): void {
    if (this._sending()) return;
    this._messages.set([]);
    this._activeConversationId.set(null);
    this._error.set(null);
  }

  openConversation(id: string): void {
    if (this._sending()) return;
    const conversation = this._conversations().find((item) => item.id === id);
    if (!conversation) return;

    this._activeConversationId.set(conversation.id);
    this._messages.set(
      conversation.messages.map((message) => ({
        ...message,
        createdAt: new Date(message.createdAt),
      })),
    );
    this._error.set(null);
  }

  deleteConversation(id: string): void {
    if (this._sending()) return;
    this._conversations.update((conversations) =>
      conversations.filter((conversation) => conversation.id !== id),
    );
    if (this._activeConversationId() === id) {
      this._activeConversationId.set(null);
      this._messages.set([]);
      this._error.set(null);
    }
    this.persistConversations();
  }

  private saveUserMessage(prompt: string): void {
    const activeId = this._activeConversationId();
    if (activeId) {
      this.syncActiveConversation();
      return;
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const conversation: AiConversation = {
      id,
      title: conversationTitle(prompt),
      model: null,
      profile: 'auto',
      messages: [...this._messages()],
      createdAt: now,
      updatedAt: now,
    };
    this._activeConversationId.set(id);
    this._conversations.update((conversations) =>
      [conversation, ...conversations].slice(0, MAX_SAVED_CONVERSATIONS),
    );
    this.persistConversations();
  }

  private syncActiveConversation(): void {
    const activeId = this._activeConversationId();
    if (!activeId) return;

    this._conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === activeId
          ? {
              ...conversation,
              model: null,
              profile: 'auto',
              messages: [...this._messages()],
              updatedAt: new Date(),
            }
          : conversation,
      ),
    );
    this.persistConversations();
  }

  private persistConversations(): void {
    try {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(this._conversations()));
    } catch (error: unknown) {
      this.logger.warn('Unable to save AI conversation history', error);
    }
  }
}

function conversationTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 46 ? `${compact.slice(0, 46)}…` : compact;
}

function loadSavedConversations(): AiConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = stringField(value, 'id');
      const title = stringField(value, 'title');
      const messages = Array.isArray(value['messages']) ? value['messages'] : [];
      if (!id || !title) return [];

      return [
        {
          id,
          title,
          model: stringField(value, 'model') ?? null,
          profile: 'auto',
          messages: messages.flatMap((message) => normalizeMessage(message)),
          createdAt: validDate(value['createdAt']),
          updatedAt: validDate(value['updatedAt']),
        },
      ];
    });
  } catch {
    return [];
  }
}

function normalizeMessage(value: unknown): AiChatMessage[] {
  if (!isRecord(value)) return [];
  const id = stringField(value, 'id');
  const role = stringField(value, 'role');
  const content = stringField(value, 'content');
  if (!id || (role !== 'user' && role !== 'assistant') || !content) return [];

  return [
    {
      id,
      role,
      content,
      createdAt: validDate(value['createdAt']),
      model: stringField(value, 'model'),
      vendor: stringField(value, 'vendor'),
      profile: value['profile'] === undefined ? undefined : 'auto',
      autoSelected: value['autoSelected'] === true,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function validDate(value: unknown): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

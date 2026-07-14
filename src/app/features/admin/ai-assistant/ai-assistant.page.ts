import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { Dropdown, DropdownOption } from '../../../shared/components/dropdown/dropdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  starred: boolean;
}

const ASSISTANT_MODELS: DropdownOption[] = [
  { value: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
  { value: 'gemini-pro', label: 'Gemini Pro' },
  { value: 'fast-lite', label: 'Fast (Lite)' }
];

const SUGGESTIONS = [
  "Summarize today's error logs",
  'Explain the CPU/RAM spike',
  "This week's user activity",
  'Find resource-heavy projects'
];

const THINKING_DELAY_MS = 1100;

const buildReply = (text: string): string =>
  `This feature is still in development. Once it ships, I'll be able to help with "${text}".`;

const seed = (id: string, title: string, starred: boolean): Conversation => ({
  id,
  title,
  starred,
  messages: [
    { role: 'user', text: title },
    { role: 'assistant', text: buildReply(title) }
  ]
});

const SEED_CONVERSATIONS: Conversation[] = [
  seed('s1', 'Summarize error logs for the API gateway', true),
  seed('s2', 'Investigate the CPU spike on node-3', true),
  seed('s3', 'Draft the monthly usage report', true),
  seed('r1', 'Which projects use the most storage?', false),
  seed('r2', 'Backup status for the production database', false),
  seed('r3', 'List devices offline in the last 24 hours', false),
  seed('r4', 'Explain the memory-leak alert', false),
  seed('r5', 'Compare this week vs last week signups', false),
  seed('r6', 'Top API consumers by request volume', false)
];

@Component({
  selector: 'app-ai-assistant-page',
  imports: [Dropdown, NgTemplateOutlet],
  host: {
    '(document:click)': 'closeMenu()'
  },
  templateUrl: './ai-assistant.page.html'
})
export class AiAssistantPage {
  protected readonly userName = 'Admin';
  protected readonly models = ASSISTANT_MODELS;
  protected readonly suggestions = SUGGESTIONS;

  protected readonly selectedModel = signal<string>(ASSISTANT_MODELS[0].value);
  protected readonly inputValue = signal('');
  protected readonly isThinking = signal(false);

  protected readonly conversations = signal<Conversation[]>(SEED_CONVERSATIONS);
  protected readonly activeId = signal<string | null>(null);
  protected readonly searchQuery = signal('');
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameValue = signal('');

  private conversationCounter = 0;
  private readonly chatInput = viewChild<ElementRef<HTMLInputElement>>('chatInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  private thinkingTimeout: ReturnType<typeof setTimeout> | undefined;

  protected readonly messages = computed<ChatMessage[]>(
    () => this.conversations().find((conversation) => conversation.id === this.activeId())?.messages ?? []
  );

  private readonly filteredConversations = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return this.conversations();
    return this.conversations().filter((conversation) => conversation.title.toLowerCase().includes(query));
  });

  protected readonly starredChats = computed(() => this.filteredConversations().filter((c) => c.starred));

  private readonly recentChats = computed(() => this.filteredConversations().filter((c) => !c.starred));

  protected readonly visibleRecentChats = computed(() => this.recentChats());

  protected readonly hasResults = computed(() => this.filteredConversations().length > 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.thinkingTimeout));
  }

  protected onInput(event: Event): void {
    this.inputValue.set((event.target as HTMLInputElement).value);
  }

  protected onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected focusInput(): void {
    this.chatInput()?.nativeElement.focus();
  }

  protected useSuggestion(text: string): void {
    this.inputValue.set(text);
    this.sendMessage();
  }

  protected selectConversation(id: string): void {
    this.activeId.set(id);
    this.isThinking.set(false);
    clearTimeout(this.thinkingTimeout);
  }

  protected toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  protected closeMenu(): void {
    this.openMenuId.set(null);
  }

  protected toggleStar(id: string, event: Event): void {
    event.stopPropagation();
    this.conversations.update((list) =>
      list.map((conversation) =>
        conversation.id === id ? { ...conversation, starred: !conversation.starred } : conversation
      )
    );
    this.closeMenu();
  }

  protected startRename(id: string, event: Event): void {
    event.stopPropagation();
    const conversation = this.conversations().find((c) => c.id === id);
    if (!conversation) return;
    this.renameValue.set(conversation.title);
    this.renamingId.set(id);
    this.closeMenu();
    setTimeout(() => {
      const input = this.renameInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  protected commitRename(): void {
    const id = this.renamingId();
    if (id === null) return;
    const title = this.renameValue().trim();
    if (title) {
      this.conversations.update((list) =>
        list.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation))
      );
    }
    this.renamingId.set(null);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  protected deleteConversation(id: string, event: Event): void {
    event.stopPropagation();
    this.conversations.update((list) => list.filter((conversation) => conversation.id !== id));
    if (this.activeId() === id) {
      this.activeId.set(null);
    }
    this.closeMenu();
  }

  protected sendMessage(): void {
    const text = this.inputValue().trim();
    if (!text || this.isThinking()) return;

    let id = this.activeId();
    if (id === null) {
      id = this.createConversation(text);
      this.activeId.set(id);
    }

    this.appendMessage(id, { role: 'user', text });
    this.inputValue.set('');
    this.isThinking.set(true);

    clearTimeout(this.thinkingTimeout);
    this.thinkingTimeout = setTimeout(() => {
      this.appendMessage(id, { role: 'assistant', text: buildReply(text) });
      this.isThinking.set(false);
    }, THINKING_DELAY_MS);
  }

  protected startNewChat(): void {
    clearTimeout(this.thinkingTimeout);
    this.activeId.set(null);
    this.isThinking.set(false);
    this.inputValue.set('');
    this.focusInput();
  }

  private createConversation(title: string): string {
    const id = `c${this.conversationCounter++}`;
    const conversation: Conversation = { id, title, messages: [], starred: false };
    this.conversations.update((list) => [conversation, ...list]);
    return id;
  }

  private appendMessage(id: string, message: ChatMessage): void {
    this.conversations.update((list) =>
      list.map((conversation) =>
        conversation.id === id ? { ...conversation, messages: [...conversation.messages, message] } : conversation
      )
    );
  }
}

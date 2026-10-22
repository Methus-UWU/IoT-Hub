import { Service, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

import { apiErrorMessage } from '../../../core/models/api-error';
import { AiPlan, ApplyPlanResult, ProjectDiagnostics } from '../../../core/models/project-ai.model';
import { AiConversation, AiConversationsClient, StoredAiMessage } from './ai-conversations.client';
import { ProjectAiService } from './project-ai.service';
import { ProjectFilesClient } from './project-files.client';
import { WorkspaceFileBuffers } from './workspace-file-buffers.store';
import { ProjectCanvasService } from './virtual-device/services/project-canvas.service';
import { CanvasSnapshotCache } from './virtual-device/services/canvas-snapshot-cache';
import { DashboardViewCache } from './dashboard-builder/dashboard-view.cache';

/**
 * The assistant conversation, held outside the page that shows it.
 *
 * A turn takes a minute or more: the model searches the catalog, reads a datasheet, wires
 * the part, reads the sketch and writes it back. Users do not sit and watch that — they
 * switch to the canvas to look at the board, or open another file. Holding the state in
 * an auto-provided service means the request belongs to the application rather than to a
 * view, so navigation is just navigation: the turn finishes, the answer and its plan land
 * here, and whichever page shows the panel next renders them.
 *
 * Conversations are stored on the server, per user and per project (ADR-007). This store
 * caches the open project's list and every conversation already read, so switching back
 * and forth costs no request. A new chat is a local draft until its first question, so
 * opening the panel never creates empty conversations. Each answer is written to the
 * conversation it was asked in, even if the user has opened another one meanwhile.
 *
 * What stays in the page is what only the page knows — which file is open, what the
 * simulator reported, how to refresh the editor after a plan is applied.
 */

/** The key of the not-yet-saved new chat. */
export const DRAFT_CHAT = 'draft';
const LEGACY_SESSION_STORAGE_KEY = 'iot-hub:workspace:ai-sessions:v1';
const GREETING =
  'พร้อมช่วยคุณพัฒนาเฟิร์มแวร์ เซนเซอร์ การต่อวงจร และ Web API วันนี้อยากเริ่มจากอะไร?';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  /** The stored message's id; absent for local notes such as a failed request. */
  serverId?: string;
  /**
   * Changes the assistant proposed in this turn, if any.
   *
   * Kept on the message rather than in a single "pending plan" signal, so scrolling back
   * to an earlier answer still shows what it offered and whether it was taken. A plan is
   * only ever sent back to the server, never acted on here.
   */
  plan?: AiPlan;
  planState?: 'pending' | 'applying' | 'applied' | 'failed';
  planError?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
}

/** What the page knows about the turn and the server cannot see for itself. */
export interface TurnContext {
  readonly projectId: string;
  readonly activeFile?: string;
  readonly diagnostics?: ProjectDiagnostics;
}

const GREETING_MESSAGE: ChatMessage = { id: 'greeting', role: 'assistant', text: GREETING };

let localIds = 0;
function localId(): string {
  return `local-${Date.now()}-${++localIds}`;
}

@Service()
export class ProjectAiChatStore {
  private readonly api = inject(ProjectAiService);
  private readonly conversations = inject(AiConversationsClient);
  private readonly files = inject(ProjectFilesClient);
  private readonly buffers = inject(WorkspaceFileBuffers);
  private readonly canvas = inject(ProjectCanvasService);
  private readonly canvasSnapshots = inject(CanvasSnapshotCache);
  private readonly dashboardViews = inject(DashboardViewCache);
  private readonly document = inject(DOCUMENT);

  private readonly projectId = signal<string | null>(null);
  /** Messages per conversation id, plus the draft. */
  private readonly threads = signal<Record<string, ChatMessage[]>>({});
  /** Conversations whose messages have been read from the server. */
  private readonly loadedThreads = new Set<string>();

  readonly sessions = signal<ChatSession[]>([]);
  readonly activeSessionId = signal<string>(DRAFT_CHAT);
  readonly loadingSessions = signal(false);
  readonly loadingMessages = signal(false);
  readonly sessionsFailed = signal(false);
  /** Unsent text per project, so a half-typed question never follows into another one. */
  private readonly prompts = signal<Record<string, string>>({});
  readonly prompt = computed(() => this.prompts()[this.projectId() ?? ''] ?? '');
  /** Projects with a turn in flight; each project shows only its own. */
  private readonly sendingIn = signal<ReadonlySet<string>>(new Set());
  readonly sending = computed(() => this.sendingIn().has(this.projectId() ?? ''));
  readonly elapsedSeconds = signal(0);
  /** Conversations this tab kept before they moved to the server, not tied to any project. */
  readonly legacySessions = signal<LegacySession[]>(this.readLegacySessions());
  readonly importingLegacy = signal(false);

  /** The greeting is shown first and never sent: it is not something the model said. */
  readonly messages = computed(() => [
    GREETING_MESSAGE,
    ...(this.threads()[this.activeSessionId()] ?? []),
  ]);

  readonly waitingMessage = computed(() => {
    const seconds = this.elapsedSeconds();
    return seconds < 60
      ? `กำลังรอ AI สร้างคำตอบ · ${seconds} วินาที`
      : `ยังรอคำตอบจาก AI · ${seconds} วินาที · ระบบจะหยุดเมื่อครบ 20 นาที`;
  });

  /**
   * The elapsed counter runs here rather than in the panel, so a turn the user walked away
   * from still reports how long it has been waiting when they come back to it.
   */
  private readonly trackWait = effect((onCleanup) => {
    if (!this.sending()) return;
    const startedAt = Date.now();
    this.elapsedSeconds.set(0);
    const timer = setInterval(() => {
      this.elapsedSeconds.set(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  /**
   * Conversations used to live in this tab's sessionStorage, one list shared by every
   * project. Nothing recorded which project each belonged to, so the user chooses: import
   * them into the project open now, or discard them. Until then they are left alone.
   */
  async importLegacy(projectId: string): Promise<number> {
    const legacy = this.legacySessions();
    if (!legacy.length || this.importingLegacy()) return 0;
    this.importingLegacy.set(true);
    let imported = 0;
    try {
      for (const session of legacy) {
        await this.conversations.importConversation(projectId, session);
        imported++;
      }
      this.discardLegacy();
      if (this.projectId() === projectId) await this.loadSessions(projectId);
      return imported;
    } finally {
      // A partial import leaves the rest for another try.
      if (imported < legacy.length) this.legacySessions.set(legacy.slice(imported));
      this.importingLegacy.set(false);
    }
  }

  discardLegacy(): void {
    this.legacySessions.set([]);
    try {
      this.document.defaultView?.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    } catch {
      // Blocked storage has nothing to clean.
    }
  }

  /** Points the store at a project. Its conversations load once per visit to it. */
  useProject(projectId: string): void {
    if (this.projectId() === projectId) return;
    this.projectId.set(projectId);
    this.sessions.set([]);
    this.threads.set({});
    this.loadedThreads.clear();
    this.activeSessionId.set(DRAFT_CHAT);
    void this.loadSessions(projectId);
  }

  setPrompt(text: string): void {
    const projectId = this.projectId();
    if (projectId) this.prompts.update((prompts) => ({ ...prompts, [projectId]: text }));
  }

  startNewSession(): void {
    this.activeSessionId.set(DRAFT_CHAT);
    this.loadingMessages.set(false);
  }

  async openSession(sessionId: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || sessionId === this.activeSessionId()) return;
    this.activeSessionId.set(sessionId);
    if (sessionId === DRAFT_CHAT || this.loadedThreads.has(sessionId)) {
      this.loadingMessages.set(false);
      return;
    }

    this.loadingMessages.set(true);
    try {
      const detail = await this.conversations.get(projectId, sessionId);
      if (this.projectId() !== projectId) return;
      this.loadedThreads.add(sessionId);
      this.setThread(sessionId, detail.messages.map(fromStored));
    } catch {
      this.setThread(sessionId, [
        { id: localId(), role: 'assistant', text: 'โหลดบทสนทนานี้ไม่สำเร็จ ลองเปิดใหม่อีกครั้ง' },
      ]);
    } finally {
      if (this.activeSessionId() === sessionId) this.loadingMessages.set(false);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || sessionId === DRAFT_CHAT) return;
    await this.conversations.remove(projectId, sessionId);
    this.sessions.update((sessions) => sessions.filter((session) => session.id !== sessionId));
    this.threads.update(({ [sessionId]: _removed, ...rest }) => rest);
    this.loadedThreads.delete(sessionId);
    if (this.activeSessionId() === sessionId) this.startNewSession();
  }

  /**
   * Sends the question to the project assistant.
   *
   * The board, the components, the wiring, and the source are read server-side from this
   * project, and so is the conversation's history, so the browser cannot tell the
   * assistant about hardware the project does not have. What the server cannot see
   * arrives in `context`: the file open in the editor and the faults this browser shows.
   */
  async send(
    context: TurnContext,
    collectDiagnostics?: () => Promise<ProjectDiagnostics | undefined>,
  ): Promise<void> {
    const projectId = context.projectId;
    this.useProject(projectId);
    const text = this.prompt().trim();
    if (!text || this.sending()) return;

    let sessionId = this.activeSessionId();
    const question: ChatMessage = { id: localId(), role: 'user', text };
    this.append(sessionId, question);
    this.prompts.update((prompts) => ({ ...prompts, [projectId]: '' }));
    this.sendingIn.update((projects) => new Set([...projects, projectId]));

    try {
      if (sessionId === DRAFT_CHAT) {
        sessionId = await this.saveDraft(projectId);
      }
      // Diagnostics are best effort and must not prevent the conversation from being sent.
      const diagnostics = collectDiagnostics
        ? await collectDiagnostics().catch(() => undefined)
        : context.diagnostics;

      const response = await this.api.chat(projectId, {
        conversationId: sessionId,
        profile: 'balanced',
        messages: [{ role: 'user', content: text }],
        ...(context.activeFile ? { activeFile: context.activeFile } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      });
      if (this.projectId() !== projectId) return;

      this.patchMessage(sessionId, question.id, { serverId: response.userMessageId });
      this.append(sessionId, {
        id: response.messageId ?? localId(),
        serverId: response.messageId,
        role: 'assistant',
        text: response.content,
        ...(response.plan?.actions.length
          ? { plan: response.plan, planState: 'pending' as const }
          : {}),
      });
      this.touchSession(sessionId, text);
    } catch (error: unknown) {
      if (this.projectId() !== projectId) return;
      this.append(sessionId, { id: localId(), role: 'assistant', text: this.errorText(error) });
    } finally {
      this.sendingIn.update((projects) => new Set([...projects].filter((id) => id !== projectId)));
    }
  }

  /**
   * Applies a proposal the user accepted.
   *
   * The actions go back exactly as they arrived. The server re-validates every wire against
   * the project as it stands now, so a proposal that went stale — a part deleted, a wire
   * moved in the canvas tab — is refused rather than applied over the top.
   *
   * The editor's cached copies of the written files are dropped here rather than by the
   * caller, because an apply can land while no page is showing: the invalidation has to
   * happen even when there is nobody to re-render. The result is returned so a page that is
   * still open can reload the tabs it is showing.
   */
  async applyPlan(projectId: string, messageId: string): Promise<ApplyPlanResult | null> {
    const sessionId = this.activeSessionId();
    const message = this.messages().find((item) => item.id === messageId);
    if (!message?.plan || message.planState === 'applying') return null;

    this.patchMessage(sessionId, messageId, { planState: 'applying', planError: undefined });

    try {
      const result = await this.api.apply(projectId, message.plan.actions);
      this.patchMessage(sessionId, messageId, { planState: 'applied' });
      this.recordPlanState(projectId, sessionId, message, 'applied');
      if (result.filesWritten.length) {
        this.files.forget(projectId, result.filesWritten);
        this.buffers.markStale(projectId, result.filesWritten);
      }
      // Layout is cosmetic: the plan has landed either way, so a failed move must
      // not turn an applied plan into a reported failure.
      await this.canvas
        .arrangeNew(projectId, result.createdComponentIds ?? [])
        .catch(() => undefined);
      // The remembered canvas predates the plan; the next visit must load the new circuit.
      this.canvasSnapshots.forget(projectId);
      if (result.dashboardUpdated) this.dashboardViews.forget(projectId);
      return result;
    } catch (error: unknown) {
      const planError = this.errorText(error);
      this.patchMessage(sessionId, messageId, { planState: 'failed', planError });
      this.recordPlanState(projectId, sessionId, message, 'failed', planError);
      return null;
    }
  }

  dismissPlan(messageId: string): void {
    const sessionId = this.activeSessionId();
    const message = this.messages().find((item) => item.id === messageId);
    this.patchMessage(sessionId, messageId, { plan: undefined, planState: undefined });
    const projectId = this.projectId();
    if (message && projectId) this.recordPlanState(projectId, sessionId, message, 'dismissed');
  }

  /** Appends an assistant note the server did not produce, such as a local failure. */
  appendAssistantMessage(text: string): void {
    this.append(this.activeSessionId(), { id: localId(), role: 'assistant', text });
  }

  /** Another account signs in next: nothing of this one may show. */
  reset(): void {
    this.projectId.set(null);
    this.sessions.set([]);
    this.threads.set({});
    this.loadedThreads.clear();
    this.activeSessionId.set(DRAFT_CHAT);
    this.prompts.set({});
  }

  private async loadSessions(projectId: string): Promise<void> {
    this.loadingSessions.set(true);
    this.sessionsFailed.set(false);
    try {
      const list = await this.conversations.list(projectId);
      if (this.projectId() !== projectId) return;
      this.sessions.set(list.map(toSession));
      // Reopen the most recent conversation, unless a question is already under way.
      if (list[0] && this.activeSessionId() === DRAFT_CHAT && !this.threads()[DRAFT_CHAT]?.length) {
        await this.openSession(list[0].id);
      }
    } catch {
      if (this.projectId() === projectId) this.sessionsFailed.set(true);
    } finally {
      if (this.projectId() === projectId) this.loadingSessions.set(false);
    }
  }

  /** Turns the draft into a stored conversation on its first question. */
  private async saveDraft(projectId: string): Promise<string> {
    const created = await this.conversations.create(projectId, null);
    const draft = this.threads()[DRAFT_CHAT] ?? [];
    this.threads.update(({ [DRAFT_CHAT]: _draft, ...rest }) => ({ ...rest, [created.id]: draft }));
    this.loadedThreads.add(created.id);
    this.sessions.update((sessions) => [toSession(created), ...sessions]);
    if (this.activeSessionId() === DRAFT_CHAT) this.activeSessionId.set(created.id);
    return created.id;
  }

  private recordPlanState(
    projectId: string,
    sessionId: string,
    message: ChatMessage,
    state: 'applied' | 'failed' | 'dismissed',
    error?: string,
  ): void {
    if (!message.serverId || sessionId === DRAFT_CHAT) return;
    // Best effort: the project change itself already happened or failed on the server.
    void this.conversations
      .setPlanState(projectId, sessionId, message.serverId, state, error)
      .catch(() => undefined);
  }

  private append(sessionId: string, message: ChatMessage): void {
    this.threads.update((threads) => ({
      ...threads,
      [sessionId]: [...(threads[sessionId] ?? []), message],
    }));
  }

  private setThread(sessionId: string, messages: ChatMessage[]): void {
    this.threads.update((threads) => ({ ...threads, [sessionId]: messages }));
  }

  private patchMessage(sessionId: string, messageId: string, patch: Partial<ChatMessage>): void {
    this.threads.update((threads) => ({
      ...threads,
      [sessionId]: (threads[sessionId] ?? []).map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      ),
    }));
  }

  /** Moves the conversation to the top, named after its first question. */
  private touchSession(sessionId: string, question: string): void {
    this.sessions.update((sessions) => {
      const current = sessions.find((session) => session.id === sessionId);
      if (!current) return sessions;
      const updated = {
        ...current,
        title: current.title || question.replace(/\s+/g, ' ').slice(0, 60),
        updatedAt: Date.now(),
      };
      return [updated, ...sessions.filter((session) => session.id !== sessionId)];
    });
  }

  private errorText(error: unknown): string {
    const message = apiErrorMessage(error);
    if (message) return message;
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'ต่อกับเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้งภายหลัง';
      if (error.status === 429) return 'ใช้งานผู้ช่วยถี่เกินไป รอสักครู่แล้วลองใหม่';
    }
    return 'ผู้ช่วยตอบไม่สำเร็จ ลองอีกครั้ง';
  }

  private readLegacySessions(): LegacySession[] {
    try {
      return parseLegacySessions(
        this.document.defaultView?.sessionStorage.getItem(LEGACY_SESSION_STORAGE_KEY),
      );
    } catch {
      return [];
    }
  }
}

export interface LegacySession {
  title: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

/** Old sessions with at least one question, as the import endpoint takes them. */
export function parseLegacySessions(raw: string | null | undefined): LegacySession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { sessions?: unknown };
    if (!Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.flatMap((value: unknown) => {
      const session = value as { title?: unknown; messages?: unknown };
      if (!Array.isArray(session.messages)) return [];
      const messages = session.messages
        .map((entry: unknown) => entry as { role?: unknown; text?: unknown })
        .filter(
          (entry) =>
            (entry.role === 'user' || entry.role === 'assistant') &&
            typeof entry.text === 'string' &&
            entry.text.trim() !== '' &&
            entry.text !== GREETING,
        )
        .map((entry) => ({
          role: entry.role as 'user' | 'assistant',
          content: (entry.text as string).slice(0, 12_000),
        }))
        .slice(-200);
      if (!messages.some((message) => message.role === 'user')) return [];
      const title = typeof session.title === 'string' ? session.title.slice(0, 80) : '';
      return [{ title: title === 'แชทใหม่' ? '' : title, messages }];
    });
  } catch {
    return [];
  }
}

function toSession(conversation: AiConversation): ChatSession {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: Date.parse(conversation.updatedAt) || Date.now(),
  };
}

function fromStored(message: StoredAiMessage): ChatMessage {
  const showsPlan = message.plan !== null && message.planState !== 'dismissed';
  return {
    id: message.id,
    serverId: message.id,
    role: message.role,
    text: message.content,
    ...(showsPlan
      ? {
          plan: message.plan ?? undefined,
          planState:
            message.planState === 'dismissed' ? undefined : (message.planState ?? 'pending'),
          ...(message.planError ? { planError: message.planError } : {}),
        }
      : {}),
  };
}

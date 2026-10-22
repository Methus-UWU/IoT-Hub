import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AiPlan } from '../../../core/models/project-ai.model';
import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { FileIcon } from '../../../shared/components/file-icon/file-icon';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { ProjectStore } from '../projects/project.store';
import { EditorCursorPosition, MonacoCodeEditor } from './monaco-code-editor';
import { MonacoModelCache } from './monaco-model.cache';
import { DRAFT_CHAT, ProjectAiChatStore } from './project-ai-chat.store';
import { ProjectDiagnosticsService } from './project-diagnostics.service';
import { pickEntryFile } from './project-entry-file';
import { ProjectFileConflictError, ProjectFilesClient } from './project-files.client';
import { FirmwareStore, FirmwareTask } from './firmware/firmware.store';
import { SERIAL_BAUD_RATES } from './firmware/serial-session.store';
import { ADD_PORT_VALUE, REFRESH_PORTS_VALUE, buildPortOptions } from './firmware/port-options';
import { isSerialPermissionError, portMismatchesBoard } from './firmware/web-serial';
import { WorkspaceSkeleton } from './workspace-skeleton';
import { aiSetupPrompt } from './ai-setup-prompt';
import { WorkspaceFileBuffers } from './workspace-file-buffers.store';
import { AiAssistantAvatar } from './ai-assistant-avatar';
import { LibraryManager } from './library-manager/library-manager';
import { withoutManagedLibraries } from './library-manager/library-files';

type WorkspaceView = 'dashboard' | 'ide';
type DeployState = 'idle' | 'building' | 'live';
type BackendStatus = 'checking' | 'online' | 'offline';
type ExecutionTarget = 'simulation' | 'hardware';
type BottomPanelTab = 'build' | 'serial';
type EditorLanguage = 'cpp' | 'python' | 'config';
type SaveFailure = 'offline' | 'conflict' | 'rejected';

interface PendingTabDrag {
  filename: string;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  top: number;
  width: number;
}

interface TabDragPreview {
  filename: string;
  left: number;
  top: number;
  width: number;
}

interface PendingAutoSave {
  projectId: string;
  filename: string;
  timer: ReturnType<typeof setTimeout>;
}

const EXECUTION_TARGET_STORAGE_KEY = 'iot-hub:workspace:execution-target';

const ARDUINO_CODE = [
  'void setup() {',
  '  Serial.begin(115200);',
  '}',
  '',
  'void loop() {',
  '',
  '}',
];

const MANUAL_ARDUINO_CODE = ['void setup() {', '', '}', '', 'void loop() {', '', '}'];

const EMPTY_FILE = [''];

@Component({
  selector: 'app-project-workspace-page',
  imports: [
    AiAssistantAvatar,
    CustomSelect,
    FileIcon,
    LibraryManager,
    MarkdownPipe,
    MonacoCodeEditor,
    RouterLink,
    WorkspaceSkeleton,
  ],
  // Build polling is page-scoped; the hardware serial session lives in the user shell.
  providers: [FirmwareStore],
  templateUrl: './project-workspace.page.html',
  styleUrls: [
    './project-workspace.page.css',
    './project-workspace.serial.css',
    './project-workspace.ai.css',
  ],
  host: {
    '(document:click)': 'handleToolbarDocumentClick($event)',
    '(document:keydown.escape)': 'cancelFileDeletion()',
  },
})
export class ProjectWorkspacePage {
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectStore = inject(ProjectStore);
  private readonly projectFiles = inject(ProjectFilesClient);
  protected readonly chat = inject(ProjectAiChatStore);
  private readonly diagnostics = inject(ProjectDiagnosticsService);
  // Builds run on the server; flashing and the serial monitor use Web Serial in this browser.
  protected readonly firmware = inject(FirmwareStore);
  // Text, unsaved state, and Monaco models outlive this page, so switching tabs keeps them.
  private readonly buffers = inject(WorkspaceFileBuffers);
  private readonly editorModels = inject(MonacoModelCache);
  /** Pending autosave per `projectId:filename`. Flushed, never dropped, when the page goes. */
  private readonly autoSaveTimers = new Map<string, PendingAutoSave>();
  private readonly serialOutputElement = viewChild<ElementRef<HTMLElement>>('serialOutput');
  private readonly deleteDialogCancel =
    viewChild<ElementRef<HTMLButtonElement>>('deleteDialogCancel');
  /** Project whose tab order this page instance has built. */
  private tabsBuiltFor: string | null = null;
  /** Project whose remembered board was looked up; ports are re-read per project. */
  private portsLoadedFor: string | null = null;
  /** Why the last server save failed, so the IDE says what happened instead of "offline". */
  private lastSaveFailure: SaveFailure | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private pendingTabDrag: PendingTabDrag | null = null;
  private suppressTabClick: string | null = null;

  // The conversation itself lives in [ProjectAiChatStore] so a turn survives leaving this
  // page. What is aliased here is read by the template; the menus below are view state.
  protected readonly chatSessions = this.chat.sessions;
  protected readonly activeSessionId = this.chat.activeSessionId;
  protected readonly messages = this.chat.messages;
  protected readonly prompt = this.chat.prompt;
  protected readonly sending = this.chat.sending;
  protected readonly aiWaitingMessage = this.chat.waitingMessage;
  protected readonly assistantName = 'IoT Hub AI';
  protected readonly sessionMenuCloseRequest = signal(0);
  protected readonly loadingSessions = this.chat.loadingSessions;
  protected readonly loadingMessages = this.chat.loadingMessages;
  protected readonly isDraftChat = computed(() => this.activeSessionId() === DRAFT_CHAT);
  protected readonly chatSessionOptions = computed<CustomSelectOption[]>(() => {
    const dateFormat = new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return this.chatSessions().map((session) => ({
      value: session.id,
      label: session.title,
      description: `อัปเดต ${dateFormat.format(session.updatedAt)}`,
    }));
  });
  protected readonly aiOpen = signal(true);
  protected readonly aiPanelWidth = signal(this.readPanelWidth());
  protected readonly resizingAi = signal(false);
  protected readonly toolbarMenuOpen = signal(false);
  protected readonly librariesOpen = signal(false);
  protected readonly executionTarget = signal<ExecutionTarget>(this.readExecutionTarget());
  protected readonly deviceMenuCloseRequest = signal(0);
  protected readonly draggedFile = signal<string | null>(null);
  protected readonly tabDragPreview = signal<TabDragPreview | null>(null);
  protected readonly consoleOpen = signal(true);
  protected readonly openedFiles = signal<string[]>([]);
  protected readonly pendingDeleteFile = signal<string | null>(null);
  protected readonly cursorLine = signal(1);
  protected readonly cursorColumn = signal(1);
  /** Hydrating the project's files before the first automatic turn. Page work, not a turn. */
  protected readonly preparingAiSetup = signal(false);
  protected readonly deployState = signal<DeployState>('idle');
  protected readonly buildState = this.firmware.buildState;
  protected readonly activeFirmwareTask = this.firmware.activeTask;
  protected readonly buildLogs = this.firmware.logs;
  protected readonly bottomPanelTab = signal<BottomPanelTab>('build');
  protected readonly selectedPort = this.firmware.selectedPortId;
  protected readonly serialState = this.firmware.serialState;
  protected readonly serialBaud = this.firmware.serialBaud;
  protected readonly serialBaudOptions: readonly CustomSelectOption[] = SERIAL_BAUD_RATES.map(
    (baud) => ({ value: String(baud), label: String(baud) }),
  );
  protected readonly serialLines = this.firmware.serialLines;
  protected readonly serialTimestamp = signal(true);
  protected readonly serialAutoScroll = signal(true);
  protected readonly backendStatus = signal<BackendStatus>('checking');
  protected readonly notice = signal('All changes saved');

  private readonly viewSignal = toSignal(
    this.route.data.pipe(
      map((data): WorkspaceView => (data['workspaceView'] === 'dashboard' ? 'dashboard' : 'ide')),
    ),
    { initialValue: 'ide' as WorkspaceView },
  );
  private readonly projectIdSignal = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('projectId'))),
    { initialValue: this.route.snapshot.parent?.paramMap.get('projectId') ?? null },
  );
  private readonly requestedFile = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('file'))),
    { initialValue: this.route.snapshot.queryParamMap.get('file') },
  );

  protected readonly view = computed(() => this.viewSignal());
  protected readonly projectId = computed(() => this.projectIdSignal());
  protected readonly project = computed(() => this.projectStore.projectById(this.projectId()));
  protected readonly projectsLoading = this.projectStore.loading;
  protected readonly projectsLoaded = this.projectStore.hasLoaded;
  protected readonly projectLoadError = this.projectStore.error;
  private readonly fileStates = computed(() => this.buffers.filesOf(this.projectId()));
  /** Project whose server file list has been fetched (or failed to), so tabs can be built. */
  private readonly filesLoadedFor = signal<string | null>(null);
  private fileListRequestedFor: string | null = null;
  /**
   * A requested file that the project no longer has (deleted, stale link) falls back
   * to the sketch — `src/main.cpp` in a PlatformIO project — rather than to whatever
   * sorts first, which would be `platformio.ini`.
   */
  protected readonly activeFilename = computed(() => {
    const files = this.project()?.files ?? [];
    const requested = this.requestedFile();
    if (requested && (files.length === 0 || files.includes(requested))) return requested;
    return pickEntryFile(files) ?? files[0] ?? 'main.ino';
  });
  protected readonly editorLanguage = computed<EditorLanguage>(() =>
    this.activeFilename().endsWith('.py')
      ? 'python'
      : this.activeFilename().endsWith('.ini')
        ? 'config'
        : 'cpp',
  );
  protected readonly activeModelPath = computed(
    () => `${this.projectId() ?? 'project'}/${this.activeFilename()}`,
  );
  protected readonly code = computed(() => this.fileStates()[this.activeFilename()]?.content ?? '');
  /** The active file has text to show. Until then the editor area shows a code skeleton. */
  protected readonly codeReady = computed(
    () =>
      this.filesLoadedFor() === this.projectId() &&
      this.fileStates()[this.activeFilename()] !== undefined,
  );
  /** Monaco has finished starting (or failed to), so it no longer draws its own loader. */
  protected readonly editorSettled = signal(false);
  /** Project whose first IDE load finished; later loads never bring the page skeleton back. */
  private readonly openedFor = signal<string | null>(null);
  /**
   * Opening the IDE shows one skeleton until the code, the editor and the assistant are
   * all ready, instead of the shell arriving first and each part loading in its own place.
   */
  protected readonly pageLoading = computed(
    () => this.view() === 'ide' && this.openedFor() !== this.projectId(),
  );
  private readonly finishOpening = effect(() => {
    const projectId = this.projectId();
    if (!projectId || !this.pageLoading()) return;
    if (!this.codeReady() || !this.editorSettled()) return;
    if (this.loadingSessions() || this.loadingMessages()) return;
    this.openedFor.set(projectId);
  });
  /** Files an accepted AI plan rewrites, from the click until their new text is loaded. */
  private readonly rewritingFiles = signal<ReadonlySet<string>>(new Set());
  /** An accepted AI plan is writing source files; the editor stays mounted but read-only. */
  protected readonly applyingCode = computed(
    () =>
      this.rewritingFiles().size > 0 ||
      this.messages().some(
        (message) =>
          message.planState === 'applying' &&
          message.plan?.actions.some((action) => action.type === 'write_file'),
      ),
  );
  /**
   * The open file is one the plan rewrites. Its old text is about to be replaced, so the
   * code area shows a skeleton until the new text arrives instead of the stale version.
   */
  protected readonly rewritingActiveFile = computed(() =>
    this.rewritingFiles().has(this.activeFilename()),
  );
  protected readonly isDirty = computed(() => this.tabIsDirty(this.activeFilename()));
  protected readonly canDeleteFiles = computed(() => (this.project()?.files.length ?? 0) > 1);
  protected readonly languageLabel = computed(() =>
    this.activeFilename().endsWith('.py')
      ? 'MicroPython'
      : this.activeFilename().endsWith('.ini')
        ? 'Configuration'
        : 'Arduino C++',
  );
  protected readonly deployLabel = computed(() => {
    if (this.deployState() === 'building') return 'Building…';
    if (this.deployState() === 'live') return 'Deployed';
    return 'Deploy';
  });
  // "Compile" is the firmware step (it needs no board); "Upload" compiles and then flashes.
  protected readonly buildLabel = computed(() =>
    this.buildState() === 'building' && this.activeFirmwareTask() === 'build'
      ? 'Compiling…'
      : 'Compile',
  );
  protected readonly uploadLabel = computed(() => {
    if (this.buildState() !== 'building' || this.activeFirmwareTask() !== 'upload') return 'Upload';
    const progress = this.firmware.progress();
    return progress === null ? 'Compiling…' : `Uploading ${progress}%`;
  });
  protected readonly monitorLabel = computed(() =>
    this.serialState() === 'connected' ? 'Disconnect' : 'Monitor',
  );
  protected readonly buildStatusLabel = computed(() => {
    const upload = this.activeFirmwareTask() === 'upload';
    if (this.buildState() === 'building') return upload ? 'Uploading…' : 'Compiling…';
    if (this.buildState() === 'success') {
      return upload ? 'Upload successful' : 'Compilation successful';
    }
    if (this.buildState() === 'error') return upload ? 'Upload failed' : 'Compilation failed';
    return 'Ready';
  });
  protected readonly deviceOptions = computed<readonly CustomSelectOption[]>(() =>
    buildPortOptions({
      unavailableReason: this.firmware.unavailableReason,
      ports: this.firmware.ports(),
      selectedPortId: this.selectedPort(),
      selectedPortMissing: this.firmware.selectedPortMissing(),
      selectedPortLabel: this.firmware.selectedPortLabel(),
      board: this.project()?.board ?? '',
    }),
  );
  protected readonly serialStatusLabel = computed(() => {
    if (this.executionTarget() === 'simulation') return 'Physical device only';
    if (this.firmware.selectedPortMissing()) return 'Disconnected · เสียบบอร์ดอีกครั้ง';
    if (this.serialState() === 'connecting') return 'Connecting…';
    if (this.serialState() === 'connected') {
      return `Connected · ${this.firmware.selectedPort()?.label ?? ''}`;
    }
    if (this.serialState() === 'error') return 'Connection failed';
    return 'Disconnected';
  });
  protected readonly backendStatusLabel = computed(() => {
    if (this.backendStatus() === 'online') return 'Workspace synced';
    if (this.backendStatus() === 'offline') return 'Local mode';
    return 'Connecting';
  });

  /**
   * Fetches the project's file list once per opened project.
   *
   * Until it arrives the active file is a guess, and hydrating a guessed name that the
   * server does not have would create it — a stray `main.ino` beside the project's
   * real sketch. A failed fetch still releases the editor, which then runs in local mode.
   */
  private readonly loadFileList = effect(() => {
    const projectId = this.projectId();
    if (!projectId || !this.project() || this.fileListRequestedFor === projectId) return;
    // Loading patches the project signal this effect reads; the guard stops that
    // update from starting a second fetch.
    this.fileListRequestedFor = projectId;
    untracked(() => {
      // Coming back from another project tab: the list is already in the project store.
      // Fetching it again is what used to hold the editor blank on every return.
      if (this.buffers.isListed(projectId) && (this.project()?.files.length ?? 0) > 0) {
        this.filesLoadedFor.set(projectId);
        return;
      }
      void this.projectStore
        .loadFiles(projectId)
        .catch(() => undefined)
        .finally(() => {
          this.buffers.markListed(projectId);
          if (this.projectId() === projectId) this.filesLoadedFor.set(projectId);
        });
    });
  });

  private readonly loadActiveFile = effect(() => {
    const projectId = this.projectId();
    const filename = this.activeFilename();
    const setupMode = this.project()?.setupMode;
    if (!projectId || !setupMode || this.filesLoadedFor() !== projectId) return;

    // Untracked: this reacts to the file and project changing, not to every keystroke.
    untracked(() => {
      if (this.tabsBuiltFor !== projectId) {
        if (this.tabsBuiltFor) this.flushAutoSaves();
        // Another project's text and models must not linger in this one's editor.
        this.buffers.retainProject(projectId);
        this.editorModels.retain(`${projectId}/`);
        // The tab bar is the file list now, so every project file gets a tab. Stored
        // tabs only carry the order the user dragged them into.
        // Installed libraries are the Library Manager's, not tabs to edit.
        const projectFiles = withoutManagedLibraries(this.project()?.files ?? []);
        const storedOrder = this.readStoredTabs(projectId);
        this.openedFiles.set([
          ...storedOrder.filter((file) => projectFiles.includes(file)),
          ...projectFiles.filter((file) => !storedOrder.includes(file)),
        ]);
        this.tabsBuiltFor = projectId;
      }

      void this.ensureFileState(projectId, filename, setupMode);
      this.openedFiles.update((files) => (files.includes(filename) ? files : [...files, filename]));
      this.storeTabs();
      this.notice.set(this.tabIsDirty(filename) ? 'Unsaved changes' : 'All changes saved');
    });
  });

  /** The assistant panel shows this project's conversations. */
  private readonly syncAssistant = effect(() => {
    const projectId = this.projectId();
    if (!projectId) return;
    untracked(() => this.chat.useProject(projectId));
  });

  private readonly startCreatedProjectAi = effect(() => {
    const project = this.project();
    if (!project || this.view() !== 'ide' || this.filesLoadedFor() !== project.id) return;
    if (this.projectStore.takeAiSetupRequest(project.id)) {
      untracked(() => void this.generateFromDescription());
    }
  });

  /** Destructive dialog opens on the safe choice. */
  private readonly focusDeleteDialog = effect(() => {
    if (!this.pendingDeleteFile()) return;
    this.deleteDialogCancel()?.nativeElement.focus();
  });

  /** Ports this site may already use, listed once hardware is chosen; no prompt is shown. */
  private readonly loadPorts = effect(() => {
    const projectId = this.projectId();
    if (this.view() !== 'ide' || this.executionTarget() !== 'hardware') return;
    if (!projectId || this.portsLoadedFor === projectId) return;
    this.portsLoadedFor = projectId;
    untracked(async () => {
      await this.firmware.refreshPorts();
      // The board this project was last uploaded to, if it is plugged in.
      if (this.projectId() === projectId) {
        await this.firmware.preferPort(this.readStoredPort(projectId));
      }
    });
  });

  private readonly followSerialOutput = effect(() => {
    this.serialOutputElement();
    this.consoleOpen();
    this.serialAutoScroll();
    if (this.serialLines().length > 0) untracked(() => this.scrollSerialOutput());
  });

  constructor() {
    // Leaving the IDE must not cost the edit typed a moment ago: save it now instead of
    // dropping its timer. The buffer itself stays in the store either way.
    this.destroyRef.onDestroy(() => this.flushAutoSaves());
  }

  protected handleSessionMenuOpen(open: boolean): void {
    if (!open) return;
    this.toolbarMenuOpen.set(false);
    this.closeDeviceMenu();
  }

  protected closeAiMenus(): void {
    this.sessionMenuCloseRequest.update((request) => request + 1);
  }

  protected startNewChatSession(): void {
    this.chat.startNewSession();
    this.closeAiMenus();
  }

  protected openChatSession(sessionId: string): void {
    void this.chat.openSession(sessionId);
    this.closeAiMenus();
  }

  protected readonly legacySessions = this.chat.legacySessions;
  protected readonly importingLegacy = this.chat.importingLegacy;

  protected async importLegacyChats(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    try {
      const count = await this.chat.importLegacy(projectId);
      this.notice.set(`นำแชทเก่า ${count} รายการเข้าโปรเจกต์นี้แล้ว`);
    } catch {
      this.notice.set('นำแชทเก่าเข้าไม่สำเร็จ ลองอีกครั้ง');
    }
  }

  protected discardLegacyChats(): void {
    this.chat.discardLegacy();
    this.notice.set('ทิ้งแชทเก่าแล้ว');
  }

  protected async deleteChatSession(): Promise<void> {
    const sessionId = this.activeSessionId();
    if (sessionId === DRAFT_CHAT) return;
    try {
      await this.chat.deleteSession(sessionId);
      this.notice.set('ลบบทสนทนาแล้ว');
    } catch {
      this.notice.set('ลบบทสนทนาไม่สำเร็จ');
    }
  }

  protected toggleToolbarMenu(event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = !this.toolbarMenuOpen();
    this.closeAiMenus();
    if (willOpen) this.closeDeviceMenu();
    this.toolbarMenuOpen.set(willOpen);
  }

  protected handleDeviceMenuOpen(open: boolean): void {
    if (!open) return;
    this.closeAiMenus();
    this.toolbarMenuOpen.set(false);
  }

  protected handleToolbarDocumentClick(event: Event): void {
    if (!this.toolbarMenuOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.toolbar-more')) return;
    this.toolbarMenuOpen.set(false);
  }

  protected openFile(filename: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { file: filename },
      queryParamsHandling: 'merge',
    });
  }

  protected handleFileTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabList = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
    const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    if (currentIndex < 0 || tabs.length === 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  protected handleFileTabClick(filename: string, event: MouseEvent): void {
    if (this.suppressTabClick === filename) {
      event.preventDefault();
      return;
    }
    this.openFile(filename);
  }

  protected prepareFileDrag(filename: string, event: PointerEvent): void {
    const target = event.target;
    if (event.button !== 0 || (target instanceof Element && target.closest('.editor-tab-close'))) {
      return;
    }
    const tab = event.currentTarget as HTMLElement;
    const bounds = tab.getBoundingClientRect();
    this.pendingTabDrag = {
      filename,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      top: bounds.top,
      width: bounds.width,
    };
    // Capture is claimed when the drag actually starts. Capturing here would retarget
    // the click to this wrapper, so the tab button would never open the file.
  }

  protected moveFileDrag(event: PointerEvent): void {
    const pending = this.pendingTabDrag;
    if (!pending || pending.pointerId !== event.pointerId) return;

    if (!this.tabDragPreview()) {
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance < 5) return;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      this.draggedFile.set(pending.filename);
      this.suppressTabClick = pending.filename;
    }

    event.preventDefault();
    const tabList = (event.currentTarget as HTMLElement).parentElement;
    if (!tabList) return;
    const listBounds = tabList.getBoundingClientRect();
    const left = Math.min(
      listBounds.right - pending.width,
      Math.max(listBounds.left, event.clientX - pending.offsetX),
    );
    this.tabDragPreview.set({
      filename: pending.filename,
      left,
      top: pending.top,
      width: pending.width,
    });
    this.reorderTabsAtPointer(pending.filename, event.clientX, tabList);
  }

  protected finishFileDrag(event: PointerEvent): void {
    if (!this.pendingTabDrag || this.pendingTabDrag.pointerId !== event.pointerId) return;
    const tab = event.currentTarget as HTMLElement;
    if (tab.hasPointerCapture(event.pointerId)) tab.releasePointerCapture(event.pointerId);
    const wasDragging = Boolean(this.tabDragPreview());
    this.pendingTabDrag = null;
    this.draggedFile.set(null);
    this.tabDragPreview.set(null);
    if (wasDragging) this.storeTabs();
    this.document.defaultView?.setTimeout(() => (this.suppressTabClick = null));
  }

  /** Closing a tab removes the file, so it always goes through the confirmation dialog. */
  protected requestFileDeletion(filename: string, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canDeleteFiles()) {
      this.notice.set('A project needs at least one file');
      return;
    }
    this.pendingDeleteFile.set(filename);
  }

  protected cancelFileDeletion(): void {
    this.pendingDeleteFile.set(null);
  }

  protected confirmFileDeletion(): void {
    const filename = this.pendingDeleteFile();
    const projectId = this.projectId();
    this.pendingDeleteFile.set(null);
    if (!filename || !projectId) return;

    const currentFiles = this.openedFiles();
    const remainingFiles = currentFiles.filter((file) => file !== filename);
    const fallback =
      remainingFiles[Math.min(currentFiles.indexOf(filename), remainingFiles.length - 1)];
    if (filename === this.activeFilename() && fallback) this.openFile(fallback);

    if (!this.projectStore.unregisterFile(projectId, filename)) {
      this.notice.set('A project needs at least one file');
      return;
    }
    this.openedFiles.set(remainingFiles);
    this.storeTabs();
    this.discardFileState(projectId, filename);
    this.notice.set(`Deleted ${filename}`);
    void this.deleteRemoteFile(projectId, filename);
  }

  private async deleteRemoteFile(projectId: string, filename: string): Promise<void> {
    try {
      await this.projectFiles.delete(projectId, filename);
      this.backendStatus.set('online');
    } catch (error: unknown) {
      // A file that only ever existed in this browser is already gone remotely.
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.backendStatus.set('online');
        return;
      }
      this.backendStatus.set('offline');
      this.notice.set(`Deleted ${filename} locally · Backend unavailable`);
    }
  }

  private discardFileState(projectId: string, filename: string): void {
    this.cancelAutoSave(projectId, filename);
    this.buffers.remove(projectId, filename);
    this.editorModels.dispose(`${projectId}/${filename}`);
    try {
      this.document.defaultView?.localStorage.removeItem(this.fileStorageKey(projectId, filename));
    } catch {
      // The file is gone from the workspace either way; storage cleanup is best effort.
    }
  }

  protected requestNewFile(): void {
    const projectId = this.projectId();
    if (projectId) this.projectStore.requestFileCreation(projectId);
  }

  protected tabIsDirty(filename: string): boolean {
    const state = this.fileStates()[filename];
    return Boolean(state && state.content !== state.savedContent);
  }

  protected toggleAiPanel(): void {
    this.closeDeviceMenu();
    this.toolbarMenuOpen.set(false);
    if (this.aiOpen()) this.closeAiMenus();
    this.aiOpen.update((open) => !open);
  }

  protected closeAiPanel(): void {
    this.closeAiMenus();
    this.aiOpen.set(false);
  }

  private closeDeviceMenu(): void {
    this.deviceMenuCloseRequest.update((request) => request + 1);
  }

  private reorderTabsAtPointer(
    draggedFilename: string,
    pointerX: number,
    tabList: HTMLElement,
  ): void {
    const currentFiles = this.openedFiles();
    const remainingFiles = currentFiles.filter((file) => file !== draggedFilename);
    const tabElements = Array.from(tabList.querySelectorAll<HTMLElement>('.editor-tab'));
    let insertionIndex = remainingFiles.length;
    for (let index = 0; index < remainingFiles.length; index += 1) {
      const tab = tabElements.find(
        (element) => element.dataset['filename'] === remainingFiles[index],
      );
      if (!tab) continue;
      const bounds = tab.getBoundingClientRect();
      if (pointerX < bounds.left + bounds.width / 2) {
        insertionIndex = index;
        break;
      }
    }

    const reordered = [...remainingFiles];
    reordered.splice(insertionIndex, 0, draggedFilename);
    if (reordered.some((file, index) => file !== currentFiles[index])) {
      this.openedFiles.set(reordered);
    }
  }

  protected beginAiResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.aiPanelWidth();
    this.resizingAi.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected resizeAiPanel(event: PointerEvent, layout: HTMLElement): void {
    if (!this.resizingAi()) return;
    const nextWidth = this.resizeStartWidth + (this.resizeStartX - event.clientX);
    this.aiPanelWidth.set(this.constrainPanelWidth(nextWidth, layout));
  }

  protected finishAiResize(event: PointerEvent): void {
    if (!this.resizingAi()) return;
    this.resizingAi.set(false);
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    this.storePanelWidth();
  }

  protected resizeAiWithKeyboard(event: KeyboardEvent, layout: HTMLElement): void {
    const bounds = this.panelWidthBounds(layout);
    let width = this.aiPanelWidth();
    if (event.key === 'ArrowLeft') width += 24;
    else if (event.key === 'ArrowRight') width -= 24;
    else if (event.key === 'Home') width = bounds.min;
    else if (event.key === 'End') width = bounds.max;
    else return;

    event.preventDefault();
    this.aiPanelWidth.set(Math.min(bounds.max, Math.max(bounds.min, width)));
    this.storePanelWidth();
  }

  protected resetAiPanelWidth(layout: HTMLElement): void {
    this.aiPanelWidth.set(this.constrainPanelWidth(352, layout));
    this.storePanelWidth();
  }

  protected updateCode(value: string): void {
    const projectId = this.projectId();
    const filename = this.activeFilename();
    if (!projectId) return;
    this.buffers.patch(projectId, filename, (state) =>
      state.content === value ? state : { ...state, content: value },
    );
    this.notice.set('Unsaved changes · Auto-saving…');
    this.scheduleAutoSave(projectId, filename);
  }

  protected updateCursor(position: EditorCursorPosition): void {
    this.cursorLine.set(position.line);
    this.cursorColumn.set(position.column);
  }

  protected saveFile(filename = this.activeFilename(), automatic = false): Promise<boolean> {
    const projectId = this.projectId();
    return projectId ? this.persistFile(projectId, filename, automatic) : Promise.resolve(false);
  }

  /**
   * Saves one buffer to this browser and then the server.
   *
   * Takes the project explicitly, because a flushed autosave can run after the page moved
   * to another project or was destroyed.
   */
  private async persistFile(
    projectId: string,
    filename: string,
    automatic = false,
  ): Promise<boolean> {
    const state = this.buffers.filesOf(projectId)[filename];
    if (!state) return false;
    this.cancelAutoSave(projectId, filename);
    const isActive = () => projectId === this.projectId() && filename === this.activeFilename();

    try {
      this.document.defaultView?.localStorage.setItem(
        this.fileStorageKey(projectId, filename),
        state.content,
      );
      this.buffers.patch(projectId, filename, (current) => ({
        ...current,
        savedContent: state.content,
      }));
      if (isActive()) {
        this.notice.set(automatic ? 'Saving to workspace…' : 'Saving…');
      }
    } catch {
      this.notice.set('Could not save in this browser');
    }

    try {
      await this.projectFiles.save(projectId, filename, state.content);
      this.backendStatus.set('online');
      if (isActive()) {
        this.notice.set(automatic ? 'Auto-saved to workspace' : 'Saved to workspace');
      }
      return true;
    } catch (error: unknown) {
      // Only an unreachable server is "offline". A conflict or a refused write comes from a
      // server that answered, and calling it offline sent users chasing the network.
      const failure: SaveFailure =
        error instanceof ProjectFileConflictError
          ? 'conflict'
          : error instanceof HttpErrorResponse && error.status !== 0
            ? 'rejected'
            : 'offline';
      this.lastSaveFailure = failure;
      this.backendStatus.set(failure === 'offline' ? 'offline' : 'online');
      if (isActive()) {
        this.notice.set(
          failure === 'conflict'
            ? `${filename} ถูกแก้จากที่อื่น · รีเฟรชหน้าเพื่อโหลดเวอร์ชันล่าสุด`
            : failure === 'rejected'
              ? 'Saved locally · เซิร์ฟเวอร์ไม่รับการบันทึก'
              : 'Saved locally · Backend unavailable',
        );
      }
      return false;
    }
  }

  protected async buildProject(): Promise<void> {
    await this.runFirmwareTask('build');
  }

  protected async selectExecutionTarget(target: ExecutionTarget): Promise<void> {
    if (target === this.executionTarget() || this.buildState() === 'building') return;

    if (target === 'simulation') {
      await this.firmware.disconnectMonitor();
    }

    this.executionTarget.set(target);
    if (target === 'hardware' && this.bottomPanelTab() === 'serial') {
      void this.firmware.connectMonitor();
    }
    this.closeDeviceMenu();
    try {
      this.document.defaultView?.localStorage.setItem(EXECUTION_TARGET_STORAGE_KEY, target);
    } catch {
      // The choice remains active for this session when browser storage is unavailable.
    }

    this.notice.set(
      target === 'simulation'
        ? 'เลือกอุปกรณ์จำลอง · เปิด Simulator เพื่อทดสอบวงจร'
        : 'เลือกอุปกรณ์จริง · เชื่อมต่อบอร์ดและเลือกพอร์ต USB',
    );
  }

  protected openSimulator(): void {
    const projectId = this.projectId();
    if (!projectId) return;
    void this.router.navigate(['/user/projects', projectId, 'virtual-device']);
  }

  protected async uploadFirmware(): Promise<void> {
    if (this.executionTarget() !== 'hardware') {
      this.notice.set('เปลี่ยนเป็นอุปกรณ์จริงก่อนอัปโหลดเฟิร์มแวร์');
      return;
    }
    // The board may have been unplugged since the menu was last read.
    await this.firmware.refreshPorts();
    const port = this.firmware.selectedPort();
    if (!port) {
      this.notice.set(
        this.firmware.selectedPortMissing()
          ? 'อุปกรณ์ที่เลือกถูกถอดออก · เสียบสาย USB แล้วลองอีกครั้ง'
          : 'เลือกอุปกรณ์ก่อนอัปโหลด',
      );
      return;
    }
    const board = this.project()?.board ?? '';
    if (portMismatchesBoard(port, board)) {
      // A warning, not a refusal: the USB id is a hint, and the flasher checks the chip.
      this.notice.set(`พอร์ตนี้อาจไม่ใช่บอร์ด ${board} · กำลังลองอัปโหลด`);
    }
    await this.runFirmwareTask('upload');
  }

  protected async selectPort(value: string): Promise<void> {
    if (value === REFRESH_PORTS_VALUE) {
      await this.firmware.refreshPorts();
      const count = this.firmware.ports().length;
      this.notice.set(
        count ? `พบอุปกรณ์ที่อนุญาตแล้ว ${count} รายการ` : 'ยังไม่พบอุปกรณ์ที่อนุญาตแล้ว',
      );
      return;
    }
    if (value !== ADD_PORT_VALUE) {
      await this.firmware.selectPort(value);
      this.storeSelectedPort();
      return;
    }
    try {
      if (await this.firmware.addPort()) {
        this.storeSelectedPort();
        this.notice.set('เพิ่มอุปกรณ์แล้ว');
      }
    } catch (error: unknown) {
      this.notice.set(
        isSerialPermissionError(error)
          ? 'เบราว์เซอร์ไม่อนุญาตให้หน้านี้เข้าถึงพอร์ต USB'
          : 'เปิดพอร์ตไม่สำเร็จ กรุณาลองใหม่',
      );
    }
  }

  /** Remembers the board per project, by USB identity: port ids do not survive a reload. */
  private storeSelectedPort(): void {
    const projectId = this.projectId();
    const fingerprint = this.firmware.selectedPort()?.fingerprint;
    if (!projectId || !fingerprint) return;
    try {
      this.document.defaultView?.localStorage.setItem(this.portStorageKey(projectId), fingerprint);
    } catch {
      // The choice still holds for this session.
    }
  }

  private readStoredPort(projectId: string): string | null {
    try {
      return (
        this.document.defaultView?.localStorage.getItem(this.portStorageKey(projectId)) ?? null
      );
    } catch {
      return null;
    }
  }

  private portStorageKey(projectId: string): string {
    return `iot-hub:workspace:${projectId}:port`;
  }

  protected selectBottomPanel(tab: BottomPanelTab): void {
    this.bottomPanelTab.set(tab);
    this.consoleOpen.set(true);
    if (tab === 'serial' && this.executionTarget() === 'hardware') {
      void this.firmware.connectMonitor();
    }
  }

  protected async toggleSerialMonitor(): Promise<void> {
    if (this.executionTarget() !== 'hardware') {
      this.notice.set('Serial Monitor ใช้ได้เมื่อเลือกอุปกรณ์จริง');
      return;
    }
    if (this.serialState() !== 'connected') {
      this.bottomPanelTab.set('serial');
      this.consoleOpen.set(true);
    }
    await this.firmware.toggleMonitor();
    this.notice.set(
      this.serialState() === 'connected'
        ? 'Serial Monitor connected'
        : 'Serial Monitor disconnected',
    );
  }

  protected updateSerialBaud(value: string): void {
    void this.firmware.serial.setBaud(Number(value));
  }

  protected clearSerialLog(): void {
    this.firmware.clearSerial();
  }

  protected exportSerialLog(): void {
    const lines = this.serialLines();
    if (lines.length === 0) return;
    const content = lines.map((line) => `[${line.timestamp}] ${line.text}`).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.projectId() ?? 'project'}-serial.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected formatSerialTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  }

  /**
   * Saves every open file, then builds on the server — and for an upload, flashes the
   * selected board. The build compiles what is stored, so the save comes first.
   */
  private async runFirmwareTask(target: FirmwareTask): Promise<void> {
    const project = this.project();
    if (!project || this.buildState() === 'building') return;

    const action = target === 'upload' ? 'Upload' : 'Compile';
    this.bottomPanelTab.set('build');
    this.consoleOpen.set(true);
    this.notice.set(`Saving project files before ${action.toLowerCase()}…`);

    await Promise.all(
      project.files.map((filename) =>
        this.ensureFileState(project.id, filename, project.setupMode),
      ),
    );
    this.lastSaveFailure = null;
    const saves = await Promise.all(project.files.map((filename) => this.saveFile(filename, true)));
    if (saves.some((saved) => !saved)) {
      this.notice.set(
        this.lastSaveFailure === 'conflict'
          ? `${action} ยังไม่เริ่ม · ไฟล์ถูกแก้จากที่อื่น รีเฟรชหน้าแล้วลองใหม่`
          : this.lastSaveFailure === 'rejected'
            ? `${action} ยังไม่เริ่ม · บันทึกไฟล์ไม่สำเร็จ`
            : `${action} unavailable · Backend offline`,
      );
      return;
    }

    this.notice.set(
      target === 'upload' ? 'Compiling and uploading firmware…' : 'Compiling firmware…',
    );
    const succeeded = await this.firmware.run(project.id, target);
    this.notice.set(
      target === 'upload'
        ? succeeded
          ? 'Upload successful'
          : 'Upload failed'
        : succeeded
          ? 'Compilation successful'
          : 'Compilation failed',
    );
  }

  protected updatePrompt(event: Event): void {
    this.chat.setPrompt((event.target as HTMLTextAreaElement).value);
  }

  protected useSuggestion(text: string): void {
    this.chat.setPrompt(text);
  }

  /**
   * Sends the conversation to the project assistant.
   *
   * The board, the components, the wiring, and the source are read server-side from this
   * project, so the assistant cannot be told about hardware the project does not have —
   * which is the reason the user never has to describe it.
   *
   * What the server cannot see goes up with the message: the faults this browser is showing
   * — a sketch that will not compile, wiring findings, the serial tail, a failed build. The
   * server quotes those as the client's report and keeps its own wiring audit separate, so
   * they add evidence without becoming a second source of truth about the hardware.
   */
  protected sendMessage(): void {
    const projectId = this.projectId();
    if (!projectId || !this.prompt().trim() || this.sending() || this.preparingAiSetup()) return;
    const localDiagnostics = {
      serial: this.serialLines().map((line) => line.text),
      build: this.buildLogs(),
      buildState: this.buildState(),
    };

    // Not awaited on purpose. The turn belongs to the store, which outlives this page, so
    // the user may navigate away while it runs and find the answer waiting on their return.
    void this.chat.send({ projectId, activeFile: this.activeFilename() }, () =>
      this.diagnostics.collect(projectId, localDiagnostics),
    );
  }

  /** Start from the create-dialog brief, after the source exists on the server. */
  protected async generateFromDescription(): Promise<void> {
    const project = this.project();
    const description = project?.description.trim();
    if (!project || !description || this.sending() || this.preparingAiSetup()) return;

    this.preparingAiSetup.set(true);
    this.startNewChatSession();
    this.chat.setPrompt(aiSetupPrompt(description));
    try {
      const filename = this.activeFilename();
      await this.ensureFileState(project.id, filename, project.setupMode);
      // Hydration can fall back to local mode. Do not ask AI to edit a file it cannot read.
      await this.projectFiles.read(project.id, filename);
      if (this.projectId() !== project.id || this.destroyRef.destroyed) return;
      this.preparingAiSetup.set(false);
      this.sendMessage();
    } catch {
      this.chat.appendAssistantMessage(
        'ยังเตรียมไฟล์โปรเจกต์ไม่สำเร็จ กรุณาลองกดสร้างแผนจากคำอธิบายอีกครั้ง',
      );
    } finally {
      this.preparingAiSetup.set(false);
    }
  }

  /**
   * Applies a proposal the user accepted.
   *
   * The actions go back exactly as they arrived. The server re-validates every wire against
   * the project as it stands now, so a proposal that went stale — a part deleted, a wire
   * moved in the canvas tab — is refused rather than applied over the top.
   */
  protected async applyPlan(messageId: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;

    // Pending edits reach the server first, so the plan is applied on top of them and the
    // editor's undo history still holds them if the plan rewrites the same lines.
    this.flushAutoSaves();
    const plan = this.messages().find((message) => message.id === messageId)?.plan;
    this.rewritingFiles.set(
      new Set(
        (plan?.actions ?? []).flatMap((action) =>
          action.type === 'write_file' ? [action.path] : [],
        ),
      ),
    );
    try {
      const result = await this.chat.applyPlan(projectId, messageId);
      if (!result || this.projectId() !== projectId) return;

      // The chat store marked the written files stale. Re-reading them replaces each clean
      // buffer in place and leaves unsaved edits alone; the editor instance is kept.
      if (result.filesWritten.length) {
        const setupMode = this.project()?.setupMode ?? 'manual';
        await this.projectStore.loadFiles(projectId).catch(() => undefined);
        await Promise.all(
          result.filesWritten.map((path) => this.ensureFileState(projectId, path, setupMode)),
        );
        this.openedFiles.update((files) => [
          ...files,
          ...result.filesWritten.filter((path) => !files.includes(path)),
        ]);
        this.storeTabs();
      }

      this.notice.set(this.applySummary(result));
    } finally {
      this.rewritingFiles.set(new Set());
    }
  }

  /**
   * The preview, grouped the way the user thinks about the change.
   *
   * Built from the server's own preview lines rather than from the actions, so what is
   * shown and what would be applied come from one place. Empty groups are dropped so a
   * code-only change does not display an empty "Wiring" heading.
   */
  protected planGroups(plan: AiPlan): { title: string; lines: string[] }[] {
    const titles: Record<AiPlan['preview'][number]['kind'], string> = {
      device: 'อุปกรณ์',
      wiring: 'การต่อสาย',
      code: 'โค้ด',
      dashboard: 'แดชบอร์ด',
    };

    return (['device', 'wiring', 'code', 'dashboard'] as const)
      .map((kind) => ({
        title: titles[kind],
        lines: plan.preview
          .filter((line) => line.kind === kind)
          .map((line) => this.planPreviewText(line)),
      }))
      .filter((group) => group.lines.length > 0);
  }

  /** Converts server preview labels into concise Thai without changing the actions applied. */
  private planPreviewText(line: AiPlan['preview'][number]): string {
    if (line.text.startsWith('Remove wire ')) {
      const summary = line.text.slice('Remove wire '.length);
      const endpoints = summary
        .split(/\s*↔\s*/)
        .map((endpoint) => this.describePlanEndpoint(endpoint));
      return endpoints.length === 2
        ? `ถอดสายระหว่าง ${endpoints[0]} กับ ${endpoints[1]}`
        : `ถอดสาย: ${summary}`;
    }

    if (line.text.startsWith('Modify ')) {
      return `แก้ไขไฟล์ ${line.text.slice('Modify '.length)}`;
    }
    if (line.text.startsWith('Create ')) {
      return `สร้างไฟล์ ${line.text.slice('Create '.length)}`;
    }
    if (line.text.startsWith('Add ')) {
      return `เพิ่มอุปกรณ์ ${line.text.slice('Add '.length)}`;
    }
    if (line.kind === 'wiring') {
      return `ต่อสาย: ${line.text}`;
    }
    if (line.text.startsWith('Datastream ')) {
      return `เพิ่ม datastream ${line.text.slice('Datastream '.length)}`;
    }
    if (line.text.startsWith('Widget ')) {
      return `วาง widget ${line.text.slice('Widget '.length)}`;
    }
    if (line.text === 'Clear the dashboard') return 'ล้าง widget ทั้งหมดในแดชบอร์ด';

    return line.text;
  }

  /** Changes the compact `device:pin` form into wording that identifies both parts. */
  private describePlanEndpoint(endpoint: string): string {
    const separator = endpoint.lastIndexOf(':');
    if (separator <= 0 || separator === endpoint.length - 1) return endpoint;
    return `${endpoint.slice(0, separator)} ขา ${endpoint.slice(separator + 1)}`;
  }

  protected dismissPlan(messageId: string): void {
    this.chat.dismissPlan(messageId);
  }

  private applySummary(result: {
    componentsAdded: number;
    connectionsAdded: number;
    connectionsRemoved: number;
    filesWritten: string[];
    dashboardUpdated?: boolean;
  }): string {
    const parts: string[] = [];
    if (result.componentsAdded) parts.push(`เพิ่มอุปกรณ์ ${result.componentsAdded} ชิ้น`);
    if (result.connectionsAdded) parts.push(`ต่อสาย ${result.connectionsAdded} เส้น`);
    if (result.connectionsRemoved) parts.push(`ถอดสาย ${result.connectionsRemoved} เส้น`);
    if (result.filesWritten.length) parts.push(`แก้ไฟล์ ${result.filesWritten.join(', ')}`);
    if (result.dashboardUpdated) parts.push('อัปเดตแดชบอร์ด');
    return parts.length ? `ใช้การเปลี่ยนแปลงแล้ว · ${parts.join(' · ')}` : 'ไม่มีอะไรต้องเปลี่ยน';
  }

  /** Enter submits once; Shift+Enter and composition keep their native editing behavior. */
  protected handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!event.repeat) this.sendMessage();
  }

  protected handleUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.notice.set(`${file.name} uploaded`);
    this.toolbarMenuOpen.set(false);
    input.value = '';
  }

  protected openLibraries(): void {
    this.toolbarMenuOpen.set(false);
    this.librariesOpen.set(true);
  }

  /**
   * The Library Manager rewrote `lib/`: reload the file list so compile and the
   * simulator see it, and drop any cached copy of a library file.
   */
  protected async libraryFilesChanged(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const before = this.project()?.files ?? [];
    const after = await this.projectStore.loadFiles(projectId).catch(() => before);
    if (this.projectId() !== projectId) return;
    const libraryPaths = [...new Set([...before, ...after])].filter((path) =>
      path.startsWith('lib/'),
    );
    this.projectFiles.forget(projectId, libraryPaths);
    for (const path of libraryPaths) this.buffers.remove(projectId, path);
    this.notice.set('อัปเดต library ในโปรเจกต์แล้ว');
  }

  protected exportProject(): void {
    const project = this.project();
    if (!project) return;

    const contents = `# ${project.name}\n\nBoard: ${project.board}\nFramework: ${project.framework}\n\n${this.code()}`;
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.id}-export.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.toolbarMenuOpen.set(false);
    this.notice.set('Project exported');
  }

  protected deploy(): void {
    if (this.deployState() === 'building') return;
    this.openedFiles().forEach((filename) => {
      if (this.tabIsDirty(filename)) void this.saveFile(filename);
    });
    this.deployState.set('building');
    this.notice.set('Building firmware and web server…');
    setTimeout(() => {
      this.deployState.set('live');
      this.notice.set('Deployment is live');
    }, 900);
  }

  private ensureFileState(
    projectId: string,
    filename: string,
    setupMode: 'ai' | 'manual',
  ): Promise<void> {
    const remoteKey = `${projectId}:${filename}`;
    const existingHydration = this.buffers.hydrations.get(remoteKey);
    const current = this.buffers.filesOf(projectId)[filename];
    if (current && existingHydration) return existingHydration;

    const fallback = this.defaultCode(filename, setupMode).join('\n');
    const saved =
      current?.content ?? this.readStoredFile(this.fileStorageKey(projectId, filename)) ?? fallback;
    if (!current) {
      this.buffers.set(projectId, filename, { content: saved, savedContent: saved });
    }
    const hydration = this.hydrateRemoteFile(projectId, filename, saved);
    this.buffers.hydrations.set(remoteKey, hydration);
    return hydration;
  }

  private scheduleAutoSave(projectId: string, filename: string): void {
    this.cancelAutoSave(projectId, filename);
    this.autoSaveTimers.set(`${projectId}:${filename}`, {
      projectId,
      filename,
      timer: setTimeout(() => void this.persistFile(projectId, filename, true), 1200),
    });
  }

  private cancelAutoSave(projectId: string, filename: string): void {
    const key = `${projectId}:${filename}`;
    const pending = this.autoSaveTimers.get(key);
    if (pending) clearTimeout(pending.timer);
    this.autoSaveTimers.delete(key);
  }

  /** Runs every pending autosave now. */
  private flushAutoSaves(): void {
    for (const { projectId, filename } of [...this.autoSaveTimers.values()]) {
      void this.persistFile(projectId, filename, true);
    }
  }

  private async hydrateRemoteFile(
    projectId: string,
    filename: string,
    localBaseline: string,
  ): Promise<void> {
    const remoteKey = `${projectId}:${filename}`;
    if (this.buffers.hydrated.has(remoteKey)) return;
    this.buffers.hydrated.add(remoteKey);
    const isActive = () => projectId === this.projectId() && filename === this.activeFilename();

    try {
      const remote = await this.projectFiles.read(projectId, filename);
      this.backendStatus.set('online');
      const current = this.buffers.filesOf(projectId)[filename];
      if (!current || current.content === remote.content) return;
      // Text typed while the read was in flight, or edits not yet saved, win over the
      // server copy: their save then reports the conflict instead of losing either side.
      if (current.content !== localBaseline) return;
      if (current.content !== current.savedContent) {
        if (isActive()) {
          this.notice.set(`${filename} ถูกแก้จากที่อื่น · การแก้ไขที่ยังไม่บันทึกของคุณยังอยู่`);
        }
        return;
      }

      this.buffers.set(projectId, filename, {
        content: remote.content,
        savedContent: remote.content,
      });
      try {
        this.document.defaultView?.localStorage.setItem(
          this.fileStorageKey(projectId, filename),
          remote.content,
        );
      } catch {
        // The backend remains the source of truth if browser storage is unavailable.
      }
      if (isActive()) this.notice.set('Workspace file loaded');
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        try {
          await this.projectFiles.save(projectId, filename, localBaseline);
          this.backendStatus.set('online');
          if (isActive()) this.notice.set('Workspace initialized');
          return;
        } catch {
          // Fall through to local mode when the initial remote save fails.
        }
      }
      this.buffers.markStale(projectId, [filename]);
      this.backendStatus.set('offline');
      if (isActive()) this.notice.set('Local mode · Backend unavailable');
    }
  }

  private scrollSerialOutput(): void {
    if (!this.serialAutoScroll()) return;
    setTimeout(() => {
      const output = this.serialOutputElement()?.nativeElement;
      if (output) output.scrollTop = output.scrollHeight;
    });
  }

  private fileStorageKey(projectId: string, filename: string): string {
    return `iot-hub:workspace:${projectId}:${filename}`;
  }

  private tabsStorageKey(projectId: string): string {
    return `iot-hub:workspace:${projectId}:open-tabs`;
  }

  private readStoredTabs(projectId: string): string[] {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(this.tabsStorageKey(projectId));
      if (!raw) return [];
      const tabs = JSON.parse(raw) as unknown;
      return Array.isArray(tabs)
        ? tabs.filter((tab): tab is string => typeof tab === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private storeTabs(): void {
    const projectId = this.projectId();
    if (!projectId) return;
    try {
      this.document.defaultView?.localStorage.setItem(
        this.tabsStorageKey(projectId),
        JSON.stringify(this.openedFiles()),
      );
    } catch {
      // Reordering still works when browser storage is unavailable.
    }
  }

  private defaultCode(filename: string, setupMode: 'ai' | 'manual'): readonly string[] {
    if (filename.endsWith('.ini')) {
      return [
        '[env:esp32-s3-devkitc-1]',
        'platform = espressif32',
        'board = esp32-s3-devkitc-1',
        'framework = arduino',
        'monitor_speed = 115200',
      ];
    }
    if (setupMode === 'manual') {
      return /(^|\/)main\.(ino|cpp)$/.test(filename) ? MANUAL_ARDUINO_CODE : EMPTY_FILE;
    }
    if (/(^|\/)main\.(ino|cpp)$/.test(filename)) return ARDUINO_CODE;
    return EMPTY_FILE;
  }

  private readStoredFile(key: string): string | null {
    try {
      return this.document.defaultView?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private readPanelWidth(): number {
    try {
      const savedWidth = Number(
        this.document.defaultView?.localStorage.getItem('iot-hub:ai-panel-width'),
      );
      return Number.isFinite(savedWidth) && savedWidth >= 280 && savedWidth <= 640
        ? savedWidth
        : 352;
    } catch {
      return 352;
    }
  }

  private readExecutionTarget(): ExecutionTarget {
    try {
      return this.document.defaultView?.localStorage.getItem(EXECUTION_TARGET_STORAGE_KEY) ===
        'hardware'
        ? 'hardware'
        : 'simulation';
    } catch {
      return 'simulation';
    }
  }

  private storePanelWidth(): void {
    try {
      this.document.defaultView?.localStorage.setItem(
        'iot-hub:ai-panel-width',
        String(this.aiPanelWidth()),
      );
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }

  private panelWidthBounds(layout: HTMLElement): { min: number; max: number } {
    const min = 280;
    const max = Math.max(min, Math.min(640, layout.getBoundingClientRect().width - 420));
    return { min, max };
  }

  private constrainPanelWidth(width: number, layout: HTMLElement): number {
    const bounds = this.panelWidthBounds(layout);
    return Math.min(bounds.max, Math.max(bounds.min, width));
  }
}

import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { FileIcon } from '../../../shared/components/file-icon/file-icon';
import { ProjectStore } from '../projects/project.store';
import { EditorCursorPosition, MonacoCodeEditor } from './monaco-code-editor';
import { SerialMonitorLine, WorkspaceApiService, WorkspaceDevice } from './workspace-api.service';

type WorkspaceView = 'dashboard' | 'ide';
type DeployState = 'idle' | 'building' | 'live';
type BuildState = 'idle' | 'building' | 'success' | 'error';
type BackendStatus = 'checking' | 'online' | 'offline';
type FirmwareTask = 'build' | 'upload';
type BottomPanelTab = 'build' | 'serial';
type SerialState = 'idle' | 'connecting' | 'connected' | 'error';
type EditorLanguage = 'cpp' | 'python' | 'config';

interface ChatMessage {
  id: number;
  role: 'assistant' | 'user';
  text: string;
}

interface WorkspaceAiProvider {
  id: string;
  label: string;
  configured: boolean;
  models: readonly CustomSelectOption[];
}

interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface ChatSessionState {
  activeSessionId: string;
  sessions: ChatSession[];
}

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

interface WorkspaceFileState {
  content: string;
  savedContent: string;
}

const MODEL_PROVIDERS: readonly WorkspaceAiProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    configured: false,
    models: [
      { value: 'gpt-5.4', label: 'gpt-5.4' },
      { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { value: 'gpt-5.4-nano', label: 'gpt-5.4-nano' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Claude',
    configured: false,
    models: [
      { value: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
      { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    configured: true,
    models: [
      { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    ],
  },
  {
    id: 'gemma',
    label: 'Google Gemma',
    configured: true,
    models: [
      { value: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (ฟรี)' },
      { value: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B (ฟรี)' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    configured: true,
    models: [
      { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
      { value: 'deepseek-chat', label: 'deepseek-chat' },
    ],
  },
  {
    id: 'meta',
    label: 'Meta',
    configured: true,
    models: [
      {
        value: 'meta-llama/llama-3.3-70b-instruct:free',
        label: 'Llama 3.3 70B (ฟรี)',
      },
      {
        value: 'meta-llama/llama-3.2-3b-instruct:free',
        label: 'Llama 3.2 3B (ฟรี)',
      },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    configured: true,
    models: [
      {
        value: 'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'Nemotron 3 Super (ฟรี)',
      },
      {
        value: 'nvidia/nemotron-3-nano-30b-a3b:free',
        label: 'Nemotron 3 Nano (ฟรี)',
      },
    ],
  },
];

const MODEL_OPTIONS = MODEL_PROVIDERS.flatMap((provider) => provider.models);
const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  openai: '/openai.svg',
  anthropic: '/claude.svg',
  gemini: '/gemini.svg',
  gemma: '/gemma.svg',
  deepseek: '/deepseek.svg',
  meta: '/meta.svg',
  nvidia: '/nvidia.svg',
};
const COLLAPSED_PROVIDER_COUNT = 4;

const REFRESH_PORT_VALUE = '__refresh_ports__';
const CHAT_SESSION_STORAGE_KEY = 'iot-hub:workspace:ai-sessions:v1';

const ARDUINO_CODE = [
  '#include <WiFi.h>',
  '#include <WebServer.h>',
  '#include "config.h"',
  '',
  'WebServer server(80);',
  'const int SOIL_SENSOR = 34;',
  '',
  'void sendTelemetry() {',
  '  int soil = analogRead(SOIL_SENSOR);',
  '  String payload = "{\\"soil\\":" + String(soil) + "}";',
  '  server.send(200, "application/json", payload);',
  '}',
  '',
  'void setup() {',
  '  Serial.begin(115200);',
  '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
  '',
  '  while (WiFi.status() != WL_CONNECTED) {',
  '    delay(500);',
  '    Serial.print(".");',
  '  }',
  '',
  '  server.on("/api/telemetry", sendTelemetry);',
  '  server.begin();',
  '  Serial.println("IoT Hub server is ready");',
  '}',
  '',
  'void loop() {',
  '  server.handleClient();',
  '}',
];

const MANUAL_ARDUINO_CODE = ['void setup() {', '', '}', '', 'void loop() {', '', '}'];

const EMPTY_FILE = [''];

const PYTHON_CODE = [
  'import network',
  'import uasyncio as asyncio',
  'from machine import ADC, Pin',
  'from settings import WIFI_SSID, WIFI_PASSWORD',
  '',
  'soil_sensor = ADC(Pin(26))',
  '',
  'async def telemetry(request):',
  '    soil = soil_sensor.read_u16()',
  '    return {"soil": soil, "status": "online"}',
  '',
  'async def main():',
  '    wlan = network.WLAN(network.STA_IF)',
  '    wlan.active(True)',
  '    wlan.connect(WIFI_SSID, WIFI_PASSWORD)',
  '    while not wlan.isconnected():',
  '        await asyncio.sleep_ms(250)',
  '    print("IoT Hub server is ready")',
  '',
  'asyncio.run(main())',
];

@Component({
  selector: 'app-project-workspace-page',
  imports: [CustomSelect, FileIcon, MonacoCodeEditor, NgOptimizedImage, RouterLink],
  templateUrl: './project-workspace.page.html',
  styleUrl: './project-workspace.page.css',
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
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly hydratedRemoteFiles = new Set<string>();
  private readonly remoteHydrations = new Map<string, Promise<void>>();
  private readonly serialOutputElement = viewChild<ElementRef<HTMLElement>>('serialOutput');
  private readonly deleteDialogCancel =
    viewChild<ElementRef<HTMLButtonElement>>('deleteDialogCancel');
  private readonly initialChatState = this.readChatSessionState();
  private loadedProjectId: string | null = null;
  private devicesLoadedForProject: string | null = null;
  private serialPollTimer: ReturnType<typeof setInterval> | null = null;
  private serialPollPending = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private pendingTabDrag: PendingTabDrag | null = null;
  private suppressTabClick: string | null = null;

  protected readonly providerLogos = PROVIDER_LOGOS;
  protected readonly selectedModel = signal(this.initialChatState.sessions[0].model);
  protected readonly modelMenuOpen = signal(false);
  protected readonly showAllProviders = signal(false);
  protected readonly sessionMenuOpen = signal(false);
  protected readonly chatSessions = signal(this.initialChatState.sessions);
  protected readonly activeSessionId = signal(this.initialChatState.activeSessionId);
  protected readonly aiOpen = signal(true);
  protected readonly aiPanelWidth = signal(this.readPanelWidth());
  protected readonly resizingAi = signal(false);
  protected readonly toolbarMenuOpen = signal(false);
  protected readonly deviceMenuCloseRequest = signal(0);
  protected readonly draggedFile = signal<string | null>(null);
  protected readonly tabDragPreview = signal<TabDragPreview | null>(null);
  protected readonly consoleOpen = signal(true);
  protected readonly openedFiles = signal<string[]>([]);
  protected readonly pendingDeleteFile = signal<string | null>(null);
  private readonly fileStates = signal<Record<string, WorkspaceFileState>>({});
  protected readonly cursorLine = signal(1);
  protected readonly cursorColumn = signal(1);
  protected readonly prompt = signal('');
  protected readonly sending = signal(false);
  protected readonly deployState = signal<DeployState>('idle');
  protected readonly buildState = signal<BuildState>('idle');
  protected readonly activeFirmwareTask = signal<FirmwareTask>('build');
  protected readonly buildLogs = signal<string[]>([
    'Build console ready. Save your files, then select Build.',
  ]);
  protected readonly bottomPanelTab = signal<BottomPanelTab>('build');
  protected readonly devices = signal<WorkspaceDevice[]>([]);
  protected readonly refreshingDevices = signal(false);
  protected readonly selectedPort = signal('');
  protected readonly serialState = signal<SerialState>('idle');
  protected readonly serialBaud = signal(115_200);
  protected readonly serialLines = signal<SerialMonitorLine[]>([]);
  protected readonly serialTimestamp = signal(true);
  protected readonly serialAutoScroll = signal(true);
  private readonly serialCursor = signal(0);
  protected readonly backendStatus = signal<BackendStatus>('checking');
  protected readonly notice = signal('All changes saved');
  protected readonly messages = signal<ChatMessage[]>(this.initialChatState.sessions[0].messages);
  protected readonly visibleModelProviders = computed(() => {
    if (this.showAllProviders()) return MODEL_PROVIDERS;
    const visible = [...MODEL_PROVIDERS.slice(0, COLLAPSED_PROVIDER_COUNT)];
    const selectedProvider = MODEL_PROVIDERS.find((provider) =>
      provider.models.some((model) => model.value === this.selectedModel()),
    );
    if (selectedProvider && !visible.includes(selectedProvider)) {
      visible[COLLAPSED_PROVIDER_COUNT - 1] = selectedProvider;
    }
    return visible;
  });
  protected readonly hiddenProviderCount = computed(
    () => MODEL_PROVIDERS.length - this.visibleModelProviders().length,
  );
  protected readonly selectedModelOption = computed(
    () => MODEL_OPTIONS.find((option) => option.value === this.selectedModel()) ?? MODEL_OPTIONS[0],
  );
  protected readonly selectedModelProvider = computed(
    () =>
      MODEL_PROVIDERS.find((provider) =>
        provider.models.some((model) => model.value === this.selectedModel()),
      ) ?? MODEL_PROVIDERS[0],
  );

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
  /** A requested file that the project no longer has (deleted, stale link) falls back. */
  protected readonly activeFilename = computed(() => {
    const files = this.project()?.files ?? [];
    const requested = this.requestedFile();
    if (requested && (files.length === 0 || files.includes(requested))) return requested;
    return files[0] ?? 'main.ino';
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
  protected readonly buildLabel = computed(() =>
    this.buildState() === 'building' && this.activeFirmwareTask() === 'build'
      ? 'Building…'
      : 'Build',
  );
  protected readonly uploadLabel = computed(() =>
    this.buildState() === 'building' && this.activeFirmwareTask() === 'upload'
      ? 'Uploading…'
      : 'Upload',
  );
  protected readonly monitorLabel = computed(() =>
    this.serialState() === 'connected' ? 'Disconnect' : 'Monitor',
  );
  protected readonly buildStatusLabel = computed(() => {
    const action = this.activeFirmwareTask() === 'upload' ? 'Upload' : 'Build';
    if (this.buildState() === 'building') return `${action} running`;
    if (this.buildState() === 'success') return `${action} succeeded`;
    if (this.buildState() === 'error') return `${action} failed`;
    return 'Ready';
  });
  protected readonly deviceOptions = computed<readonly CustomSelectOption[]>(() => {
    if (this.refreshingDevices()) {
      return [{ value: '', label: 'กำลังตรวจหาอุปกรณ์…', disabled: true }];
    }
    const devices = this.devices();
    if (devices.length === 0) {
      return [
        { value: '', label: 'ไม่พบอุปกรณ์', description: 'เชื่อมต่อบอร์ดผ่าน USB', disabled: true },
        {
          value: REFRESH_PORT_VALUE,
          label: 'ตรวจหาอัตโนมัติ',
          description: 'สแกนพอร์ตที่เชื่อมต่ออีกครั้ง',
        },
      ];
    }
    return [
      ...devices.map((device) => ({
        value: device.port,
        label: device.port,
        description: `${device.description} · ตรวจพบอัตโนมัติ`,
      })),
      {
        value: REFRESH_PORT_VALUE,
        label: 'ตรวจหาอัตโนมัติ',
        description: 'สแกนพอร์ตที่เชื่อมต่ออีกครั้ง',
      },
    ];
  });
  protected readonly serialStatusLabel = computed(() => {
    if (this.serialState() === 'connecting') return 'Connecting…';
    if (this.serialState() === 'connected') return `Connected · ${this.selectedPort()}`;
    if (this.serialState() === 'error') return 'Connection failed';
    return 'Disconnected';
  });
  protected readonly backendStatusLabel = computed(() => {
    if (this.backendStatus() === 'online') return 'Workspace synced';
    if (this.backendStatus() === 'offline') return 'Local mode';
    return 'Connecting';
  });

  private readonly loadActiveFile = effect(() => {
    const projectId = this.projectId();
    const filename = this.activeFilename();
    const setupMode = this.project()?.setupMode;
    if (!projectId || !setupMode) return;

    if (this.loadedProjectId !== projectId) {
      this.autoSaveTimers.forEach((timer) => clearTimeout(timer));
      this.autoSaveTimers.clear();
      this.fileStates.set({});
      // The tab bar is the file list now, so every project file gets a tab. Stored
      // tabs only carry the order the user dragged them into.
      const projectFiles = this.project()?.files ?? [];
      const storedOrder = this.readStoredTabs(projectId);
      this.openedFiles.set([
        ...storedOrder.filter((file) => projectFiles.includes(file)),
        ...projectFiles.filter((file) => !storedOrder.includes(file)),
      ]);
      this.loadedProjectId = projectId;
    }

    void this.ensureFileState(projectId, filename, setupMode);
    this.openedFiles.update((files) => (files.includes(filename) ? files : [...files, filename]));
    this.storeTabs();
    this.cursorLine.set(1);
    this.cursorColumn.set(1);
    this.notice.set(this.tabIsDirty(filename) ? 'Unsaved changes' : 'All changes saved');
  });

  /** Destructive dialog opens on the safe choice. */
  private readonly focusDeleteDialog = effect(() => {
    if (!this.pendingDeleteFile()) return;
    this.deleteDialogCancel()?.nativeElement.focus();
  });

  private readonly loadDevices = effect(() => {
    const projectId = this.projectId();
    if (this.view() !== 'ide' || !projectId || this.devicesLoadedForProject === projectId) return;
    this.devicesLoadedForProject = projectId;
    void this.refreshDevices();
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.autoSaveTimers.forEach((timer) => clearTimeout(timer));
      this.autoSaveTimers.clear();
      this.stopSerialPolling();
      const projectId = this.projectId();
      if (projectId && this.serialState() === 'connected') {
        void firstValueFrom(this.workspaceApi.stopSerialMonitor(projectId));
      }
    });
  }

  protected selectModel(value: string): void {
    if (!MODEL_OPTIONS.some((option) => option.value === value)) return;
    this.selectedModel.set(value);
    this.modelMenuOpen.set(false);
    this.syncActiveChatSession();
    this.toolbarMenuOpen.set(false);
  }

  protected toggleModelMenu(): void {
    const willOpen = !this.modelMenuOpen();
    this.sessionMenuOpen.set(false);
    this.toolbarMenuOpen.set(false);
    if (willOpen) this.closeDeviceMenu();
    this.modelMenuOpen.set(willOpen);
  }

  protected toggleProviderVisibility(): void {
    this.showAllProviders.update((showAll) => !showAll);
  }

  protected toggleSessionMenu(): void {
    const willOpen = !this.sessionMenuOpen();
    this.modelMenuOpen.set(false);
    this.toolbarMenuOpen.set(false);
    if (willOpen) this.closeDeviceMenu();
    this.sessionMenuOpen.set(willOpen);
  }

  protected closeAiMenus(): void {
    this.modelMenuOpen.set(false);
    this.sessionMenuOpen.set(false);
  }

  protected startNewChatSession(): void {
    this.syncActiveChatSession();
    const session = this.createChatSession(this.selectedModel());
    this.chatSessions.update((sessions) => [session, ...sessions].slice(0, 20));
    this.activeSessionId.set(session.id);
    this.messages.set(session.messages);
    this.closeAiMenus();
    this.persistChatSessions();
  }

  protected openChatSession(sessionId: string): void {
    this.syncActiveChatSession();
    const session = this.chatSessions().find((item) => item.id === sessionId);
    if (!session) return;

    this.activeSessionId.set(session.id);
    this.selectedModel.set(session.model);
    this.messages.set([...session.messages]);
    this.closeAiMenus();
    this.persistChatSessions();
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
      await firstValueFrom(this.workspaceApi.deleteFile(projectId, filename));
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
    const pendingAutoSave = this.autoSaveTimers.get(filename);
    if (pendingAutoSave) clearTimeout(pendingAutoSave);
    this.autoSaveTimers.delete(filename);
    this.remoteHydrations.delete(`${projectId}:${filename}`);
    this.hydratedRemoteFiles.delete(`${projectId}:${filename}`);
    this.fileStates.update((states) => {
      const next = { ...states };
      delete next[filename];
      return next;
    });
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
    const filename = this.activeFilename();
    this.fileStates.update((states) => {
      const state = states[filename];
      if (!state || state.content === value) return states;
      return { ...states, [filename]: { ...state, content: value } };
    });
    this.notice.set('Unsaved changes · Auto-saving…');
    this.scheduleAutoSave(filename);
  }

  protected updateCursor(position: EditorCursorPosition): void {
    this.cursorLine.set(position.line);
    this.cursorColumn.set(position.column);
  }

  protected async saveFile(filename = this.activeFilename(), automatic = false): Promise<boolean> {
    const state = this.fileStates()[filename];
    const projectId = this.projectId();
    if (!state || !projectId) return false;

    const pendingAutoSave = this.autoSaveTimers.get(filename);
    if (pendingAutoSave) clearTimeout(pendingAutoSave);
    this.autoSaveTimers.delete(filename);

    try {
      this.document.defaultView?.localStorage.setItem(
        this.fileStorageKey(projectId, filename),
        state.content,
      );
      this.fileStates.update((states) => ({
        ...states,
        [filename]: { ...states[filename], savedContent: state.content },
      }));
      if (filename === this.activeFilename()) {
        this.notice.set(automatic ? 'Saving to workspace…' : 'Saving…');
      }
    } catch {
      this.notice.set('Could not save in this browser');
    }

    try {
      await firstValueFrom(this.workspaceApi.saveFile(projectId, filename, state.content));
      this.backendStatus.set('online');
      if (filename === this.activeFilename()) {
        this.notice.set(automatic ? 'Auto-saved to workspace' : 'Saved to workspace');
      }
      return true;
    } catch {
      this.backendStatus.set('offline');
      if (filename === this.activeFilename()) {
        this.notice.set('Saved locally · Backend unavailable');
      }
      return false;
    }
  }

  protected async buildProject(): Promise<void> {
    await this.runFirmwareTask('build');
  }

  protected async uploadFirmware(): Promise<void> {
    const port = this.selectedPort();
    if (!port) {
      this.notice.set('Connect and select a device before uploading');
      return;
    }
    if (this.serialState() === 'connected') await this.disconnectSerialMonitor();
    await this.runFirmwareTask('upload', port);
  }

  protected selectPort(port: string): void {
    if (port === REFRESH_PORT_VALUE) {
      void this.refreshDevices();
      return;
    }
    if (this.serialState() === 'connected') return;
    this.selectedPort.set(port);
  }

  protected async refreshDevices(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || this.refreshingDevices()) return;

    this.refreshingDevices.set(true);
    try {
      const result = await firstValueFrom(this.workspaceApi.devices(projectId));
      this.backendStatus.set('online');
      this.devices.set(result.devices);
      const selectedPort = this.selectedPort();
      if (!result.devices.some((device) => device.port === selectedPort)) {
        this.selectedPort.set(result.devices[0]?.port ?? '');
      }
      if (result.message) this.notice.set(result.message);
      else if (result.devices.length === 0) this.notice.set('ยังไม่พบอุปกรณ์ที่เชื่อมต่อ');
      else this.notice.set(`ตรวจพบอุปกรณ์อัตโนมัติ ${result.devices.length} พอร์ต`);
    } catch {
      this.backendStatus.set('offline');
      this.devices.set([]);
      this.selectedPort.set('');
      this.notice.set('ตรวจหาพอร์ตไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      this.refreshingDevices.set(false);
    }
  }

  protected selectBottomPanel(tab: BottomPanelTab): void {
    this.bottomPanelTab.set(tab);
    this.consoleOpen.set(true);
  }

  protected async toggleSerialMonitor(): Promise<void> {
    if (this.serialState() === 'connected') {
      await this.disconnectSerialMonitor();
      return;
    }
    await this.connectSerialMonitor();
  }

  protected updateSerialBaud(event: Event): void {
    const baud = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(baud)) this.serialBaud.set(baud);
  }

  protected clearSerialLog(): void {
    this.serialLines.set([]);
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

  private async runFirmwareTask(target: FirmwareTask, port?: string): Promise<void> {
    const project = this.project();
    if (!project || this.buildState() === 'building') return;

    const action = target === 'upload' ? 'upload' : 'build';
    this.activeFirmwareTask.set(target);
    this.buildState.set('building');
    this.bottomPanelTab.set('build');
    this.consoleOpen.set(true);
    this.notice.set(`Saving project files before ${action}…`);
    this.buildLogs.set(['Saving project files to the workspace…']);

    await Promise.all(
      project.files.map((filename) =>
        this.ensureFileState(project.id, filename, project.setupMode),
      ),
    );
    const saves = await Promise.all(project.files.map((filename) => this.saveFile(filename, true)));

    if (saves.some((saved) => !saved)) {
      this.buildState.set('error');
      this.buildLogs.set([
        `${target === 'upload' ? 'Upload' : 'Build'} was not started because the backend workspace is unavailable.`,
        'Your changes are still saved in this browser.',
      ]);
      this.notice.set(`${target === 'upload' ? 'Upload' : 'Build'} unavailable · Backend offline`);
      return;
    }

    this.buildLogs.set([`Starting PlatformIO ${action}…`]);
    this.notice.set(`PlatformIO ${action} running…`);
    try {
      const result = await firstValueFrom(this.workspaceApi.build(project.id, target, port));
      this.backendStatus.set('online');
      this.buildState.set('success');
      this.buildLogs.set([
        ...this.outputLines(result.output),
        `${target === 'upload' ? 'Upload' : 'Build'} completed in ${(result.durationMs / 1000).toFixed(1)}s.`,
      ]);
      this.notice.set(`Firmware ${action} succeeded`);
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse) {
        this.backendStatus.set(error.status === 0 ? 'offline' : 'online');
      }
      this.buildState.set('error');
      this.buildLogs.set(this.buildErrorLines(error));
      this.notice.set(`Firmware ${action} failed`);
    }
  }

  protected updatePrompt(event: Event): void {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
  }

  protected useSuggestion(text: string): void {
    this.prompt.set(text);
  }

  protected sendMessage(): void {
    const text = this.prompt().trim();
    if (!text || this.sending()) return;

    this.messages.update((messages) => [...messages, { id: Date.now(), role: 'user', text }]);
    this.syncActiveChatSession();
    this.prompt.set('');
    this.sending.set(true);
    setTimeout(() => {
      this.messages.update((messages) => [
        ...messages,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: 'ทำได้ครับ ผมจะคงการอ่านค่าเซนเซอร์แบบไม่บล็อก เปิดข้อมูลผ่าน /api/telemetry และรักษากระบวนการเชื่อมต่อ Wi-Fi ใหม่ที่มีอยู่ไว้',
        },
      ]);
      this.sending.set(false);
      this.syncActiveChatSession();
    }, 550);
  }

  protected handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected handleUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.notice.set(`${file.name} uploaded`);
    this.toolbarMenuOpen.set(false);
    input.value = '';
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
    const existingHydration = this.remoteHydrations.get(remoteKey);
    if (this.fileStates()[filename]) return existingHydration ?? Promise.resolve();

    const fallback = this.defaultCode(filename, setupMode).join('\n');
    const saved = this.readStoredFile(this.fileStorageKey(projectId, filename)) ?? fallback;
    this.fileStates.update((states) => ({
      ...states,
      [filename]: { content: saved, savedContent: saved },
    }));
    const hydration = this.hydrateRemoteFile(projectId, filename, saved);
    this.remoteHydrations.set(remoteKey, hydration);
    return hydration;
  }

  private scheduleAutoSave(filename: string): void {
    const currentTimer = this.autoSaveTimers.get(filename);
    if (currentTimer) clearTimeout(currentTimer);
    this.autoSaveTimers.set(
      filename,
      setTimeout(() => void this.saveFile(filename, true), 1200),
    );
  }

  private async hydrateRemoteFile(
    projectId: string,
    filename: string,
    localBaseline: string,
  ): Promise<void> {
    const remoteKey = `${projectId}:${filename}`;
    if (this.hydratedRemoteFiles.has(remoteKey)) return;
    this.hydratedRemoteFiles.add(remoteKey);

    try {
      const remote = await firstValueFrom(this.workspaceApi.readFile(projectId, filename));
      this.backendStatus.set('online');
      const current = this.fileStates()[filename];
      if (!current || current.content !== localBaseline) return;

      this.fileStates.update((states) => ({
        ...states,
        [filename]: { content: remote.content, savedContent: remote.content },
      }));
      try {
        this.document.defaultView?.localStorage.setItem(
          this.fileStorageKey(projectId, filename),
          remote.content,
        );
      } catch {
        // The backend remains the source of truth if browser storage is unavailable.
      }
      if (filename === this.activeFilename()) this.notice.set('Workspace file loaded');
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        try {
          await firstValueFrom(this.workspaceApi.saveFile(projectId, filename, localBaseline));
          this.backendStatus.set('online');
          if (filename === this.activeFilename()) this.notice.set('Workspace initialized');
          return;
        } catch {
          // Fall through to local mode when the initial remote save fails.
        }
      }
      this.backendStatus.set('offline');
      if (filename === this.activeFilename()) this.notice.set('Local mode · Backend unavailable');
    }
  }

  private async connectSerialMonitor(): Promise<void> {
    const projectId = this.projectId();
    const port = this.selectedPort();
    if (!projectId || !port || this.serialState() === 'connecting') {
      if (!port) this.notice.set('Connect and select a device port first');
      return;
    }

    this.serialState.set('connecting');
    this.bottomPanelTab.set('serial');
    this.consoleOpen.set(true);
    this.serialLines.set([]);
    this.serialCursor.set(0);
    this.notice.set(`Connecting Serial Monitor to ${port}…`);
    try {
      const result = await firstValueFrom(
        this.workspaceApi.startSerialMonitor(projectId, port, this.serialBaud()),
      );
      this.backendStatus.set('online');
      this.serialCursor.set(result.cursor);
      this.serialState.set('connected');
      this.notice.set(`Serial Monitor connected to ${port}`);
      this.startSerialPolling();
      await this.pollSerialOutput();
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse) {
        this.backendStatus.set(error.status === 0 ? 'offline' : 'online');
      }
      this.serialState.set('error');
      this.appendSerialErrors(this.buildErrorLines(error));
      this.notice.set('Serial Monitor connection failed');
    }
  }

  private async disconnectSerialMonitor(): Promise<void> {
    const projectId = this.projectId();
    this.stopSerialPolling();
    if (projectId) {
      try {
        await firstValueFrom(this.workspaceApi.stopSerialMonitor(projectId));
        this.backendStatus.set('online');
      } catch {
        this.backendStatus.set('offline');
      }
    }
    this.serialState.set('idle');
    this.notice.set('Serial Monitor disconnected');
  }

  private startSerialPolling(): void {
    this.stopSerialPolling();
    this.serialPollTimer = setInterval(() => void this.pollSerialOutput(), 650);
  }

  private stopSerialPolling(): void {
    if (this.serialPollTimer) clearInterval(this.serialPollTimer);
    this.serialPollTimer = null;
    this.serialPollPending = false;
  }

  private async pollSerialOutput(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId || this.serialPollPending || this.serialState() !== 'connected') return;

    this.serialPollPending = true;
    try {
      const result = await firstValueFrom(
        this.workspaceApi.serialOutput(projectId, this.serialCursor()),
      );
      this.backendStatus.set('online');
      this.serialCursor.set(result.cursor);
      if (result.lines.length > 0) {
        this.serialLines.update((lines) => [...lines, ...result.lines].slice(-2_000));
        this.scrollSerialOutput();
      }
      if (!result.running) {
        this.stopSerialPolling();
        this.serialState.set(result.exitCode && result.exitCode !== 0 ? 'error' : 'idle');
        this.notice.set('Serial Monitor stopped');
      }
    } catch (error: unknown) {
      this.stopSerialPolling();
      this.serialState.set('error');
      this.appendSerialErrors(this.buildErrorLines(error));
      if (error instanceof HttpErrorResponse && error.status === 0) {
        this.backendStatus.set('offline');
      }
      this.notice.set('Serial Monitor connection lost');
    } finally {
      this.serialPollPending = false;
    }
  }

  private appendSerialErrors(messages: string[]): void {
    const timestamp = new Date().toISOString();
    this.serialLines.update((lines) => [
      ...lines,
      ...messages.map((text, index) => ({
        id: -(Date.now() + index),
        timestamp,
        stream: 'stderr' as const,
        text,
      })),
    ]);
    this.scrollSerialOutput();
  }

  private scrollSerialOutput(): void {
    if (!this.serialAutoScroll()) return;
    setTimeout(() => {
      const output = this.serialOutputElement()?.nativeElement;
      if (output) output.scrollTop = output.scrollHeight;
    });
  }

  private outputLines(output: string): string[] {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    return lines.length > 0 ? lines : ['PlatformIO completed without console output.'];
  }

  private buildErrorLines(error: unknown): string[] {
    if (!(error instanceof HttpErrorResponse)) return ['Unexpected build error.'];

    const body = error.error as { message?: string | string[]; output?: string } | string | null;
    if (body && typeof body === 'object' && typeof body.output === 'string') {
      return this.outputLines(body.output);
    }
    if (body && typeof body === 'object' && body.message) {
      const message = Array.isArray(body.message) ? body.message.join('\n') : body.message;
      return this.outputLines(message);
    }
    if (typeof body === 'string' && body.trim()) return this.outputLines(body);
    return [error.message || `Build request failed (${error.status}).`];
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
    if (/(^|\/)main\.py$/.test(filename)) return PYTHON_CODE;
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

  private readChatSessionState(): ChatSessionState {
    const fallbackSession = this.createChatSession('gpt-5.4-mini');
    try {
      const raw = this.document.defaultView?.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
      if (!raw) return { activeSessionId: fallbackSession.id, sessions: [fallbackSession] };

      const parsed = JSON.parse(raw) as ChatSessionState;
      if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
        return { activeSessionId: fallbackSession.id, sessions: [fallbackSession] };
      }

      const sessions = parsed.sessions.filter(
        (session) =>
          typeof session.id === 'string' &&
          typeof session.title === 'string' &&
          typeof session.updatedAt === 'number' &&
          MODEL_OPTIONS.some((option) => option.value === session.model) &&
          Array.isArray(session.messages),
      );
      const active =
        sessions.find((session) => session.id === parsed.activeSessionId) ?? sessions[0];
      if (!active) return { activeSessionId: fallbackSession.id, sessions: [fallbackSession] };

      return {
        activeSessionId: active.id,
        sessions: [active, ...sessions.filter((session) => session.id !== active.id)],
      };
    } catch {
      return { activeSessionId: fallbackSession.id, sessions: [fallbackSession] };
    }
  }

  private createChatSession(model: string): ChatSession {
    const now = Date.now();
    return {
      id: `chat-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'แชทใหม่',
      model,
      messages: [
        {
          id: now,
          role: 'assistant',
          text: 'พร้อมช่วยคุณพัฒนาเฟิร์มแวร์ เซนเซอร์ การต่อวงจร และ Web API วันนี้อยากเริ่มจากอะไร?',
        },
      ],
      updatedAt: now,
    };
  }

  private syncActiveChatSession(): void {
    const messages = this.messages();
    const firstUserMessage = messages.find((message) => message.role === 'user')?.text;
    this.chatSessions.update((sessions) =>
      sessions.map((session) =>
        session.id === this.activeSessionId()
          ? {
              ...session,
              title: firstUserMessage?.slice(0, 42) || 'แชทใหม่',
              model: this.selectedModel(),
              messages: [...messages],
              updatedAt: Date.now(),
            }
          : session,
      ),
    );
    this.persistChatSessions();
  }

  private persistChatSessions(): void {
    try {
      const state: ChatSessionState = {
        activeSessionId: this.activeSessionId(),
        sessions: this.chatSessions(),
      };
      this.document.defaultView?.sessionStorage.setItem(
        CHAT_SESSION_STORAGE_KEY,
        JSON.stringify(state),
      );
    } catch {
      // Chat sessions still work in memory when session storage is unavailable.
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

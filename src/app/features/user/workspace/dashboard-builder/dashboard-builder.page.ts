import { DOCUMENT } from '@angular/common';
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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ProjectStore } from '../../projects/project.store';
import { DashboardCanvas } from './dashboard-canvas';
import { DashboardIcon } from './dashboard-icon';
import { DashboardMenuState } from './dashboard-menu.state';
import { apiErrorMessage } from '../../../../core/models/api-error';
import { DashboardSync, DashboardContent, SaveOutcome } from './dashboard-sync';
import { DashboardApiClient, DatastreamInput } from './dashboard-api.client';
import { DashboardTemplates, TemplateApplied } from './dashboard-templates';
import { DashboardLive } from './dashboard-live';
import { DashboardViewCache } from './dashboard-view.cache';
import { DevicesPanel } from './devices-panel';
import type { TelemetryRange } from './devices-api.client';
import { CONTROL_WIDGETS, applyLive, controlValue, seriesKeys } from './live-overlay';
import {
  BREAKPOINT_CONFIG,
  DashboardBreakpoint,
  DashboardDocument,
  DashboardWidget,
  LayoutCommit,
  STARTER_WIDGETS,
  WidgetAction,
  WidgetDropRequest,
  WidgetLayout,
  WidgetSettingChange,
  WidgetSettings,
  WidgetType,
  cloneWidget,
  cloneWidgets,
  widgetDefinition,
} from './dashboard-builder.models';
import {
  activeLayouts,
  clampWidgetLayout,
  compactLayouts,
  findFirstFreeLayout,
  layoutsOverlap,
  resolveCollisions,
  responsiveDefaultSize,
} from './dashboard-grid.engine';
import { WidgetLibrary } from './widget-library';
import {
  BulkWidgetAction,
  DashboardSettingsChange,
  WidgetInspector,
  WidgetInspectorPatch,
  WidgetLayoutFieldChange,
} from './widget-inspector';

type SaveState = 'saved' | 'saving' | 'unsaved';
type ToastKind = 'success' | 'info' | 'warning';

type DashboardSnapshot = DashboardContent;

interface ToastMessage {
  text: string;
  kind: ToastKind;
}

const HISTORY_LIMIT = 50;

@Component({
  selector: 'app-dashboard-builder-page',
  imports: [
    DashboardCanvas,
    DashboardIcon,
    DashboardTemplates,
    DevicesPanel,
    RouterLink,
    WidgetInspector,
    WidgetLibrary,
  ],
  templateUrl: './dashboard-builder.page.html',
  styleUrl: './dashboard-builder.page.css',
  // The dashboard is saved to the project on the server; the sync tracks its version.
  providers: [DashboardSync, DashboardLive],
  host: {
    '(document:keydown)': 'handleKeyboardShortcut($event)',
    '(document:click)': 'closeOpenMenu()',
  },
})
export class DashboardBuilderPage {
  private readonly documentRef = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectStore = inject(ProjectStore);
  private readonly menuState = inject(DashboardMenuState);
  protected readonly sync = inject(DashboardSync);
  private readonly api = inject(DashboardApiClient);
  private readonly libraryTrigger = viewChild<ElementRef<HTMLButtonElement>>('libraryTrigger');
  private readonly toolbarMenuTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('toolbarMenuTrigger');
  private readonly libraryPanel = viewChild<ElementRef<HTMLElement>>('libraryPanel');
  private readonly inspectorPanel = viewChild<ElementRef<HTMLElement>>('inspectorPanel');
  private readonly builderRoot = viewChild<ElementRef<HTMLElement>>('builderRoot');
  private readonly clipboard = signal<DashboardWidget | null>(null);
  private readonly undoStack = signal<DashboardSnapshot[]>([]);
  private readonly redoStack = signal<DashboardSnapshot[]>([]);
  private readonly hydrated = signal(false);
  private loadedProjectId: string | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private dashboardNameHistoryRecorded = false;
  private settingsReturnWidgetId: string | null = null;

  private readonly projectIdSignal = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('projectId'))),
    { initialValue: this.route.snapshot.parent?.paramMap.get('projectId') ?? 'project' },
  );

  protected readonly projectId = computed(() => this.projectIdSignal() ?? 'project');
  protected readonly project = computed(() => this.projectStore.projectById(this.projectId()));
  protected readonly projectName = computed(() => this.project()?.name ?? 'IoT project');
  protected readonly dashboardName = signal('Greenhouse operations');
  protected readonly deviceScope = signal('All devices');
  protected readonly dateRange = signal('24h');
  protected readonly widgets = signal<DashboardWidget[]>([]);
  protected readonly activeBreakpoint = signal<DashboardBreakpoint>('desktop');
  protected readonly editMode = signal(true);
  protected readonly layoutLocked = signal(false);
  protected readonly selectedIds = signal<readonly string[]>([]);
  protected readonly libraryOpen = signal(false);
  protected readonly inspectorOpen = signal(false);
  protected readonly saveState = signal<SaveState>('saved');
  protected readonly publishing = signal(false);
  protected readonly published = signal(false);
  protected readonly toast = signal<ToastMessage | null>(null);
  protected readonly announcement = signal('Dashboard builder ready.');
  /** The first load of this project's dashboard; the canvas shows a skeleton meanwhile. */
  protected readonly loadingDashboard = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly datastreams = this.sync.datastreams;
  /** The project's parts, for naming what a datastream reads. */
  protected readonly components = signal<{ id: string; label: string }[]>([]);
  protected readonly templatesOpen = signal(false);
  protected readonly devicesOpen = signal(false);
  protected readonly live = inject(DashboardLive);
  private readonly viewCache = inject(DashboardViewCache);
  /** The device the dashboard shows, from the document's device scope. */
  protected readonly selectedDevice = computed(
    () => this.live.devices().find((device) => device.id === this.deviceScope()) ?? null,
  );
  /** Preview with a device selected: widgets show and send its real values. */
  protected readonly liveActive = computed(
    () => !this.editMode() && this.selectedDevice() !== null,
  );
  protected readonly canvasWidgets = computed(() =>
    this.liveActive() ? applyLive(this.widgets(), this.live.snapshot()) : this.widgets(),
  );
  protected readonly chartSeries = computed(() => (this.liveActive() ? this.live.series() : {}));
  protected readonly dashboardVersion = signal(0);

  protected readonly breakpointOptions = (
    Object.keys(BREAKPOINT_CONFIG) as DashboardBreakpoint[]
  ).map((id) => ({ id, ...BREAKPOINT_CONFIG[id] }));
  protected readonly canUndo = computed(() => this.undoStack().length > 0);
  protected readonly canRedo = computed(() => this.redoStack().length > 0);
  protected readonly toolbarMenuOpen = computed(() => this.menuState.activeMenu() === 'toolbar');
  protected readonly overlayPanelOpen = computed(
    () => this.editMode() && (this.libraryOpen() || this.inspectorOpen()),
  );
  protected readonly selectedWidgets = computed(() => {
    const ids = new Set(this.selectedIds());
    return this.widgets().filter((widget) => ids.has(widget.id));
  });
  protected readonly primarySelectedWidget = computed(() =>
    this.selectedWidgets().length === 1 ? this.selectedWidgets()[0] : null,
  );
  protected readonly saveLabel = computed(() => {
    if (this.saveState() === 'saving') return 'Saving…';
    if (this.saveState() === 'unsaved') return 'Unsaved changes';
    return 'All changes saved';
  });

  /** Polls the selected device while the dashboard is live; stops otherwise. */
  private readonly followLive = effect(() => {
    const device = this.selectedDevice();
    if (!this.liveActive() || !device) {
      this.live.stop();
      return;
    }
    this.live.watch({
      projectId: this.projectId(),
      deviceId: device.id,
      keys: seriesKeys(this.widgets()),
      range: (['1h', '24h', '7d', '30d'].includes(this.dateRange())
        ? this.dateRange()
        : '24h') as TelemetryRange,
    });
  });

  private readonly hydrateProject = effect(() => {
    const projectId = this.projectId();
    if (this.loadedProjectId === projectId) return;
    this.loadedProjectId = projectId;
    void this.loadDashboard(projectId);
  });

  private readonly autoSaveDashboard = effect(() => {
    const snapshot = this.currentSnapshot();
    if (!this.hydrated()) return;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    // Loading the dashboard is not an edit: nothing to save until it differs.
    if (this.sync.isSaved(snapshot)) {
      if (this.saveState() !== 'saving') this.saveState.set('saved');
      return;
    }
    this.saveState.set('unsaved');
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      void this.persist(snapshot, false);
    }, 900);
  });

  constructor() {
    const viewportWidth = this.documentRef.defaultView?.innerWidth ?? 1600;
    if (viewportWidth <= 560) this.activeBreakpoint.set('mobile');
    else if (viewportWidth <= 920) this.activeBreakpoint.set('tablet');

    this.destroyRef.onDestroy(() => {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
        // Leaving the page must not drop the last edit; the save outlives the page.
        void this.sync.save(this.currentSnapshot());
      }
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.menuState.close();
    });
  }

  protected beginDashboardNameEdit(): void {
    this.dashboardNameHistoryRecorded = false;
  }

  protected setDashboardName(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    if (name === this.dashboardName()) return;
    if (!this.dashboardNameHistoryRecorded) {
      this.pushHistory();
      this.redoStack.set([]);
      this.dashboardNameHistoryRecorded = true;
    }
    this.dashboardName.set(name);
  }

  protected finishDashboardNameEdit(): void {
    this.dashboardNameHistoryRecorded = false;
  }

  protected selectBreakpoint(breakpoint: DashboardBreakpoint): void {
    this.activeBreakpoint.set(breakpoint);
    this.announce(`${BREAKPOINT_CONFIG[breakpoint].label} layout selected.`);
  }

  protected handleBreakpointKeydown(event: KeyboardEvent, currentIndex: number): void {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex =
        (currentIndex - 1 + this.breakpointOptions.length) % this.breakpointOptions.length;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % this.breakpointOptions.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = this.breakpointOptions.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.selectBreakpoint(this.breakpointOptions[nextIndex].id);
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    (buttons?.item(nextIndex) as HTMLButtonElement | undefined)?.focus();
  }

  protected togglePreview(): void {
    this.editMode.update((editMode) => !editMode);
    this.closeOpenMenu();
    if (!this.editMode()) {
      this.announce('Preview mode. Dashboard controls are now interactive.');
    } else {
      this.announce('Edit mode. Widget layout controls are enabled.');
    }
  }

  protected toggleLayoutLock(): void {
    this.layoutLocked.update((locked) => !locked);
    this.showToast(this.layoutLocked() ? 'Layout locked' : 'Layout unlocked', 'info');
  }

  protected toggleLibrary(event?: MouseEvent): void {
    event?.stopPropagation();
    this.closeOpenMenu();
    const opening = !this.libraryOpen();
    this.libraryOpen.set(opening);
    this.inspectorOpen.set(false);
    if (opening) {
      setTimeout(() => this.focusPanel('library'));
    } else {
      setTimeout(() => this.libraryTrigger()?.nativeElement.focus());
    }
  }

  protected closePanels(): void {
    if (this.inspectorOpen()) this.closeInspector();
    else this.closeLibrary();
  }

  protected closeLibrary(): void {
    this.libraryOpen.set(false);
    setTimeout(() => this.libraryTrigger()?.nativeElement.focus());
  }

  protected closeInspector(): void {
    this.inspectorOpen.set(false);
    const widgetId = this.settingsReturnWidgetId;
    this.settingsReturnWidgetId = null;
    setTimeout(() => {
      const trigger = widgetId ? this.findWidgetSettingsTrigger(widgetId) : null;
      (trigger ?? this.toolbarMenuTrigger()?.nativeElement)?.focus();
    });
  }

  protected openDashboardSettings(): void {
    this.closeOpenMenu();
    this.settingsReturnWidgetId = null;
    this.selectedIds.set([]);
    this.libraryOpen.set(false);
    this.inspectorOpen.set(true);
    setTimeout(() => this.focusPanel('inspector'));
  }

  private openWidgetSettings(widgetId: string): void {
    if (!this.widgets().some((widget) => widget.id === widgetId)) return;
    this.closeOpenMenu();
    this.settingsReturnWidgetId = widgetId;
    this.selectedIds.set([widgetId]);
    this.libraryOpen.set(false);
    this.inspectorOpen.set(true);
    setTimeout(() => this.focusPanel('inspector'));
  }

  protected toggleToolbarMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuState.toggle('toolbar');
  }

  protected closeToolbarMenu(restoreFocus = false): void {
    const wasOpen = this.toolbarMenuOpen();
    this.menuState.close('toolbar');
    if (restoreFocus && wasOpen) {
      setTimeout(() => this.toolbarMenuTrigger()?.nativeElement.focus());
    }
  }

  protected closeOpenMenu(): void {
    this.menuState.close();
  }

  protected addWidget(request: WidgetDropRequest): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before adding widgets.', 'warning');
      return;
    }
    const definition = widgetDefinition(request.type);
    const id = this.createWidgetId(request.type);
    const layouts = {} as Record<DashboardBreakpoint, WidgetLayout>;

    for (const breakpoint of Object.keys(BREAKPOINT_CONFIG) as DashboardBreakpoint[]) {
      const occupied = this.widgets().map((widget) => widget.layouts[breakpoint]);
      const size = responsiveDefaultSize(definition, breakpoint);
      const preferred =
        breakpoint === this.activeBreakpoint() && request.x !== undefined && request.y !== undefined
          ? { x: request.x, y: request.y }
          : undefined;
      layouts[breakpoint] = findFirstFreeLayout(
        occupied,
        size,
        BREAKPOINT_CONFIG[breakpoint].columns,
        preferred,
      );
    }

    const widget: DashboardWidget = {
      id,
      type: request.type,
      title: definition.title,
      subtitle: this.defaultSubtitle(request.type),
      // Unbound until the user picks one of the project's datastreams in the inspector.
      deviceId: '',
      datasource: '',
      state: 'online',
      layouts,
      settings: this.defaultSettings(request.type),
    };

    this.commitWidgets([...this.widgets(), widget], `${definition.title} added to the dashboard.`);
    this.selectedIds.set([id]);
    if (this.libraryOpen()) this.closeLibrary();
  }

  protected commitLayouts(commit: LayoutCommit): void {
    const breakpoint = this.activeBreakpoint();
    const nextWidgets = this.widgets().map((widget) => ({
      ...widget,
      layouts: {
        ...widget.layouts,
        [breakpoint]: { ...(commit.layouts[widget.id] ?? widget.layouts[breakpoint]) },
      },
    }));
    this.commitWidgets(nextWidgets, commit.message);
  }

  protected updateSelection(ids: readonly string[]): void {
    this.selectedIds.set(ids);
  }

  protected handleWidgetAction(request: WidgetAction): void {
    if (request.action === 'configure') this.openWidgetSettings(request.widgetId);
    else if (request.action === 'duplicate') this.duplicateWidgets([request.widgetId]);
    else if (request.action === 'copy') this.copyWidget(request.widgetId);
    else if (request.action === 'delete') this.deleteWidgets([request.widgetId]);
    else this.toggleWidgetLock(request.widgetId);
  }

  protected handleWidgetSetting(change: WidgetSettingChange): void {
    const widget = this.widgets().find((entry) => entry.id === change.widgetId);
    if (this.liveActive() && widget?.datasource && CONTROL_WIDGETS.has(widget.type)) {
      // A live control talks to the device; the saved dashboard does not change.
      const stream = this.datastreams().find((entry) => entry.key === widget.datasource);
      this.live
        .setControl(widget.datasource, controlValue(stream?.dataType, change.controlValue))
        .catch((error: unknown) =>
          this.showToast(
            apiErrorMessage(error) ?? 'The device did not accept the value.',
            'warning',
          ),
        );
      return;
    }
    this.widgets.update((widgets) =>
      widgets.map((widget) =>
        widget.id === change.widgetId
          ? {
              ...widget,
              settings: { ...widget.settings, controlValue: change.controlValue },
            }
          : widget,
      ),
    );
  }

  protected patchWidget(change: WidgetInspectorPatch): void {
    const nextWidgets = this.widgets().map((widget) => {
      if (widget.id !== change.widgetId) return widget;
      return {
        ...widget,
        ...change.patch,
        settings: change.patch.settings
          ? { ...widget.settings, ...change.patch.settings }
          : widget.settings,
      };
    });
    this.commitWidgets(nextWidgets, 'Widget settings updated.');
  }

  protected updateWidgetLayout(change: WidgetLayoutFieldChange): void {
    const widget = this.widgets().find((item) => item.id === change.widgetId);
    if (!widget) return;
    if (this.layoutLocked() || widget.settings.locked) {
      this.showToast('Unlock the layout and widget before changing its grid position.', 'warning');
      return;
    }
    const breakpoint = this.activeBreakpoint();
    const proposed = clampWidgetLayout(
      change.layout,
      widgetDefinition(widget.type),
      BREAKPOINT_CONFIG[breakpoint].columns,
    );
    const layouts = activeLayouts(this.widgets(), breakpoint);
    layouts[widget.id] = proposed;
    const resolution = resolveCollisions(
      layouts,
      widget.id,
      new Set(
        this.widgets()
          .filter((item) => item.settings.locked)
          .map((item) => item.id),
      ),
    );
    if (!resolution.valid) {
      this.showToast('That position is blocked by a locked widget.', 'warning');
      return;
    }
    this.commitLayouts({
      layouts: resolution.layouts,
      message: `${widget.title} layout updated.`,
    });
  }

  protected updateDashboardSettings(change: DashboardSettingsChange): void {
    this.pushHistory();
    if (change.field === 'deviceScope') this.deviceScope.set(change.value);
    else this.dateRange.set(change.value);
    this.redoStack.set([]);
    this.announce('Dashboard defaults updated.');
  }

  protected handleBulkAction(action: BulkWidgetAction): void {
    const ids = this.selectedIds();
    if (ids.length < 2) return;
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before changing multiple widgets.', 'warning');
      return;
    }
    if (action === 'delete') {
      this.deleteWidgets(ids);
      return;
    }
    if (action === 'duplicate') {
      this.duplicateWidgets(ids);
      return;
    }

    const breakpoint = this.activeBreakpoint();
    const selected = this.selectedWidgets();
    const target =
      action === 'align-left'
        ? Math.min(...selected.map((widget) => widget.layouts[breakpoint].x))
        : Math.min(...selected.map((widget) => widget.layouts[breakpoint].y));
    const selectedIdSet = new Set(ids);
    const columns = BREAKPOINT_CONFIG[breakpoint].columns;
    const occupied = this.widgets()
      .filter((widget) => !selectedIdSet.has(widget.id) || widget.settings.locked)
      .map((widget) => ({ ...widget.layouts[breakpoint] }));
    const alignedLayouts = new Map<string, WidgetLayout>();
    const movableSelection = selected
      .filter((widget) => !widget.settings.locked)
      .sort((first, second) => {
        const firstLayout = first.layouts[breakpoint];
        const secondLayout = second.layouts[breakpoint];
        return action === 'align-left'
          ? firstLayout.y - secondLayout.y || firstLayout.x - secondLayout.x
          : firstLayout.x - secondLayout.x || firstLayout.y - secondLayout.y;
      });

    for (const widget of movableSelection) {
      const current = widget.layouts[breakpoint];
      let candidate: WidgetLayout;
      if (action === 'align-left') {
        candidate = {
          ...current,
          x: Math.min(target, Math.max(0, columns - current.cols)),
        };
        while (occupied.some((layout) => layoutsOverlap(candidate, layout))) {
          candidate = { ...candidate, y: candidate.y + 1 };
        }
      } else {
        candidate = { ...current, y: target };
        if (occupied.some((layout) => layoutsOverlap(candidate, layout))) {
          const availableX = Array.from(
            { length: columns - current.cols + 1 },
            (_, index) => index,
          ).find((x) => {
            const proposed = { ...candidate, x };
            return !occupied.some((layout) => layoutsOverlap(proposed, layout));
          });
          if (availableX === undefined) {
            this.showToast('The selected widgets cannot fit on one row.', 'warning');
            return;
          }
          candidate = { ...candidate, x: availableX };
        }
      }
      alignedLayouts.set(widget.id, candidate);
      occupied.push(candidate);
    }

    const nextWidgets = this.widgets().map((widget) => {
      const aligned = alignedLayouts.get(widget.id);
      if (!aligned) return widget;
      return {
        ...widget,
        layouts: {
          ...widget.layouts,
          [breakpoint]: aligned,
        },
      };
    });
    this.commitWidgets(
      nextWidgets,
      `Selected widgets aligned ${action === 'align-left' ? 'left' : 'to the top'}.`,
    );
  }

  protected compactCurrentLayout(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before compacting widgets.', 'warning');
      return;
    }
    const breakpoint = this.activeBreakpoint();
    const compacted = compactLayouts(
      activeLayouts(this.widgets(), breakpoint),
      new Set(
        this.widgets()
          .filter((widget) => widget.settings.locked)
          .map((widget) => widget.id),
      ),
    );
    this.commitLayouts({ layouts: compacted, message: 'Widgets compacted to remove empty rows.' });
    this.closeToolbarMenu(true);
  }

  protected undo(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before undoing changes.', 'warning');
      return;
    }
    const history = this.undoStack();
    const snapshot = history.at(-1);
    if (!snapshot) return;
    this.redoStack.update((redo) => [...redo, this.currentSnapshot()].slice(-HISTORY_LIMIT));
    this.undoStack.set(history.slice(0, -1));
    this.restoreSnapshot(snapshot);
    this.announce('Last dashboard change undone.');
  }

  protected redo(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before redoing changes.', 'warning');
      return;
    }
    const history = this.redoStack();
    const snapshot = history.at(-1);
    if (!snapshot) return;
    this.undoStack.update((undo) => [...undo, this.currentSnapshot()].slice(-HISTORY_LIMIT));
    this.redoStack.set(history.slice(0, -1));
    this.restoreSnapshot(snapshot);
    this.announce('Dashboard change restored.');
  }

  protected async saveDashboard(): Promise<boolean> {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    const saved = await this.persist(this.currentSnapshot(), true);
    if (saved) this.showToast('Dashboard saved', 'success');
    return saved;
  }

  /** Reloads the server's dashboard, discarding unsaved edits. Used after a conflict. */
  protected async reloadDashboard(): Promise<void> {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
    await this.loadDashboard(this.projectId(), true);
  }

  protected async publishDashboard(): Promise<void> {
    if (this.publishing()) return;
    if (!(await this.saveDashboard())) return;
    this.publishing.set(true);
    setTimeout(() => {
      this.publishing.set(false);
      this.published.set(true);
      this.showToast('Dashboard published successfully', 'success');
      this.announce('Dashboard published successfully.');
    }, 900);
  }

  protected exportDashboard(): void {
    const dashboard: DashboardDocument = {
      schemaVersion: 1,
      dashboardId: `dashboard-${this.projectId()}`,
      name: this.dashboardName(),
      deviceScope: this.deviceScope(),
      dateRange: this.dateRange(),
      widgets: cloneWidgets(this.widgets()),
    };
    const blob = new Blob([JSON.stringify(dashboard, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.documentRef.createElement('a');
    anchor.href = url;
    anchor.download = `${this.slugify(this.dashboardName()) || 'dashboard'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.showToast('Dashboard JSON exported', 'success');
    this.closeToolbarMenu(true);
  }

  protected resetDashboard(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before restoring the starter dashboard.', 'warning');
      return;
    }
    this.pushHistory();
    // The starter is an example: bindings to datastreams this project lacks are cleared.
    this.widgets.set(this.sync.unbindUnknown(STARTER_WIDGETS));
    this.selectedIds.set(['temperature']);
    this.redoStack.set([]);
    this.showToast('Starter layout restored', 'info');
    this.closeToolbarMenu(true);
  }

  protected clearDashboard(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before clearing the canvas.', 'warning');
      return;
    }
    if (this.widgets().length === 0) return;
    this.pushHistory();
    this.widgets.set([]);
    this.selectedIds.set([]);
    this.redoStack.set([]);
    this.showToast('Canvas cleared — Undo is available', 'warning');
    this.closeToolbarMenu(true);
  }

  protected handleKeyboardShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.menuState.activeMenu()) {
      event.preventDefault();
      this.closeToolbarMenu(true);
      return;
    }

    if (this.overlayPanelOpen() && event.key === 'Escape') {
      event.preventDefault();
      if (this.inspectorOpen()) this.closeInspector();
      else this.closeLibrary();
      return;
    }

    if (this.overlayPanelOpen() && event.key === 'Tab') {
      this.trapPanelFocus(event);
      return;
    }

    if (!this.editMode() && event.key === 'Escape') {
      event.preventDefault();
      this.togglePreview();
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (!this.editMode()) {
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (modifier && event.key.toLowerCase() === 'c') {
      const selectedId = this.selectedIds()[0];
      if (selectedId) {
        event.preventDefault();
        this.copyWidget(selectedId);
      }
    } else if (modifier && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.pasteWidget();
    } else if (modifier && event.key.toLowerCase() === 'd') {
      if (this.selectedIds().length > 0) {
        event.preventDefault();
        this.duplicateWidgets(this.selectedIds());
      }
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      this.selectedIds().length > 0
    ) {
      event.preventDefault();
      this.deleteWidgets(this.selectedIds());
    } else if (event.key === 'Escape') {
      if (!this.editMode()) this.togglePreview();
      else {
        this.selectedIds.set([]);
        this.closePanels();
      }
    }
  }

  protected relayMessage(message: string): void {
    this.announce(message);
    this.showToast(
      message,
      message.includes('blocked') || message.includes('locked') ? 'warning' : 'info',
    );
  }

  private duplicateWidgets(ids: readonly string[]): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before duplicating widgets.', 'warning');
      return;
    }
    const originals = this.widgets().filter((widget) => ids.includes(widget.id));
    if (originals.length === 0) return;
    const nextWidgets = [...this.widgets()];
    const newIds: string[] = [];

    for (const original of originals) {
      const duplicate = cloneWidget(original);
      duplicate.id = this.createWidgetId(original.type);
      duplicate.title = `${original.title} copy`;
      for (const breakpoint of Object.keys(BREAKPOINT_CONFIG) as DashboardBreakpoint[]) {
        const source = original.layouts[breakpoint];
        duplicate.layouts[breakpoint] = findFirstFreeLayout(
          nextWidgets.map((widget) => widget.layouts[breakpoint]),
          { cols: source.cols, rows: source.rows },
          BREAKPOINT_CONFIG[breakpoint].columns,
          { x: source.x + 1, y: source.y + 1 },
        );
      }
      nextWidgets.push(duplicate);
      newIds.push(duplicate.id);
    }

    this.commitWidgets(
      nextWidgets,
      `${originals.length} widget${originals.length === 1 ? '' : 's'} duplicated.`,
    );
    this.selectedIds.set(newIds);
  }

  private copyWidget(widgetId: string): void {
    const widget = this.widgets().find((item) => item.id === widgetId);
    if (!widget) return;
    this.clipboard.set(cloneWidget(widget));
    this.showToast(`${widget.title} copied`, 'info');
  }

  private pasteWidget(): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before pasting widgets.', 'warning');
      return;
    }
    const widget = this.clipboard();
    if (!widget) {
      this.showToast('Copy a widget before pasting.', 'warning');
      return;
    }
    const temporaryId = widget.id;
    const existingClipboardWidget = this.widgets().find((item) => item.id === temporaryId);
    const source = existingClipboardWidget ?? widget;
    const clone = cloneWidget(source);
    clone.id = this.createWidgetId(source.type);
    clone.title = `${source.title} copy`;
    for (const breakpoint of Object.keys(BREAKPOINT_CONFIG) as DashboardBreakpoint[]) {
      const sourceLayout = source.layouts[breakpoint];
      clone.layouts[breakpoint] = findFirstFreeLayout(
        this.widgets().map((item) => item.layouts[breakpoint]),
        { cols: sourceLayout.cols, rows: sourceLayout.rows },
        BREAKPOINT_CONFIG[breakpoint].columns,
        { x: sourceLayout.x + 1, y: sourceLayout.y + 1 },
      );
    }
    this.commitWidgets([...this.widgets(), clone], `${source.title} pasted.`);
    this.selectedIds.set([clone.id]);
  }

  private deleteWidgets(ids: readonly string[]): void {
    if (this.layoutLocked()) {
      this.showToast('Unlock the layout before deleting widgets.', 'warning');
      return;
    }
    const idSet = new Set(ids);
    const currentWidgets = this.widgets();
    const deleted = currentWidgets.filter((widget) => idSet.has(widget.id));
    if (deleted.length === 0) return;
    const firstDeletedIndex = currentWidgets.findIndex((widget) => idSet.has(widget.id));
    const remainingWidgets = currentWidgets.filter((widget) => !idSet.has(widget.id));
    const nextWidget = remainingWidgets[Math.min(firstDeletedIndex, remainingWidgets.length - 1)];
    this.commitWidgets(
      remainingWidgets,
      `${deleted.length} widget${deleted.length === 1 ? '' : 's'} deleted.`,
    );
    this.selectedIds.set(nextWidget ? [nextWidget.id] : []);
    this.showToast('Widget removed — Undo is available', 'warning');
    setTimeout(() => this.restoreFocusAfterDelete(nextWidget?.id));
  }

  private toggleWidgetLock(widgetId: string): void {
    let locked = false;
    const nextWidgets = this.widgets().map((widget) => {
      if (widget.id !== widgetId) return widget;
      locked = !widget.settings.locked;
      return { ...widget, settings: { ...widget.settings, locked } };
    });
    this.commitWidgets(nextWidgets, locked ? 'Widget locked.' : 'Widget unlocked.');
  }

  private commitWidgets(nextWidgets: DashboardWidget[], message: string): void {
    this.pushHistory();
    this.widgets.set(cloneWidgets(nextWidgets));
    this.redoStack.set([]);
    this.announce(message);
  }

  private pushHistory(): void {
    this.undoStack.update((history) => [...history, this.currentSnapshot()].slice(-HISTORY_LIMIT));
  }

  private currentSnapshot(): DashboardSnapshot {
    return {
      name: this.dashboardName(),
      deviceScope: this.deviceScope(),
      dateRange: this.dateRange(),
      widgets: cloneWidgets(this.widgets()),
    };
  }

  private restoreSnapshot(snapshot: DashboardSnapshot): void {
    this.dashboardName.set(snapshot.name);
    this.deviceScope.set(snapshot.deviceScope);
    this.dateRange.set(snapshot.dateRange);
    this.widgets.set(cloneWidgets(snapshot.widgets));
    this.selectedIds.update((ids) =>
      ids.filter((id) => snapshot.widgets.some((widget) => widget.id === id)),
    );
  }

  private async loadDashboard(projectId: string, reload = false): Promise<void> {
    this.hydrated.set(false);
    this.loadFailed.set(false);
    void this.live.loadDevices(projectId);
    // A return visit draws the last known dashboard at once and checks the server behind it.
    const cached = reload ? undefined : this.sync.cachedView(projectId);
    if (cached) {
      this.showContent(
        this.sync.adopt(projectId, cached),
        this.viewCache.components(projectId) ?? [],
      );
    } else if (!reload) {
      this.loadingDashboard.set(true);
    }
    try {
      if (cached) {
        const [fresh, components] = await Promise.all([
          this.sync.fetchLatest(projectId),
          this.api.listComponents(projectId).catch(() => this.components()),
        ]);
        if (projectId !== this.projectId()) return;
        this.components.set(components);
        this.viewCache.setComponents(projectId, components);
        this.sync.datastreams.set(fresh.datastreams);
        // Someone else saved meanwhile: take it, unless the user has already edited.
        if (
          fresh.version !== this.sync.currentVersion &&
          this.sync.isSaved(this.currentSnapshot())
        ) {
          this.showContent(this.sync.accept(fresh), components);
        }
        return;
      }
      const [content, components] = await Promise.all([
        this.sync.load(projectId),
        this.api.listComponents(projectId).catch(() => []),
      ]);
      if (projectId !== this.projectId()) return;
      this.viewCache.setComponents(projectId, components);
      this.showContent(content, components);
    } catch {
      if (projectId !== this.projectId() || cached) return;
      this.loadFailed.set(true);
      this.showToast(
        'The dashboard could not be loaded. Check the connection and retry.',
        'warning',
      );
    } finally {
      if (projectId === this.projectId()) this.loadingDashboard.set(false);
    }
  }

  private showContent(
    content: DashboardContent,
    components: { id: string; label: string }[],
  ): void {
    this.hydrated.set(false);
    this.components.set(components);
    this.dashboardVersion.set(this.sync.currentVersion);
    this.dashboardName.set(content.name);
    this.deviceScope.set(content.deviceScope);
    this.dateRange.set(content.dateRange);
    this.widgets.set(content.widgets);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.selectedIds.set([]);
    this.saveState.set('saved');
    this.hydrated.set(true);
  }

  /** Saves through the sync and turns its outcome into the page's state and messages. */
  private async persist(snapshot: DashboardSnapshot, explicit: boolean): Promise<boolean> {
    this.saveState.set('saving');
    const outcome: SaveOutcome = await this.sync.save(snapshot);
    const saved = outcome === 'saved' || outcome === 'unchanged';
    this.dashboardVersion.set(this.sync.currentVersion);
    this.saveState.set(saved && this.sync.isSaved(this.currentSnapshot()) ? 'saved' : 'unsaved');
    if (outcome === 'conflict') {
      this.showToast(
        'This dashboard was changed elsewhere (another tab or an AI proposal). Reload it before saving.',
        'warning',
      );
    } else if (outcome === 'rejected') {
      this.showToast(this.sync.lastProblem() || 'The server refused this dashboard.', 'warning');
    } else if (outcome === 'offline' && explicit) {
      this.showToast('Dashboard could not be saved. Check the connection.', 'warning');
    }
    return saved;
  }

  protected openDevices(): void {
    this.closeToolbarMenu(true);
    this.devicesOpen.set(true);
  }

  /** Shows a device on the dashboard; stored with the dashboard as its device scope. */
  protected selectDevice(deviceId: string): void {
    this.updateDashboardSettings({ field: 'deviceScope', value: deviceId });
  }

  protected openTemplates(): void {
    this.closeToolbarMenu(true);
    this.templatesOpen.set(true);
  }

  /** A template replaced the dashboard on the server; show what it wrote. */
  protected applyTemplate(event: TemplateApplied): void {
    const content = this.sync.accept(event.view);
    this.pushHistory();
    this.hydrated.set(false);
    this.dashboardName.set(content.name);
    this.deviceScope.set(content.deviceScope);
    this.dateRange.set(content.dateRange);
    this.widgets.set(content.widgets);
    this.selectedIds.set([]);
    this.dashboardVersion.set(this.sync.currentVersion);
    this.hydrated.set(true);
    this.showToast(
      event.warnings[0] ?? 'Template applied. Rearrange it freely; the template stays as it was.',
      event.warnings.length ? 'warning' : 'success',
    );
  }

  protected showPanelMessage(message: { text: string; kind: 'success' | 'warning' }): void {
    this.showToast(message.text, message.kind);
  }

  /** Creates a datastream and binds the selected widget to it. */
  protected async createDatastream(input: DatastreamInput): Promise<void> {
    try {
      const stream = await this.api.createDatastream(this.projectId(), input);
      this.datastreams.update((streams) => [...streams, stream]);
      const widget = this.primarySelectedWidget();
      if (widget) {
        this.patchWidget({
          widgetId: widget.id,
          patch: { datasource: stream.key, deviceId: stream.componentId ?? '' },
        });
      }
      this.showToast(`Datastream "${stream.key}" added`, 'success');
    } catch (error: unknown) {
      this.showToast(apiErrorMessage(error) ?? 'The datastream could not be added.', 'warning');
    }
  }

  private defaultSettings(type: WidgetType): WidgetSettings {
    return {
      accent: '#545454',
      background: 'white',
      showHeader: true,
      unit:
        type === 'value'
          ? '°C'
          : type === 'gauge' || type === 'progress' || type === 'slider'
            ? '%'
            : '',
      decimals: type === 'value' ? 1 : 0,
      controlValue: type === 'switch' || type === 'led' ? 1 : 64,
      locked: false,
    };
  }

  private defaultSubtitle(type: WidgetType): string {
    if (type === 'text') return 'Add a note for this dashboard section.';
    if (type === 'table' || type === 'event-log') return 'Recent device events';
    if (type.includes('chart')) return 'Last 24 hours';
    return 'Greenhouse sensor';
  }

  private createWidgetId(type: WidgetType): string {
    const suffix =
      this.documentRef.defaultView?.crypto.randomUUID().slice(0, 8) ?? Date.now().toString(36);
    return `${type}-${suffix}`;
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private focusPanel(panel: 'library' | 'inspector'): void {
    const element =
      panel === 'library'
        ? this.libraryPanel()?.nativeElement
        : this.inspectorPanel()?.nativeElement;
    const preferred =
      panel === 'library'
        ? element?.querySelector<HTMLElement>('input[type="search"]')
        : element?.querySelector<HTMLElement>('.close-panel');
    preferred?.focus();
  }

  private findWidgetSettingsTrigger(widgetId: string): HTMLButtonElement | null {
    const triggers = this.builderRoot()?.nativeElement.querySelectorAll<HTMLButtonElement>(
      '.widget-settings-trigger[data-widget-id]',
    );
    return (
      Array.from(triggers ?? []).find((element) => element.dataset['widgetId'] === widgetId) ?? null
    );
  }

  private restoreFocusAfterDelete(widgetId?: string): void {
    if (this.overlayPanelOpen() && this.inspectorOpen()) {
      this.focusPanel('inspector');
      return;
    }
    const widgets = this.builderRoot()?.nativeElement.querySelectorAll<HTMLElement>(
      '.dashboard-widget[data-widget-id]',
    );
    const nextWidget = Array.from(widgets ?? []).find(
      (element) => element.dataset['widgetId'] === widgetId,
    );
    const handle = nextWidget?.querySelector<HTMLElement>('.widget-drag-handle');
    (handle ?? this.libraryTrigger()?.nativeElement)?.focus();
  }

  private trapPanelFocus(event: KeyboardEvent): void {
    const panel = this.inspectorOpen()
      ? this.inspectorPanel()?.nativeElement
      : this.libraryPanel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const active = this.documentRef.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  private announce(message: string): void {
    this.announcement.set('');
    setTimeout(() => this.announcement.set(message));
  }

  private showToast(text: string, kind: ToastKind): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set({ text, kind });
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
      this.toastTimer = null;
    }, 3200);
  }
}

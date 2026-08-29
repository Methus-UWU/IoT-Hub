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
  WIDGET_DEFINITIONS,
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

interface DashboardSnapshot {
  name: string;
  deviceScope: string;
  dateRange: string;
  widgets: DashboardWidget[];
}

interface ToastMessage {
  text: string;
  kind: ToastKind;
}

const HISTORY_LIMIT = 50;
const STORAGE_VERSION = 1;

@Component({
  selector: 'app-dashboard-builder-page',
  imports: [DashboardCanvas, DashboardIcon, RouterLink, WidgetInspector, WidgetLibrary],
  templateUrl: './dashboard-builder.page.html',
  styleUrl: './dashboard-builder.page.css',
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

  private readonly hydrateProject = effect(() => {
    const projectId = this.projectId();
    if (this.loadedProjectId === projectId) return;
    this.loadedProjectId = projectId;
    this.hydrated.set(false);
    this.restoreDashboard(projectId);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.selectedIds.set([]);
    this.hydrated.set(true);
  });

  private readonly autoSaveDashboard = effect(() => {
    const snapshot = this.currentSnapshot();
    const projectId = this.projectId();
    if (!this.hydrated()) return;
    this.saveState.set('unsaved');
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      const saved = this.persistSnapshot(projectId, snapshot);
      this.saveState.set(saved ? 'saved' : 'unsaved');
      this.autoSaveTimer = null;
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
        this.persistSnapshot(this.projectId(), this.currentSnapshot(), false);
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
      deviceId: 'greenhouse-01',
      datasource: this.defaultDatasource(request.type),
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

  protected saveDashboard(): boolean {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.saveState.set('saving');
    const saved = this.persistSnapshot(this.projectId(), this.currentSnapshot());
    this.saveState.set(saved ? 'saved' : 'unsaved');
    if (saved) {
      this.showToast('Dashboard saved', 'success');
    }
    return saved;
  }

  protected publishDashboard(): void {
    if (this.publishing()) return;
    if (!this.saveDashboard()) return;
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
    this.widgets.set(cloneWidgets(STARTER_WIDGETS));
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

  private restoreDashboard(projectId: string): void {
    const stored = this.documentRef.defaultView?.localStorage.getItem(this.storageKey(projectId));
    if (!stored) {
      this.dashboardName.set(
        this.projectName().toLowerCase().includes('greenhouse')
          ? 'Greenhouse operations'
          : `${this.projectName()} dashboard`,
      );
      this.deviceScope.set('All devices');
      this.dateRange.set('24h');
      // No saved dashboard means the user has not built one. Seeding sample
      // widgets here made a brand-new project look like it already had a
      // dashboard, and counted charts the user never created. The starter
      // layout is still available from the toolbar, on request.
      this.widgets.set([]);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(stored);
      if (!this.isStoredDashboard(parsed)) throw new Error('Invalid dashboard document');
      this.dashboardName.set(parsed.name);
      this.deviceScope.set(parsed.deviceScope);
      this.dateRange.set(parsed.dateRange);
      this.widgets.set(cloneWidgets(parsed.widgets));
    } catch {
      // Discarding the unreadable draft is right; replacing it with sample
      // widgets would silently invent content the user never made.
      this.widgets.set([]);
      this.showToast('The saved dashboard could not be read, so it was cleared.', 'warning');
    }
  }

  private persistSnapshot(
    projectId: string,
    snapshot: DashboardSnapshot,
    showFailure = true,
  ): boolean {
    const dashboard: DashboardDocument = {
      schemaVersion: STORAGE_VERSION,
      dashboardId: `dashboard-${projectId}`,
      ...snapshot,
    };
    try {
      this.documentRef.defaultView?.localStorage.setItem(
        this.storageKey(projectId),
        JSON.stringify(dashboard),
      );
      return true;
    } catch {
      this.saveState.set('unsaved');
      if (showFailure) {
        this.showToast('Dashboard could not be saved in this browser.', 'warning');
      }
      return false;
    }
  }

  private isStoredDashboard(value: unknown): value is DashboardDocument {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<DashboardDocument>;
    return (
      candidate.schemaVersion === STORAGE_VERSION &&
      typeof candidate.name === 'string' &&
      typeof candidate.deviceScope === 'string' &&
      typeof candidate.dateRange === 'string' &&
      Array.isArray(candidate.widgets) &&
      candidate.widgets.every((widget) => this.isStoredWidget(widget))
    );
  }

  private isStoredWidget(value: unknown): value is DashboardWidget {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<DashboardWidget>;
    const settings = candidate.settings as Partial<WidgetSettings> | undefined;
    return (
      typeof candidate.id === 'string' &&
      WIDGET_DEFINITIONS.some((definition) => definition.type === candidate.type) &&
      typeof candidate.title === 'string' &&
      typeof candidate.subtitle === 'string' &&
      typeof candidate.deviceId === 'string' &&
      typeof candidate.datasource === 'string' &&
      ['online', 'offline', 'loading', 'stale', 'error', 'pending'].includes(
        candidate.state ?? '',
      ) &&
      Boolean(settings) &&
      typeof settings?.accent === 'string' &&
      ['white', 'soft', 'dark'].includes(settings.background ?? '') &&
      typeof settings.showHeader === 'boolean' &&
      typeof settings.unit === 'string' &&
      Number.isInteger(settings.decimals) &&
      (settings.decimals ?? -1) >= 0 &&
      (settings.decimals ?? 5) <= 4 &&
      typeof settings.controlValue === 'number' &&
      Number.isFinite(settings.controlValue) &&
      typeof settings.locked === 'boolean' &&
      this.isStoredLayout(candidate.layouts?.desktop, BREAKPOINT_CONFIG.desktop.columns) &&
      this.isStoredLayout(candidate.layouts?.tablet, BREAKPOINT_CONFIG.tablet.columns) &&
      this.isStoredLayout(candidate.layouts?.mobile, BREAKPOINT_CONFIG.mobile.columns)
    );
  }

  private isStoredLayout(value: unknown, columns: number): value is WidgetLayout {
    if (!value || typeof value !== 'object') return false;
    const layout = value as Partial<WidgetLayout>;
    return (
      Number.isInteger(layout.x) &&
      (layout.x ?? -1) >= 0 &&
      Number.isInteger(layout.y) &&
      (layout.y ?? -1) >= 0 &&
      Number.isInteger(layout.cols) &&
      (layout.cols ?? 0) >= 1 &&
      (layout.x ?? columns) + (layout.cols ?? 1) <= columns &&
      Number.isInteger(layout.rows) &&
      (layout.rows ?? 0) >= 1
    );
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

  private defaultDatasource(type: WidgetType): string {
    return type.replaceAll('-', '_');
  }

  private createWidgetId(type: WidgetType): string {
    const suffix =
      this.documentRef.defaultView?.crypto.randomUUID().slice(0, 8) ?? Date.now().toString(36);
    return `${type}-${suffix}`;
  }

  private storageKey(projectId: string): string {
    return `iot-hub:dashboard-builder:${projectId}:v${STORAGE_VERSION}`;
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

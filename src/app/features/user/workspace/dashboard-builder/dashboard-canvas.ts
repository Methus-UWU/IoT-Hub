import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import {
  DashboardWidgetComponent,
  WidgetKeyboardLayoutRequest,
  WidgetPointerRequest,
  WidgetSelectRequest,
} from './dashboard-widget';
import { DashboardIcon } from './dashboard-icon';
import {
  BREAKPOINT_CONFIG,
  DashboardBreakpoint,
  DashboardWidget,
  LayoutCommit,
  WidgetAction,
  WidgetDropRequest,
  WidgetLayout,
  WidgetSettingChange,
  WidgetType,
  WIDGET_DEFINITIONS,
  widgetDefinition,
} from './dashboard-builder.models';
import {
  activeLayouts,
  clampWidgetLayout,
  layoutsOverlap,
  resolveCollisions,
} from './dashboard-grid.engine';

interface PointerInteraction {
  kind: 'move' | 'resize';
  widgetId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  columnPitch: number;
  rowPitch: number;
  original: WidgetLayout;
}

interface DropPreview {
  type: WidgetType;
  layout: WidgetLayout;
}

@Component({
  selector: 'app-dashboard-canvas',
  imports: [DashboardIcon, DashboardWidgetComponent],
  templateUrl: './dashboard-canvas.html',
  styleUrl: './dashboard-canvas.css',
  host: {
    '(document:pointermove)': 'handlePointerMove($event)',
    '(document:pointerup)': 'finishPointerInteraction($event)',
    '(document:pointercancel)': 'cancelPointerInteraction($event)',
    '(document:keydown)': 'handleDocumentKeydown($event)',
  },
})
export class DashboardCanvas {
  private readonly gridSurface = viewChild.required<ElementRef<HTMLElement>>('gridSurface');
  private readonly canvasScroll = viewChild<ElementRef<HTMLElement>>('canvasScroll');
  private readonly destroyRef = inject(DestroyRef);
  private readonly gridGap = 12;
  /** Floor for a row: tall enough for a control or reading to render inside a single row. */
  private readonly baseRowHeight = 88;
  /** Number of rows that fit the visible canvas height, and the height they share. */
  protected readonly fitRows = signal(0);
  private readonly fitHeight = signal(0);

  /** Rows stretch past the floor so the grid ends flush with the bottom of the screen. */
  protected readonly gridRowHeight = computed(() => {
    const rows = this.fitRows();
    if (rows < 1) return this.baseRowHeight;
    const shared = Math.floor((this.fitHeight() - (rows - 1) * this.gridGap) / rows);
    return Math.max(this.baseRowHeight, shared);
  });

  constructor() {
    afterNextRender(() => {
      const scroll = this.canvasScroll()?.nativeElement;
      if (!scroll) return;
      const observer = new ResizeObserver(() => this.measureFitRows());
      observer.observe(scroll);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.measureFitRows();
    });

    effect(() => {
      // Recompute when chrome around the grid changes (preview header, breakpoint).
      this.editMode();
      this.breakpoint();
      queueMicrotask(() => this.measureFitRows());
    });
  }

  private measureFitRows(): void {
    const scroll = this.canvasScroll()?.nativeElement;
    if (!scroll) return;
    const surface = this.gridSurface().nativeElement;
    const scrollRect = scroll.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const surfaceStyle = getComputedStyle(surface);
    // Everything between the last grid row and the bottom of the visible scroll area:
    // the surface's own padding (preview mode), then the device frame, then the scroller.
    const below =
      this.trailingSpace(surfaceStyle) +
      (parseFloat(surfaceStyle.paddingTop) || 0) +
      this.trailingSpace(surface.parentElement) +
      this.trailingSpace(scroll);
    const available = scrollRect.top + scroll.clientHeight - surfaceRect.top - below;
    const rows = Math.floor((available + this.gridGap) / (this.baseRowHeight + this.gridGap));
    this.fitRows.set(Math.max(0, rows));
    this.fitHeight.set(Math.max(0, available));
  }

  private trailingSpace(element: Element | CSSStyleDeclaration | null): number {
    if (!element) return 0;
    const style = element instanceof Element ? getComputedStyle(element) : element;
    return (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  }

  readonly widgets = input.required<readonly DashboardWidget[]>();
  readonly dashboardName = input.required<string>();
  readonly breakpoint = input.required<DashboardBreakpoint>();
  readonly editMode = input(true);
  /** Chart history per datastream key, while the dashboard is live. */
  readonly series = input<Readonly<Record<string, number[]>>>({});
  readonly liveMode = input(false);
  readonly layoutLocked = input(false);
  readonly selectedIds = input<readonly string[]>([]);

  readonly selectionChanged = output<readonly string[]>();
  readonly widgetDropped = output<WidgetDropRequest>();
  readonly layoutsCommitted = output<LayoutCommit>();
  readonly widgetActionRequested = output<WidgetAction>();
  readonly widgetSettingChanged = output<WidgetSettingChange>();
  readonly interactionMessage = output<string>();

  private readonly interaction = signal<PointerInteraction | null>(null);
  private readonly previewLayouts = signal<Record<string, WidgetLayout> | null>(null);
  protected readonly moveOffset = signal<{ x: number; y: number } | null>(null);
  protected readonly invalidDrop = signal(false);
  protected readonly dropPreview = signal<DropPreview | null>(null);
  protected readonly dragOver = signal(false);

  protected readonly breakpointConfig = computed(() => BREAKPOINT_CONFIG[this.breakpoint()]);
  protected readonly columns = computed(() => this.breakpointConfig().columns);
  protected readonly previewWidth = computed(() => this.breakpointConfig().previewWidth);
  /** Exactly the visible canvas height, unless widgets already reach past it. */
  protected readonly gridRows = computed(() => {
    const preview = this.previewLayouts();
    const contentRows = this.widgets().reduce((maximum, widget) => {
      const layout = preview?.[widget.id] ?? widget.layouts[this.breakpoint()];
      return Math.max(maximum, layout.y + layout.rows);
    }, 0);
    return Math.max(contentRows, this.fitRows());
  });
  protected readonly gridCellIndexes = computed(() =>
    Array.from({ length: this.gridRows() * this.columns() }, (_, index) => index),
  );
  protected readonly minimumGridHeight = computed(
    () => this.gridRows() * (this.gridRowHeight() + this.gridGap) - this.gridGap,
  );
  protected readonly movingWidgetId = computed(() => this.interaction()?.widgetId ?? null);
  protected readonly definitionFor = widgetDefinition;

  protected layoutFor(widget: DashboardWidget): WidgetLayout {
    return this.previewLayouts()?.[widget.id] ?? widget.layouts[this.breakpoint()];
  }

  protected gridColumn(widget: DashboardWidget): string {
    const layout = this.layoutFor(widget);
    return `${layout.x + 1} / span ${layout.cols}`;
  }

  protected gridRow(widget: DashboardWidget): string {
    const layout = this.layoutFor(widget);
    return `${layout.y + 1} / span ${layout.rows}`;
  }

  protected isSelected(widgetId: string): boolean {
    return this.selectedIds().includes(widgetId);
  }

  protected selectWidget(request: WidgetSelectRequest): void {
    const current = this.selectedIds();
    if (!request.additive) {
      this.selectionChanged.emit([request.widgetId]);
      return;
    }

    this.selectionChanged.emit(
      current.includes(request.widgetId)
        ? current.filter((id) => id !== request.widgetId)
        : [...current, request.widgetId],
    );
  }

  protected clearSelection(event: PointerEvent): void {
    if (event.target !== event.currentTarget || !this.editMode()) return;
    this.selectionChanged.emit([]);
  }

  protected beginMove(request: WidgetPointerRequest): void {
    if (this.layoutLocked()) {
      this.interactionMessage.emit('The layout is locked. Unlock it to move widgets.');
      return;
    }
    this.beginPointerInteraction('move', request);
  }

  protected beginResize(request: WidgetPointerRequest): void {
    if (this.layoutLocked()) {
      this.interactionMessage.emit('The layout is locked. Unlock it to resize widgets.');
      return;
    }
    this.beginPointerInteraction('resize', request);
  }

  private beginPointerInteraction(
    kind: PointerInteraction['kind'],
    request: WidgetPointerRequest,
  ): void {
    const widget = this.widgets().find((item) => item.id === request.widgetId);
    if (!widget || widget.settings.locked || !this.editMode()) return;
    const surfaceRect = this.gridSurface().nativeElement.getBoundingClientRect();
    const columnWidth = (surfaceRect.width - (this.columns() - 1) * this.gridGap) / this.columns();

    this.interaction.set({
      kind,
      widgetId: request.widgetId,
      pointerId: request.event.pointerId,
      startClientX: request.event.clientX,
      startClientY: request.event.clientY,
      columnPitch: columnWidth + this.gridGap,
      rowPitch: this.gridRowHeight() + this.gridGap,
      original: { ...widget.layouts[this.breakpoint()] },
    });
    this.previewLayouts.set(activeLayouts(this.widgets(), this.breakpoint()));
    this.invalidDrop.set(false);
  }

  protected handlePointerMove(event: PointerEvent): void {
    const interaction = this.interaction();
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    event.preventDefault();
    const widget = this.widgets().find((item) => item.id === interaction.widgetId);
    if (!widget) return;

    const horizontalCells = Math.round(
      (event.clientX - interaction.startClientX) / interaction.columnPitch,
    );
    const verticalCells = Math.round(
      (event.clientY - interaction.startClientY) / interaction.rowPitch,
    );
    const definition = widgetDefinition(widget.type);
    const proposed =
      interaction.kind === 'move'
        ? clampWidgetLayout(
            {
              ...interaction.original,
              x: interaction.original.x + horizontalCells,
              y: interaction.original.y + verticalCells,
            },
            definition,
            this.columns(),
          )
        : clampWidgetLayout(
            {
              ...interaction.original,
              cols: interaction.original.cols + horizontalCells,
              rows: interaction.original.rows + verticalCells,
            },
            definition,
            this.columns(),
          );

    const sourceLayouts = {
      ...activeLayouts(this.widgets(), this.breakpoint()),
      [widget.id]: proposed,
    };
    const lockedIds = new Set(
      this.widgets()
        .filter((item) => item.settings.locked)
        .map((item) => item.id),
    );
    const resolution = resolveCollisions(sourceLayouts, widget.id, lockedIds);
    this.invalidDrop.set(!resolution.valid);
    this.previewLayouts.set(resolution.valid ? resolution.layouts : sourceLayouts);

    if (interaction.kind === 'move') {
      const settled = (resolution.valid ? resolution.layouts : sourceLayouts)[widget.id];
      this.moveOffset.set({
        x:
          event.clientX -
          interaction.startClientX -
          (settled.x - interaction.original.x) * interaction.columnPitch,
        y:
          event.clientY -
          interaction.startClientY -
          (settled.y - interaction.original.y) * interaction.rowPitch,
      });
    } else {
      this.moveOffset.set(null);
    }
  }

  protected movingTransform(widgetId: string): string | null {
    const offset = this.moveOffset();
    if (!offset || this.movingWidgetId() !== widgetId) return null;
    return `translate(${offset.x}px, ${offset.y}px)`;
  }

  protected finishPointerInteraction(event: PointerEvent): void {
    const interaction = this.interaction();
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const preview = this.previewLayouts();
    const widget = this.widgets().find((item) => item.id === interaction.widgetId);

    if (preview && widget && !this.invalidDrop()) {
      const next = preview[widget.id];
      const changed = Object.entries(preview).some(([id, layout]) => {
        const original = this.widgets().find((item) => item.id === id)?.layouts[this.breakpoint()];
        return original ? !this.sameLayout(original, layout) : false;
      });
      if (changed) {
        const verb = interaction.kind === 'move' ? 'moved' : 'resized';
        this.layoutsCommitted.emit({
          layouts: preview,
          message: `${widget.title} ${verb} to column ${next.x + 1}, row ${next.y + 1}, size ${next.cols} by ${next.rows}.`,
        });
      }
    } else if (this.invalidDrop()) {
      this.interactionMessage.emit('That position is blocked by a locked widget.');
    }

    this.resetInteraction();
  }

  protected cancelPointerInteraction(event?: PointerEvent): void {
    const interaction = this.interaction();
    if (!interaction || (event && event.pointerId !== interaction.pointerId)) return;
    this.resetInteraction();
    this.interactionMessage.emit('Widget movement cancelled.');
  }

  private resetInteraction(): void {
    this.interaction.set(null);
    this.previewLayouts.set(null);
    this.moveOffset.set(null);
    this.invalidDrop.set(false);
  }

  protected handleKeyboardLayout(request: WidgetKeyboardLayoutRequest): void {
    if (this.layoutLocked()) {
      this.interactionMessage.emit('The layout is locked.');
      return;
    }
    const widget = this.widgets().find((item) => item.id === request.widgetId);
    if (!widget || widget.settings.locked) return;
    const current = widget.layouts[this.breakpoint()];
    const definition = widgetDefinition(widget.type);
    const proposed = clampWidgetLayout(
      request.resize
        ? {
            ...current,
            cols: current.cols + request.horizontal,
            rows: current.rows + request.vertical,
          }
        : {
            ...current,
            x: current.x + request.horizontal,
            y: current.y + request.vertical,
          },
      definition,
      this.columns(),
    );
    if (this.sameLayout(current, proposed)) return;

    const sourceLayouts = activeLayouts(this.widgets(), this.breakpoint());
    sourceLayouts[widget.id] = proposed;
    const lockedIds = new Set(
      this.widgets()
        .filter((item) => item.settings.locked)
        .map((item) => item.id),
    );
    const resolution = resolveCollisions(sourceLayouts, widget.id, lockedIds);
    if (!resolution.valid) {
      this.interactionMessage.emit('That position is blocked by a locked widget.');
      return;
    }

    const verb = request.resize ? 'resized' : 'moved';
    this.layoutsCommitted.emit({
      layouts: resolution.layouts,
      message: `${widget.title} ${verb} to column ${proposed.x + 1}, row ${proposed.y + 1}, size ${proposed.cols} by ${proposed.rows}.`,
    });
  }

  protected allowLibraryDrop(event: DragEvent): void {
    if (!this.editMode() || this.layoutLocked()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(true);

    const type = this.readDraggedWidgetType(event);
    if (!type) return;
    const definition = widgetDefinition(type);
    const surfaceRect = this.gridSurface().nativeElement.getBoundingClientRect();
    const columnWidth = (surfaceRect.width - (this.columns() - 1) * this.gridGap) / this.columns();
    const columnPitch = columnWidth + this.gridGap;
    const rowPitch = this.gridRowHeight() + this.gridGap;
    const size = {
      cols: Math.min(definition.defaultSize.cols, this.columns()),
      rows: definition.defaultSize.rows,
    };
    const x = Math.min(
      Math.max(0, Math.floor((event.clientX - surfaceRect.left) / columnPitch)),
      this.columns() - size.cols,
    );
    const y = Math.max(0, Math.floor((event.clientY - surfaceRect.top) / rowPitch));
    const layout = { x, y, ...size };
    const collision = this.widgets().some((widget) =>
      layoutsOverlap(layout, widget.layouts[this.breakpoint()]),
    );
    this.invalidDrop.set(collision);
    this.dropPreview.set({ type, layout });
  }

  protected leaveLibraryDrop(event: DragEvent): void {
    const surface = this.gridSurface().nativeElement;
    if (event.relatedTarget instanceof Node && surface.contains(event.relatedTarget)) return;
    this.clearLibraryDrop();
  }

  protected completeLibraryDrop(event: DragEvent): void {
    if (!this.editMode() || this.layoutLocked()) return;
    event.preventDefault();
    if (this.invalidDrop()) {
      this.interactionMessage.emit('That grid area is occupied. Choose an empty position.');
      this.clearLibraryDrop();
      return;
    }
    const preview = this.dropPreview();
    const type = preview?.type ?? this.readDraggedWidgetType(event);
    if (type) {
      this.widgetDropped.emit({
        type,
        x: preview?.layout.x,
        y: preview?.layout.y,
      });
    }
    this.clearLibraryDrop();
  }

  private clearLibraryDrop(): void {
    this.dragOver.set(false);
    this.dropPreview.set(null);
    this.invalidDrop.set(false);
  }

  private readDraggedWidgetType(event: DragEvent): WidgetType | null {
    const raw =
      event.dataTransfer?.getData('application/x-iot-dashboard-widget') ||
      event.dataTransfer?.getData('text/plain');
    return WIDGET_DEFINITIONS.some((definition) => definition.type === raw)
      ? (raw as WidgetType)
      : null;
  }

  protected dropGridColumn(): string {
    const layout = this.dropPreview()?.layout;
    return layout ? `${layout.x + 1} / span ${layout.cols}` : 'auto';
  }

  protected dropGridRow(): string {
    const layout = this.dropPreview()?.layout;
    return layout ? `${layout.y + 1} / span ${layout.rows}` : 'auto';
  }

  protected dropLabel(): string {
    const preview = this.dropPreview();
    return preview ? widgetDefinition(preview.type).title : '';
  }

  protected handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.interaction()) return;
    event.preventDefault();
    this.cancelPointerInteraction();
  }

  private sameLayout(first: WidgetLayout, second: WidgetLayout): boolean {
    return (
      first.x === second.x &&
      first.y === second.y &&
      first.cols === second.cols &&
      first.rows === second.rows
    );
  }
}

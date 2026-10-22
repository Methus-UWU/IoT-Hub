import {
  BREAKPOINTS,
  DEFAULT_SETTINGS,
  DashboardDocument,
  DashboardWidget,
  WIDGET_TYPES,
  WidgetLayout,
  WidgetType,
  firstFreeSlot,
  widgetSpec,
} from '../../dashboards/dashboard-document';
import { BREAKPOINT_COLUMNS } from '../../dashboards/widget-catalog.generated';
import type {
  Datastream,
  DatastreamDataType,
} from '../../dashboards/dashboard.repository';
import {
  DATASTREAM_DATA_TYPES,
  DATASTREAM_KEY,
} from '../../dashboards/datastream-rules';

/**
 * The project's dashboard as the assistant would leave it, held apart like `ProjectDraft`.
 *
 * The assistant never edits the stored dashboard. It stages widgets and datastreams
 * here, the result goes back to the user as one reviewable "set the dashboard" action,
 * and only an accepted plan is written — through the same validation as a save from
 * the dashboard builder.
 *
 * The rule that matters most is enforced here, not in the prompt: a widget can bind
 * only to a datastream the project has or this turn defines, and a datastream can name
 * only a part that is on the canvas (or staged this turn). A dashboard for a sensor
 * that is not there cannot be proposed.
 */

export interface DashboardDatastream {
  readonly key: string;
  readonly name: string;
  readonly dataType: DatastreamDataType;
  readonly unit: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly source: string;
  /** A component id, or a `new:` placeholder for a part this plan adds. */
  readonly componentId: string | null;
}

export interface DashboardBase {
  readonly version: number;
  readonly document: DashboardDocument;
  readonly datastreams: readonly Datastream[];
}

export class DashboardDraftError extends Error {}

export class DashboardDraft {
  private document: DashboardDocument;
  private readonly added: DashboardDatastream[] = [];
  private touched = false;
  private sequence = 0;

  constructor(
    readonly base: DashboardBase,
    /** Whether a component id or placeholder exists in the draft circuit. */
    private readonly hasComponent: (componentId: string) => boolean,
    private readonly labelOf: (componentId: string) => string,
  ) {
    this.document = structuredClone(base.document);
  }

  get changed(): boolean {
    return this.touched;
  }

  datastreams(): readonly DashboardDatastream[] {
    return [...this.base.datastreams, ...this.added];
  }

  addedDatastreams(): readonly DashboardDatastream[] {
    return this.added;
  }

  widgets(): readonly DashboardWidget[] {
    return this.document.widgets;
  }

  result(): DashboardDocument {
    return structuredClone(this.document);
  }

  /** What the model reads: datastreams, then widgets with their bindings and places. */
  describe(): string {
    const streams = this.datastreams();
    const lines = [
      `Dashboard "${this.document.name}" (${this.document.widgets.length} widgets, 12-column desktop grid).`,
      '',
      'Datastreams:',
      ...(streams.length
        ? streams.map(
            (stream) =>
              `- ${stream.key}: ${stream.name}, ${stream.dataType}${stream.unit ? ` ${stream.unit}` : ''}${
                stream.min !== null || stream.max !== null
                  ? ` [${stream.min ?? ''}..${stream.max ?? ''}]`
                  : ''
              }${stream.componentId ? ` from ${this.labelOf(stream.componentId)}` : ''}${
                stream.source ? ` (${stream.source})` : ''
              }`,
          )
        : ['- none yet; define_datastream before binding a widget']),
      '',
      'Widgets:',
      ...(this.document.widgets.length
        ? this.document.widgets.map((widget) => {
            const layout = widget.layouts.desktop;
            return `- ${widget.id}: ${widget.type} "${widget.title}"${
              widget.datasource ? ` ← ${widget.datasource}` : ''
            } at x${layout.x} y${layout.y} ${layout.cols}x${layout.rows}`;
          })
        : ['- none']),
      '',
      `Widget types: ${WIDGET_TYPES.join(', ')}.`,
    ];
    return lines.join('\n');
  }

  defineDatastream(input: {
    key: unknown;
    name: unknown;
    dataType: unknown;
    unit?: unknown;
    min?: unknown;
    max?: unknown;
    source?: unknown;
    componentId?: unknown;
  }): DashboardDatastream {
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!DATASTREAM_KEY.test(key)) {
      throw new DashboardDraftError(
        'key must start with a letter and use letters, digits, or _ (max 32), e.g. temperature.',
      );
    }
    if (this.datastreams().some((stream) => stream.key === key)) {
      throw new DashboardDraftError(
        `Datastream "${key}" already exists. Bind widgets to it.`,
      );
    }
    const dataType = input.dataType as DatastreamDataType;
    if (!DATASTREAM_DATA_TYPES.includes(dataType)) {
      throw new DashboardDraftError(
        'dataType must be number, boolean, or string.',
      );
    }
    const componentId =
      typeof input.componentId === 'string' && input.componentId
        ? input.componentId
        : null;
    if (componentId && !this.hasComponent(componentId)) {
      throw new DashboardDraftError(
        `Component ${componentId} is not in this project. Use a component id from the context or from add_device.`,
      );
    }
    const min = finite(input.min);
    const max = finite(input.max);
    if (min !== null && max !== null && min >= max) {
      throw new DashboardDraftError('min must be less than max.');
    }
    if (this.datastreams().length >= 64) {
      throw new DashboardDraftError('A project holds at most 64 datastreams.');
    }
    const stream: DashboardDatastream = {
      key,
      name: text(input.name, 80) || key,
      dataType,
      unit: text(input.unit, 16),
      min,
      max,
      source: text(input.source, 64).replace(/[^A-Za-z0-9_.-]/g, ''),
      componentId,
    };
    this.added.push(stream);
    this.touched = true;
    return stream;
  }

  placeWidget(input: {
    type: unknown;
    title?: unknown;
    datastream?: unknown;
    cols?: unknown;
    rows?: unknown;
    unit?: unknown;
    decimals?: unknown;
  }): DashboardWidget {
    if (!WIDGET_TYPES.includes(input.type as WidgetType)) {
      throw new DashboardDraftError(
        `type must be one of: ${WIDGET_TYPES.join(', ')}.`,
      );
    }
    if (this.document.widgets.length >= 60) {
      throw new DashboardDraftError('A dashboard holds at most 60 widgets.');
    }
    const type = input.type as WidgetType;
    const stream = this.requireStream(input.datastream, type);
    const spec = widgetSpec(type);
    const size = {
      cols: clamp(
        input.cols,
        spec.minSize.cols,
        spec.maxSize.cols,
        spec.defaultSize.cols,
      ),
      rows: clamp(
        input.rows,
        spec.minSize.rows,
        spec.maxSize.rows,
        spec.defaultSize.rows,
      ),
    };
    const layouts = {} as Record<(typeof BREAKPOINTS)[number], WidgetLayout>;
    for (const breakpoint of BREAKPOINTS) {
      layouts[breakpoint] = firstFreeSlot(
        this.document.widgets.map((widget) => widget.layouts[breakpoint]),
        size.cols,
        size.rows,
        BREAKPOINT_COLUMNS[breakpoint],
      );
    }
    const widget: DashboardWidget = {
      id: this.nextId(),
      type,
      title: text(input.title, 80) || stream?.name || spec.type,
      subtitle: stream?.componentId ? this.labelOf(stream.componentId) : '',
      deviceId: stream?.componentId ?? '',
      datasource: stream?.key ?? '',
      state: 'pending',
      layouts,
      settings: {
        ...DEFAULT_SETTINGS,
        unit: text(input.unit, 16) || stream?.unit || '',
        decimals: clamp(
          input.decimals,
          0,
          4,
          stream?.dataType === 'number' ? 1 : 0,
        ),
      },
    };
    this.document.widgets.push(widget);
    this.touched = true;
    return widget;
  }

  updateWidget(input: {
    id: unknown;
    title?: unknown;
    datastream?: unknown;
    x?: unknown;
    y?: unknown;
    cols?: unknown;
    rows?: unknown;
  }): DashboardWidget {
    const widget = this.requireWidget(input.id);
    if (input.title !== undefined)
      widget.title = text(input.title, 80) || widget.title;
    if (input.datastream !== undefined) {
      const stream = this.requireStream(input.datastream, widget.type);
      widget.datasource = stream?.key ?? '';
      widget.deviceId = stream?.componentId ?? '';
    }
    const spec = widgetSpec(widget.type);
    const desktop = widget.layouts.desktop;
    const next = {
      cols: clamp(
        input.cols,
        spec.minSize.cols,
        spec.maxSize.cols,
        desktop.cols,
      ),
      rows: clamp(
        input.rows,
        spec.minSize.rows,
        spec.maxSize.rows,
        desktop.rows,
      ),
      x: 0,
      y: 0,
    };
    next.x = clamp(
      input.x,
      0,
      12 - next.cols,
      Math.min(desktop.x, 12 - next.cols),
    );
    next.y = clamp(input.y, 0, 400, desktop.y);
    const others = this.document.widgets.filter(
      (other) => other.id !== widget.id,
    );
    if (others.some((other) => overlapsLayout(next, other.layouts.desktop))) {
      throw new DashboardDraftError(
        'That spot overlaps another widget. Pick a free x/y, or call arrange_dashboard.',
      );
    }
    widget.layouts.desktop = next;
    this.touched = true;
    return widget;
  }

  removeWidget(id: unknown): void {
    const widget = this.requireWidget(id);
    this.document.widgets = this.document.widgets.filter(
      (item) => item.id !== widget.id,
    );
    this.touched = true;
  }

  /**
   * Packs every widget top-left in its current order on every breakpoint, so a
   * dashboard the assistant extended in several steps ends up tidy rather than ragged.
   */
  arrange(): void {
    for (const breakpoint of BREAKPOINTS) {
      const taken: WidgetLayout[] = [];
      for (const widget of this.document.widgets) {
        const layout = widget.layouts[breakpoint];
        const slot = firstFreeSlot(
          taken,
          layout.cols,
          layout.rows,
          BREAKPOINT_COLUMNS[breakpoint],
        );
        widget.layouts[breakpoint] = slot;
        taken.push(slot);
      }
    }
    this.touched = true;
  }

  private requireStream(
    value: unknown,
    type: WidgetType,
  ): DashboardDatastream | null {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key) {
      if (['text', 'divider', 'terminal', 'event-log'].includes(type))
        return null;
      throw new DashboardDraftError(
        `A ${type} widget needs a datastream. define_datastream for a value this project's parts produce, then bind it.`,
      );
    }
    const stream = this.datastreams().find((item) => item.key === key);
    if (!stream) {
      throw new DashboardDraftError(
        `No datastream "${key}". Existing: ${
          this.datastreams()
            .map((item) => item.key)
            .join(', ') || 'none'
        }.`,
      );
    }
    return stream;
  }

  private requireWidget(id: unknown): DashboardWidget {
    const widget = this.document.widgets.find((item) => item.id === id);
    if (!widget)
      throw new DashboardDraftError(
        `No widget "${String(id)}". Call read_dashboard.`,
      );
    return widget;
  }

  private nextId(): string {
    let id: string;
    do id = `ai-widget-${++this.sequence}`;
    while (this.document.widgets.some((widget) => widget.id === id));
    return id;
  }
}

function overlapsLayout(a: WidgetLayout, b: WidgetLayout): boolean {
  return (
    a.x < b.x + b.cols &&
    b.x < a.x + a.cols &&
    a.y < b.y + b.rows &&
    b.y < a.y + a.rows
  );
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(number)) {
    return Math.min(max, Math.max(min, fallback));
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

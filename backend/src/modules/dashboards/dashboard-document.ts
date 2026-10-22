import { BREAKPOINT_COLUMNS, WIDGET_CATALOG } from './widget-catalog.generated';

/**
 * The dashboard document: the one shape a client saves, a template stores, and the
 * assistant proposes. Mirrors `DashboardDocument` in the Angular dashboard builder.
 *
 * `parseDashboardDocument` is the server's only way in: anything stored was rebuilt
 * field by field from this parser, so an extra property, an unknown widget type, or a
 * widget hanging off the grid never reaches the database.
 */

export type Breakpoint = keyof typeof BREAKPOINT_COLUMNS;
export type WidgetType = (typeof WIDGET_CATALOG)[number]['type'];

export const BREAKPOINTS = Object.keys(BREAKPOINT_COLUMNS) as Breakpoint[];
export const WIDGET_TYPES = WIDGET_CATALOG.map((widget) => widget.type);
export const MAX_WIDGETS = 60;
const MAX_ROW = 400;
const RUNTIME_STATES = [
  'online',
  'offline',
  'loading',
  'stale',
  'error',
  'pending',
] as const;
const BACKGROUNDS = ['white', 'soft', 'dark'] as const;
const WIDGET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export interface WidgetLayout {
  x: number;
  y: number;
  cols: number;
  rows: number;
}

export interface WidgetSettings {
  accent: string;
  background: (typeof BACKGROUNDS)[number];
  showHeader: boolean;
  unit: string;
  decimals: number;
  controlValue: number;
  locked: boolean;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  subtitle: string;
  /** Project component id the widget is about, or ''. */
  deviceId: string;
  /** Datastream key the widget reads or writes, or ''. */
  datasource: string;
  state: (typeof RUNTIME_STATES)[number];
  layouts: Record<Breakpoint, WidgetLayout>;
  settings: WidgetSettings;
}

export interface DashboardDocument {
  schemaVersion: 1;
  dashboardId: string;
  name: string;
  deviceScope: string;
  dateRange: string;
  widgets: DashboardWidget[];
}

export const DEFAULT_SETTINGS: WidgetSettings = {
  accent: '#545454',
  background: 'white',
  showHeader: true,
  unit: '',
  decimals: 0,
  controlValue: 0,
  locked: false,
};

export class DashboardDocumentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('; '));
    this.name = 'DashboardDocumentError';
  }
}

export function widgetSpec(type: WidgetType) {
  return WIDGET_CATALOG.find((widget) => widget.type === type)!;
}

/** Rebuilds a document from untrusted input, or throws listing what is wrong. */
export function parseDashboardDocument(value: unknown): DashboardDocument {
  const problems: string[] = [];
  const root = asRecord(value);
  if (!root)
    throw new DashboardDocumentError(['The dashboard must be an object.']);

  const rawWidgets = Array.isArray(root['widgets']) ? root['widgets'] : null;
  if (!rawWidgets) problems.push('widgets must be an array.');
  if (rawWidgets && rawWidgets.length > MAX_WIDGETS) {
    problems.push(`A dashboard holds at most ${MAX_WIDGETS} widgets.`);
  }

  const widgets: DashboardWidget[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of (rawWidgets ?? [])
    .slice(0, MAX_WIDGETS)
    .entries()) {
    const widget = parseWidget(raw, index, problems);
    if (!widget) continue;
    if (ids.has(widget.id)) {
      problems.push(`Widget id "${widget.id}" is used twice.`);
      continue;
    }
    ids.add(widget.id);
    widgets.push(widget);
  }
  if (problems.length) throw new DashboardDocumentError(problems);

  return {
    schemaVersion: 1,
    dashboardId: text(root['dashboardId'], 64) || 'dashboard',
    name: text(root['name'], 80) || 'Dashboard',
    deviceScope: text(root['deviceScope'], 64),
    dateRange: text(root['dateRange'], 32),
    widgets: resolveOverlaps(widgets),
  };
}

function parseWidget(
  raw: unknown,
  index: number,
  problems: string[],
): DashboardWidget | null {
  const where = `widgets[${index}]`;
  const record = asRecord(raw);
  if (!record) {
    problems.push(`${where} must be an object.`);
    return null;
  }
  const id = typeof record['id'] === 'string' ? record['id'] : '';
  if (!WIDGET_ID.test(id)) {
    problems.push(`${where}.id must be 1–64 letters, digits, "-" or "_".`);
    return null;
  }
  const type = record['type'];
  if (!WIDGET_TYPES.includes(type as WidgetType)) {
    problems.push(`${where}.type "${String(type)}" is not a widget type.`);
    return null;
  }
  const widgetType = type as WidgetType;
  const layoutsRecord = asRecord(record['layouts']);
  const layouts = {} as Record<Breakpoint, WidgetLayout>;
  for (const breakpoint of BREAKPOINTS) {
    layouts[breakpoint] = parseLayout(
      asRecord(layoutsRecord?.[breakpoint]),
      widgetType,
      breakpoint,
    );
  }
  const state = record['state'];
  return {
    id,
    type: widgetType,
    title: text(record['title'], 80),
    subtitle: text(record['subtitle'], 120),
    deviceId: text(record['deviceId'], 64),
    datasource: text(record['datasource'], 32),
    state: RUNTIME_STATES.includes(state as DashboardWidget['state'])
      ? (state as DashboardWidget['state'])
      : 'pending',
    layouts,
    settings: parseSettings(asRecord(record['settings'])),
  };
}

/**
 * A layout clamped onto the grid. A missing or broken one gets the type's default
 * size at the origin; overlaps are resolved after every widget is read.
 */
function parseLayout(
  raw: Record<string, unknown> | null,
  type: WidgetType,
  breakpoint: Breakpoint,
): WidgetLayout {
  const spec = widgetSpec(type);
  const columns = BREAKPOINT_COLUMNS[breakpoint];
  const cols = clampInt(
    raw?.['cols'],
    spec.minSize.cols,
    spec.maxSize.cols,
    spec.defaultSize.cols,
  );
  const width = Math.min(cols, columns);
  return {
    x: clampInt(raw?.['x'], 0, columns - width, 0),
    y: clampInt(raw?.['y'], 0, MAX_ROW, 0),
    cols: width,
    rows: clampInt(
      raw?.['rows'],
      spec.minSize.rows,
      spec.maxSize.rows,
      spec.defaultSize.rows,
    ),
  };
}

function parseSettings(raw: Record<string, unknown> | null): WidgetSettings {
  const accent = typeof raw?.['accent'] === 'string' ? raw['accent'] : '';
  const background = raw?.['background'];
  const controlValue = Number(raw?.['controlValue']);
  return {
    accent: HEX_COLOR.test(accent) ? accent : DEFAULT_SETTINGS.accent,
    background: BACKGROUNDS.includes(background as WidgetSettings['background'])
      ? (background as WidgetSettings['background'])
      : DEFAULT_SETTINGS.background,
    showHeader: raw?.['showHeader'] !== false,
    unit: text(raw?.['unit'], 16),
    decimals: clampInt(raw?.['decimals'], 0, 4, 0),
    controlValue: Number.isFinite(controlValue) ? controlValue : 0,
    locked: raw?.['locked'] === true,
  };
}

/**
 * Pushes any widget that overlaps an earlier one down until it fits, per breakpoint.
 * Order is the document's order, so the widget listed first keeps its place.
 */
export function resolveOverlaps(widgets: DashboardWidget[]): DashboardWidget[] {
  const placed = widgets.map((widget) => ({
    ...widget,
    layouts: { ...widget.layouts },
  }));
  for (const breakpoint of BREAKPOINTS) {
    const taken: WidgetLayout[] = [];
    for (const widget of placed) {
      const layout = { ...widget.layouts[breakpoint] };
      while (taken.some((other) => overlaps(layout, other))) layout.y += 1;
      widget.layouts[breakpoint] = layout;
      taken.push(layout);
    }
  }
  return placed;
}

/** The first free slot for a widget of this size, scanning rows top to bottom. */
export function firstFreeSlot(
  taken: readonly WidgetLayout[],
  cols: number,
  rows: number,
  columns: number,
): WidgetLayout {
  const width = Math.min(cols, columns);
  for (let y = 0; y <= MAX_ROW; y++) {
    for (let x = 0; x + width <= columns; x++) {
      const candidate = { x, y, cols: width, rows };
      if (!taken.some((other) => overlaps(candidate, other))) return candidate;
    }
  }
  return { x: 0, y: MAX_ROW, cols: width, rows };
}

export function overlaps(a: WidgetLayout, b: WidgetLayout): boolean {
  return (
    a.x < b.x + b.cols &&
    b.x < a.x + a.cols &&
    a.y < b.y + b.rows &&
    b.y < a.y + a.rows
  );
}

export function emptyDashboard(name = 'Dashboard'): DashboardDocument {
  return {
    schemaVersion: 1,
    dashboardId: 'dashboard',
    name,
    deviceScope: '',
    dateRange: '24h',
    widgets: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

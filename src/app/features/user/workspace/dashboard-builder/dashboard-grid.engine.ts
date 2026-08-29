import {
  BREAKPOINT_CONFIG,
  DashboardBreakpoint,
  DashboardWidget,
  WidgetDefinition,
  WidgetLayout,
} from './dashboard-builder.models';

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function layoutsOverlap(first: WidgetLayout, second: WidgetLayout): boolean {
  return (
    first.x < second.x + second.cols &&
    first.x + first.cols > second.x &&
    first.y < second.y + second.rows &&
    first.y + first.rows > second.y
  );
}

export function clampWidgetLayout(
  layout: WidgetLayout,
  definition: WidgetDefinition,
  columns: number,
): WidgetLayout {
  const minimumColumns = Math.min(definition.minSize.cols, columns);
  const maximumColumns = Math.min(definition.maxSize.cols, columns);
  const cols = clamp(Math.round(layout.cols), minimumColumns, maximumColumns);
  const rows = clamp(Math.round(layout.rows), definition.minSize.rows, definition.maxSize.rows);

  return {
    x: clamp(Math.round(layout.x), 0, Math.max(0, columns - cols)),
    y: Math.max(0, Math.round(layout.y)),
    cols,
    rows,
  };
}

export function responsiveDefaultSize(
  definition: WidgetDefinition,
  breakpoint: DashboardBreakpoint,
): Pick<WidgetLayout, 'cols' | 'rows'> {
  const columns = BREAKPOINT_CONFIG[breakpoint].columns;
  const ratio = columns / BREAKPOINT_CONFIG.desktop.columns;
  const minimumColumns = Math.min(definition.minSize.cols, columns);
  const proposedColumns =
    breakpoint === 'desktop'
      ? definition.defaultSize.cols
      : Math.round(definition.defaultSize.cols * ratio);

  return {
    cols: clamp(proposedColumns, minimumColumns, Math.min(definition.maxSize.cols, columns)),
    rows: definition.defaultSize.rows,
  };
}

export function findFirstFreeLayout(
  occupied: readonly WidgetLayout[],
  size: Pick<WidgetLayout, 'cols' | 'rows'>,
  columns: number,
  preferred?: Pick<WidgetLayout, 'x' | 'y'>,
): WidgetLayout {
  const cols = Math.min(size.cols, columns);
  const candidateAt = (x: number, y: number): WidgetLayout => ({ x, y, cols, rows: size.rows });
  const isFree = (candidate: WidgetLayout): boolean =>
    !occupied.some((layout) => layoutsOverlap(layout, candidate));

  if (preferred) {
    const preferredX = clamp(preferred.x, 0, Math.max(0, columns - cols));
    const preferredY = Math.max(0, preferred.y);
    const directCandidate = candidateAt(preferredX, preferredY);
    if (isFree(directCandidate)) return directCandidate;

    for (let offset = 1; offset < 30; offset += 1) {
      const downwardCandidate = candidateAt(preferredX, preferredY + offset);
      if (isFree(downwardCandidate)) return downwardCandidate;
    }
  }

  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x <= columns - cols; x += 1) {
      const candidate = candidateAt(x, y);
      if (isFree(candidate)) return candidate;
    }
  }

  const lastRow = occupied.reduce((row, layout) => Math.max(row, layout.y + layout.rows), 0);
  return candidateAt(0, lastRow);
}

export function resolveCollisions(
  sourceLayouts: Readonly<Record<string, WidgetLayout>>,
  anchorId: string,
  lockedIds: ReadonlySet<string>,
): { valid: boolean; layouts: Record<string, WidgetLayout> } {
  const layouts = Object.fromEntries(
    Object.entries(sourceLayouts).map(([id, layout]) => [id, { ...layout }]),
  );
  const queue = [anchorId];
  const processed = new Set<string>();
  let safety = 0;

  while (queue.length > 0 && safety < 500) {
    safety += 1;
    const activeId = queue.shift();
    if (!activeId) continue;
    const activeLayout = layouts[activeId];
    if (!activeLayout) continue;
    processed.add(activeId);

    const collisions = Object.entries(layouts)
      .filter(([id, layout]) => id !== activeId && layoutsOverlap(activeLayout, layout))
      .sort(([, first], [, second]) => first.y - second.y || first.x - second.x);

    for (const [collisionId, collisionLayout] of collisions) {
      if (collisionId === anchorId || lockedIds.has(collisionId)) {
        return { valid: false, layouts };
      }

      const nextY = activeLayout.y + activeLayout.rows;
      if (collisionLayout.y !== nextY) {
        layouts[collisionId] = { ...collisionLayout, y: nextY };
      }
      if (!processed.has(collisionId)) queue.push(collisionId);
    }
  }

  return { valid: safety < 500, layouts };
}

export function compactLayouts(
  sourceLayouts: Readonly<Record<string, WidgetLayout>>,
  lockedIds: ReadonlySet<string>,
): Record<string, WidgetLayout> {
  const layouts = Object.fromEntries(
    Object.entries(sourceLayouts).map(([id, layout]) => [id, { ...layout }]),
  );
  const orderedIds = Object.keys(layouts).sort((firstId, secondId) => {
    const first = layouts[firstId];
    const second = layouts[secondId];
    return first.y - second.y || first.x - second.x || firstId.localeCompare(secondId);
  });

  for (const id of orderedIds) {
    if (lockedIds.has(id)) continue;
    const current = layouts[id];
    let nextY = current.y;
    while (nextY > 0) {
      const candidate = { ...current, y: nextY - 1 };
      const collides = Object.entries(layouts).some(
        ([otherId, layout]) => otherId !== id && layoutsOverlap(candidate, layout),
      );
      if (collides) break;
      nextY -= 1;
    }
    layouts[id] = { ...current, y: nextY };
  }

  return layouts;
}

export function activeLayouts(
  widgets: readonly DashboardWidget[],
  breakpoint: DashboardBreakpoint,
): Record<string, WidgetLayout> {
  return Object.fromEntries(
    widgets.map((widget) => [widget.id, { ...widget.layouts[breakpoint] }]),
  );
}

export function requiredGridRows(
  widgets: readonly DashboardWidget[],
  breakpoint: DashboardBreakpoint,
): number {
  return Math.max(
    10,
    widgets.reduce(
      (maximum, widget) =>
        Math.max(maximum, widget.layouts[breakpoint].y + widget.layouts[breakpoint].rows + 2),
      0,
    ),
  );
}

import type { DashboardWidget } from './dashboard-builder.models';
import type { DeviceSnapshot, TelemetryValue } from './devices-api.client';

/** Widgets that send a value to the device instead of only showing one. */
export const CONTROL_WIDGETS = new Set(['switch', 'slider', 'button', 'numeric-input']);
/** Widgets that draw a datastream's history. */
export const SERIES_WIDGETS = new Set(['line-chart']);

/**
 * The dashboard as the selected device sees it: each widget bound to a datastream
 * shows that datastream's latest value, and its state says whether the device is
 * online. Pure, and applied only for display — live values never reach the saved
 * document.
 */
export function applyLive(
  widgets: readonly DashboardWidget[],
  snapshot: DeviceSnapshot | null,
): DashboardWidget[] {
  if (!snapshot) return [...widgets];
  return widgets.map((widget) => {
    if (!widget.datasource) return widget;
    const entry = snapshot.values[widget.datasource];
    if (!entry) {
      // A control with no value yet must still be usable, or it could never set one.
      if (!snapshot.online) return { ...widget, state: 'offline' };
      return { ...widget, state: CONTROL_WIDGETS.has(widget.type) ? 'online' : 'pending' };
    }
    const numeric = toNumber(entry.value);
    return {
      ...widget,
      state: snapshot.online ? 'online' : 'stale',
      settings: numeric === null ? widget.settings : { ...widget.settings, controlValue: numeric },
    };
  });
}

export function toNumber(value: TelemetryValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

/** The value a control sends, in the datastream's type. */
export function controlValue(
  dataType: 'number' | 'boolean' | 'string' | undefined,
  value: number,
): TelemetryValue {
  if (dataType === 'boolean') return value > 0;
  if (dataType === 'string') return String(value);
  return value;
}

/** Datastream keys the visible widgets need history for. */
export function seriesKeys(widgets: readonly DashboardWidget[]): string[] {
  return [
    ...new Set(
      widgets
        .filter((widget) => SERIES_WIDGETS.has(widget.type) && widget.datasource)
        .map((widget) => widget.datasource),
    ),
  ];
}

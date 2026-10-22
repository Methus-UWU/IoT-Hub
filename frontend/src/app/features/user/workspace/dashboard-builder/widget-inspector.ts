import { Component, computed, input, output, signal } from '@angular/core';

import { Datastream, DatastreamDataType, DatastreamInput } from './dashboard-api.client';
import { DashboardIcon } from './dashboard-icon';
import {
  DashboardBreakpoint,
  DashboardWidget,
  WidgetAction,
  WidgetLayout,
  WidgetRuntimeState,
  WidgetSettings,
  widgetDefinition,
} from './dashboard-builder.models';

type InspectorTab = 'general' | 'data' | 'appearance' | 'interaction' | 'access';

export interface WidgetInspectorPatch {
  widgetId: string;
  patch: Partial<Omit<DashboardWidget, 'id' | 'layouts' | 'settings'>> & {
    settings?: Partial<WidgetSettings>;
  };
}

export interface WidgetLayoutFieldChange {
  widgetId: string;
  layout: WidgetLayout;
}

export interface DashboardSettingsChange {
  field: 'deviceScope' | 'dateRange';
  value: string;
}

export type BulkWidgetAction = 'align-left' | 'align-top' | 'duplicate' | 'delete';

/** A part on the project's canvas, as the data tab names it. */
export interface InspectorComponent {
  id: string;
  label: string;
}

@Component({
  selector: 'app-widget-inspector',
  imports: [DashboardIcon],
  templateUrl: './widget-inspector.html',
  styleUrl: './widget-inspector.css',
})
export class WidgetInspector {
  readonly widget = input<DashboardWidget | null>(null);
  readonly selectionCount = input(0);
  readonly breakpoint = input.required<DashboardBreakpoint>();
  readonly layoutLocked = input(false);
  readonly deviceScope = input('All devices');
  /** The project's devices; the dashboard shows the chosen one's live values. */
  readonly devices = input<readonly { id: string; name: string }[]>([]);
  readonly dateRange = input('24h');
  /** The project's datastreams: the only values a widget may bind to. */
  readonly datastreams = input<readonly Datastream[]>([]);
  readonly components = input<readonly InspectorComponent[]>([]);

  readonly widgetPatched = output<WidgetInspectorPatch>();
  readonly layoutChanged = output<WidgetLayoutFieldChange>();
  readonly actionRequested = output<WidgetAction>();
  readonly bulkActionRequested = output<BulkWidgetAction>();
  readonly dashboardSettingsChanged = output<DashboardSettingsChange>();
  readonly closeRequested = output<void>();
  readonly datastreamCreated = output<DatastreamInput>();

  protected readonly activeTab = signal<InspectorTab>('general');
  protected readonly tabs: readonly { id: InspectorTab; label: string; icon: string }[] = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'data', label: 'Data', icon: 'data' },
    { id: 'appearance', label: 'Style', icon: 'palette' },
    { id: 'interaction', label: 'Actions', icon: 'action' },
    { id: 'access', label: 'Access', icon: 'permissions' },
  ];
  protected readonly accentOptions = [
    '#2b2b2b',
    '#545454',
    '#808080',
    '#5577ff',
    '#7c5cff',
    '#ff8f3d',
    '#16a779',
    '#ee5d68',
  ];
  protected readonly backgroundOptions: readonly WidgetSettings['background'][] = [
    'white',
    'soft',
    'dark',
  ];
  protected readonly selectedLayout = computed(
    () => this.widget()?.layouts[this.breakpoint()] ?? null,
  );
  protected readonly boundStream = computed(
    () => this.datastreams().find((stream) => stream.key === this.widget()?.datasource) ?? null,
  );
  protected readonly boundComponentLabel = computed(() => {
    const id = this.boundStream()?.componentId ?? this.widget()?.deviceId;
    if (!id) return '';
    return this.components().find((component) => component.id === id)?.label ?? 'Removed part';
  });
  protected readonly creatingStream = signal(false);
  protected readonly dataTypes: readonly DatastreamDataType[] = ['number', 'boolean', 'string'];
  protected readonly selectedWidgetIcon = computed(() =>
    this.widget() ? widgetDefinition(this.widget()!.type).icon : 'info',
  );

  protected selectTab(tab: InspectorTab): void {
    this.activeTab.set(tab);
  }

  protected handleTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % this.tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = this.tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.selectTab(this.tabs[nextIndex].id);
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    (buttons?.item(nextIndex) as HTMLButtonElement | undefined)?.focus();
  }

  protected patchText(field: 'title' | 'subtitle' | 'deviceId' | 'datasource', event: Event): void {
    this.patchWidget({ [field]: (event.target as HTMLInputElement).value });
  }

  /** Binding a datastream also names its part, so the two can never disagree. */
  protected bindDatastream(event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    const stream = this.datastreams().find((item) => item.key === key);
    this.patchWidget({
      datasource: stream?.key ?? '',
      deviceId: stream?.componentId ?? '',
      ...(stream?.unit ? { settings: { unit: stream.unit } } : {}),
    });
  }

  protected submitDatastream(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const number = (name: string) => (value(name) === '' ? null : Number(value(name)));
    this.datastreamCreated.emit({
      key: value('key'),
      name: value('name') || value('key'),
      dataType: value('dataType') as DatastreamDataType,
      unit: value('unit'),
      min: number('min'),
      max: number('max'),
      source: value('source'),
      componentId: value('componentId') || null,
    });
    form.reset();
    this.creatingStream.set(false);
  }

  protected patchState(event: Event): void {
    this.patchWidget({ state: (event.target as HTMLSelectElement).value as WidgetRuntimeState });
  }

  protected patchSetting<K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]): void {
    this.patchWidget({ settings: { [key]: value } });
  }

  protected patchNumberSetting(key: 'decimals' | 'controlValue', event: Event): void {
    const rawValue = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(rawValue)) return;
    const value = key === 'decimals' ? Math.min(4, Math.max(0, Math.round(rawValue))) : rawValue;
    this.patchSetting(key, value);
  }

  protected patchInputSetting(key: 'accent' | 'unit', event: Event): void {
    this.patchSetting(key, (event.target as HTMLInputElement).value);
  }

  protected patchCheckboxSetting(key: 'showHeader', event: Event): void {
    this.patchSetting(key, (event.target as HTMLInputElement).checked);
  }

  protected patchWidget(patch: WidgetInspectorPatch['patch']): void {
    const widget = this.widget();
    if (!widget) return;
    this.widgetPatched.emit({ widgetId: widget.id, patch });
  }

  protected updateLayout(field: keyof WidgetLayout, event: Event): void {
    const widget = this.widget();
    const layout = this.selectedLayout();
    if (!widget || !layout) return;
    const value = Math.round(Number((event.target as HTMLInputElement).value));
    if (!Number.isFinite(value)) return;
    this.layoutChanged.emit({
      widgetId: widget.id,
      layout: { ...layout, [field]: Math.max(field === 'cols' || field === 'rows' ? 1 : 0, value) },
    });
  }

  protected requestAction(action: WidgetAction['action']): void {
    const widget = this.widget();
    if (widget) this.actionRequested.emit({ widgetId: widget.id, action });
  }

  protected updateDashboardSetting(field: DashboardSettingsChange['field'], event: Event): void {
    this.dashboardSettingsChanged.emit({
      field,
      value: (event.target as HTMLSelectElement).value,
    });
  }
}

import { Component, computed, input, output, signal } from '@angular/core';

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
  readonly dateRange = input('24h');

  readonly widgetPatched = output<WidgetInspectorPatch>();
  readonly layoutChanged = output<WidgetLayoutFieldChange>();
  readonly actionRequested = output<WidgetAction>();
  readonly bulkActionRequested = output<BulkWidgetAction>();
  readonly dashboardSettingsChanged = output<DashboardSettingsChange>();
  readonly closeRequested = output<void>();

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

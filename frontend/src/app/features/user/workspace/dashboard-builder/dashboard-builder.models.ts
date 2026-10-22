export type DashboardBreakpoint = 'desktop' | 'tablet' | 'mobile';

export type WidgetCategory = 'Controls' | 'Displays' | 'Charts' | 'Data' | 'Layout';

export type WidgetType =
  | 'switch'
  | 'button'
  | 'slider'
  | 'numeric-input'
  | 'value'
  | 'gauge'
  | 'progress'
  | 'status'
  | 'led'
  | 'line-chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'table'
  | 'event-log'
  | 'terminal'
  | 'text'
  | 'divider';

export type WidgetRuntimeState = 'online' | 'offline' | 'loading' | 'stale' | 'error' | 'pending';

export interface WidgetLayout {
  x: number;
  y: number;
  cols: number;
  rows: number;
}

export interface WidgetSizeRule {
  cols: number;
  rows: number;
}

export interface WidgetDefinition {
  type: WidgetType;
  title: string;
  description: string;
  category: WidgetCategory;
  icon: string;
  defaultSize: WidgetSizeRule;
  minSize: WidgetSizeRule;
  maxSize: WidgetSizeRule;
}

export interface WidgetSettings {
  accent: string;
  background: 'white' | 'soft' | 'dark';
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
  deviceId: string;
  datasource: string;
  state: WidgetRuntimeState;
  layouts: Record<DashboardBreakpoint, WidgetLayout>;
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

export interface WidgetDropRequest {
  type: WidgetType;
  x?: number;
  y?: number;
}

export interface LayoutCommit {
  layouts: Readonly<Record<string, WidgetLayout>>;
  message: string;
}

export interface WidgetAction {
  widgetId: string;
  action: 'configure' | 'duplicate' | 'copy' | 'delete' | 'toggle-lock';
}

export interface WidgetSettingChange {
  widgetId: string;
  controlValue: number;
}

export const BREAKPOINT_CONFIG: Readonly<
  Record<
    DashboardBreakpoint,
    { label: string; columns: number; previewWidth: number; icon: string }
  >
> = {
  desktop: { label: 'Desktop', columns: 12, previewWidth: 1120, icon: 'desktop' },
  tablet: { label: 'Tablet', columns: 8, previewWidth: 760, icon: 'tablet' },
  mobile: { label: 'Mobile', columns: 4, previewWidth: 360, icon: 'mobile' },
};

export const WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  'Controls',
  'Displays',
  'Charts',
  'Data',
  'Layout',
];

export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  {
    type: 'switch',
    title: 'Switch',
    description: 'Toggle a device state',
    category: 'Controls',
    icon: 'toggle',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
  },
  {
    type: 'button',
    title: 'Button',
    description: 'Trigger a device action',
    category: 'Controls',
    icon: 'button',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
  },
  {
    type: 'slider',
    title: 'Slider',
    description: 'Set a value in a range',
    category: 'Controls',
    icon: 'sliders',
    defaultSize: { cols: 4, rows: 2 },
    minSize: { cols: 3, rows: 2 },
    maxSize: { cols: 8, rows: 3 },
  },
  {
    type: 'numeric-input',
    title: 'Numeric input',
    description: 'Enter a precise value',
    category: 'Controls',
    icon: 'hash',
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 5, rows: 3 },
  },
  {
    type: 'value',
    title: 'Value',
    description: 'Show the latest reading',
    category: 'Displays',
    icon: 'value',
    defaultSize: { cols: 3, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 6, rows: 4 },
  },
  {
    type: 'gauge',
    title: 'Gauge',
    description: 'Visualize a live level',
    category: 'Displays',
    icon: 'gauge',
    defaultSize: { cols: 3, rows: 3 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 6, rows: 6 },
  },
  {
    type: 'progress',
    title: 'Progress',
    description: 'Track percentage or capacity',
    category: 'Displays',
    icon: 'progress',
    defaultSize: { cols: 3, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 6, rows: 3 },
  },
  {
    type: 'status',
    title: 'Status',
    description: 'Show connection health',
    category: 'Displays',
    icon: 'status',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
  },
  {
    type: 'led',
    title: 'LED',
    description: 'Show a binary indicator',
    category: 'Displays',
    icon: 'bulb',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 4 },
  },
  {
    type: 'line-chart',
    title: 'Line chart',
    description: 'Plot a metric over time',
    category: 'Charts',
    icon: 'line-chart',
    defaultSize: { cols: 6, rows: 4 },
    minSize: { cols: 4, rows: 3 },
    maxSize: { cols: 12, rows: 8 },
  },
  {
    type: 'bar-chart',
    title: 'Bar chart',
    description: 'Compare grouped readings',
    category: 'Charts',
    icon: 'bar-chart',
    defaultSize: { cols: 6, rows: 4 },
    minSize: { cols: 4, rows: 3 },
    maxSize: { cols: 12, rows: 8 },
  },
  {
    type: 'pie-chart',
    title: 'Pie chart',
    description: 'Show a proportional split',
    category: 'Charts',
    icon: 'pie-chart',
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 3, rows: 3 },
    maxSize: { cols: 8, rows: 8 },
  },
  {
    type: 'table',
    title: 'Table',
    description: 'Display recent device data',
    category: 'Data',
    icon: 'table',
    defaultSize: { cols: 6, rows: 4 },
    minSize: { cols: 4, rows: 3 },
    maxSize: { cols: 12, rows: 10 },
  },
  {
    type: 'event-log',
    title: 'Event log',
    description: 'Review alerts and activity',
    category: 'Data',
    icon: 'list',
    defaultSize: { cols: 6, rows: 4 },
    minSize: { cols: 4, rows: 3 },
    maxSize: { cols: 12, rows: 10 },
  },
  {
    type: 'terminal',
    title: 'Terminal',
    description: 'Stream raw device output',
    category: 'Data',
    icon: 'terminal',
    defaultSize: { cols: 6, rows: 4 },
    minSize: { cols: 4, rows: 3 },
    maxSize: { cols: 12, rows: 10 },
  },
  {
    type: 'text',
    title: 'Text',
    description: 'Add a heading or note',
    category: 'Layout',
    icon: 'text',
    defaultSize: { cols: 4, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 12, rows: 4 },
  },
  {
    type: 'divider',
    title: 'Divider',
    description: 'Separate dashboard sections',
    category: 'Layout',
    icon: 'divider',
    defaultSize: { cols: 6, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 12, rows: 1 },
  },
];

const DEFAULT_SETTINGS: WidgetSettings = {
  accent: '#545454',
  background: 'white',
  showHeader: true,
  unit: '',
  decimals: 0,
  controlValue: 64,
  locked: false,
};

function starterWidget(
  widget: Omit<DashboardWidget, 'settings'> & { settings?: Partial<WidgetSettings> },
): DashboardWidget {
  return {
    ...widget,
    layouts: {
      desktop: { ...widget.layouts.desktop },
      tablet: { ...widget.layouts.tablet },
      mobile: { ...widget.layouts.mobile },
    },
    settings: { ...DEFAULT_SETTINGS, ...widget.settings },
  };
}

export const STARTER_WIDGETS: readonly DashboardWidget[] = [
  starterWidget({
    id: 'temperature',
    type: 'value',
    title: 'Temperature',
    subtitle: 'Greenhouse sensor',
    deviceId: 'greenhouse-01',
    datasource: 'temperature',
    state: 'online',
    layouts: {
      desktop: { x: 0, y: 0, cols: 3, rows: 2 },
      tablet: { x: 0, y: 0, cols: 3, rows: 2 },
      mobile: { x: 0, y: 0, cols: 4, rows: 2 },
    },
    settings: { accent: '#545454', unit: '°C', decimals: 1, controlValue: 28.4 },
  }),
  starterWidget({
    id: 'humidity',
    type: 'gauge',
    title: 'Humidity',
    subtitle: 'Average humidity',
    deviceId: 'greenhouse-01',
    datasource: 'humidity',
    state: 'online',
    layouts: {
      desktop: { x: 3, y: 0, cols: 3, rows: 3 },
      tablet: { x: 3, y: 0, cols: 3, rows: 3 },
      mobile: { x: 0, y: 2, cols: 4, rows: 3 },
    },
    settings: { accent: '#545454', unit: '%', controlValue: 68 },
  }),
  starterWidget({
    id: 'irrigation',
    type: 'switch',
    title: 'Irrigation',
    subtitle: 'Zone A pump',
    deviceId: 'pump-controller',
    datasource: 'pump_state',
    state: 'online',
    layouts: {
      desktop: { x: 6, y: 0, cols: 2, rows: 2 },
      tablet: { x: 6, y: 0, cols: 2, rows: 2 },
      mobile: { x: 0, y: 5, cols: 2, rows: 2 },
    },
    settings: { accent: '#545454', controlValue: 1 },
  }),
  starterWidget({
    id: 'fan-speed',
    type: 'slider',
    title: 'Ventilation',
    subtitle: 'Fan speed',
    deviceId: 'climate-controller',
    datasource: 'fan_speed',
    state: 'online',
    layouts: {
      desktop: { x: 8, y: 0, cols: 4, rows: 2 },
      tablet: { x: 0, y: 3, cols: 4, rows: 2 },
      mobile: { x: 0, y: 7, cols: 4, rows: 2 },
    },
    settings: { accent: '#808080', unit: '%', controlValue: 72 },
  }),
  starterWidget({
    id: 'temperature-trend',
    type: 'line-chart',
    title: 'Climate overview',
    subtitle: 'Last 24 hours',
    deviceId: 'all-devices',
    datasource: 'temperature_history',
    state: 'online',
    layouts: {
      desktop: { x: 0, y: 3, cols: 8, rows: 4 },
      tablet: { x: 0, y: 5, cols: 8, rows: 4 },
      mobile: { x: 0, y: 9, cols: 4, rows: 4 },
    },
    settings: { accent: '#545454', unit: '°C', decimals: 1 },
  }),
  starterWidget({
    id: 'device-events',
    type: 'table',
    title: 'Device activity',
    subtitle: 'Live event stream',
    deviceId: 'all-devices',
    datasource: 'device_events',
    state: 'online',
    layouts: {
      desktop: { x: 8, y: 2, cols: 4, rows: 5 },
      tablet: { x: 0, y: 9, cols: 8, rows: 4 },
      mobile: { x: 0, y: 13, cols: 4, rows: 4 },
    },
    settings: { accent: '#545454' },
  }),
];

export function cloneWidget(widget: DashboardWidget): DashboardWidget {
  return {
    ...widget,
    layouts: {
      desktop: { ...widget.layouts.desktop },
      tablet: { ...widget.layouts.tablet },
      mobile: { ...widget.layouts.mobile },
    },
    settings: { ...widget.settings },
  };
}

export function cloneWidgets(widgets: readonly DashboardWidget[]): DashboardWidget[] {
  return widgets.map(cloneWidget);
}

export function widgetDefinition(type: WidgetType): WidgetDefinition {
  return WIDGET_DEFINITIONS.find((definition) => definition.type === type) ?? WIDGET_DEFINITIONS[0];
}

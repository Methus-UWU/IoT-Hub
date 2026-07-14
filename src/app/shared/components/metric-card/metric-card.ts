import { Component, computed, input } from '@angular/core';

import { MetricIcon as MetricIconComponent, MetricIconKind } from '../metric-icon/metric-icon';

export type MetricIcon = MetricIconKind;
export type MetricTone = 'ok' | 'warning' | 'critical';

export function metricTone(percent: number | null): MetricTone {
  if (percent === null) return 'ok';
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'ok';
}

interface SparklinePoint {
  x: number;
  y: number;
}

let metricCardInstanceCounter = 0;
const SPARKLINE_BASELINE_Y = 30;
const SPARKLINE_TOP_Y = 2;

const BAR_CLASSES: Record<MetricTone, string> = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500'
};

const VALUE_CLASSES: Record<MetricTone, string> = {
  ok: 'text-gray-900',
  warning: 'text-amber-600',
  critical: 'text-red-600'
};

export const ICON_WRAPPER_CLASSES: Record<MetricTone, string> = {
  ok: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  critical: 'bg-red-50 text-red-600'
};

const STROKE_CLASSES: Record<MetricTone, string> = {
  ok: 'text-emerald-500',
  warning: 'text-amber-500',
  critical: 'text-red-500'
};

@Component({
  selector: 'app-metric-card',
  imports: [MetricIconComponent],
  template: `
    <div
      class="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      role="group"
      [attr.aria-label]="title() + ' ' + primaryValue()"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          @if (icon(); as kind) {
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200"
              [class]="iconWrapperClasses()"
              aria-hidden="true"
            >
              <app-metric-icon [kind]="kind" class="h-4.5 w-4.5" />
            </span>
          }
          <h3 class="text-sm font-medium text-gray-500">{{ title() }}</h3>
        </div>
        @if (percent() !== null) {
          <span class="text-xs font-semibold" [class]="valueClasses()">{{ percent() }}%</span>
        }
      </div>

      <p class="mt-3 text-2xl font-semibold tracking-tight" [class]="valueClasses()">
        {{ primaryValue() }}
      </p>

      <p class="mt-1 h-4 text-xs text-gray-500">{{ secondaryValue() }}</p>

      @if (hasHistory()) {
        <div class="mt-2 h-10 w-full" aria-hidden="true">
          <svg
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            class="h-full w-full overflow-visible"
            [class]="strokeClasses()"
          >
            <defs>
              <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.25" />
                <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path [attr.d]="sparklineAreaPath()" [attr.fill]="'url(#' + gradientId + ')'" stroke="none" />
            <path
              [attr.d]="sparklineLinePath()"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </div>
      } @else if (percent() !== null) {
        <div
          class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          [attr.aria-valuenow]="percent()"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full transition-[width] duration-500"
            [class]="barClasses()"
            [style.width.%]="percent()"
          ></div>
        </div>
      }
    </div>
  `
})
export class MetricCard {
  readonly title = input.required<string>();
  readonly primaryValue = input.required<string>();
  readonly secondaryValue = input<string>('');
  readonly percent = input<number | null>(null);
  readonly icon = input<MetricIcon | null>(null);
  readonly history = input<number[]>([]);

  protected readonly gradientId = `metric-card-${metricCardInstanceCounter++}`;

  protected readonly tone = computed<MetricTone>(() => metricTone(this.percent()));

  protected readonly barClasses = computed(() => BAR_CLASSES[this.tone()]);
  protected readonly valueClasses = computed(() => VALUE_CLASSES[this.tone()]);
  protected readonly iconWrapperClasses = computed(() => ICON_WRAPPER_CLASSES[this.tone()]);
  protected readonly strokeClasses = computed(() => STROKE_CLASSES[this.tone()]);

  protected readonly hasHistory = computed(() => this.history().length > 1);

  private readonly sparklinePoints = computed<SparklinePoint[]>(() => {
    const data = this.history();
    if (data.length < 2) return [];
    const max = Math.max(...data, 1);
    const step = 100 / (data.length - 1);
    return data.map((value, index) => ({
      x: index * step,
      y: SPARKLINE_BASELINE_Y - (Math.max(value, 0) / max) * (SPARKLINE_BASELINE_Y - SPARKLINE_TOP_Y)
    }));
  });

  protected readonly sparklineLinePath = computed(() => this.toSmoothPath(this.sparklinePoints()));

  protected readonly sparklineAreaPath = computed(() => {
    const points = this.sparklinePoints();
    if (points.length < 2) return '';
    const linePath = this.toSmoothPath(points);
    const last = points[points.length - 1];
    const first = points[0];
    return `${linePath} L ${last.x},${SPARKLINE_BASELINE_Y} L ${first.x},${SPARKLINE_BASELINE_Y} Z`;
  });

  private toSmoothPath(points: SparklinePoint[]): string {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const midX = (curr.x + next.x) / 2;
      d += ` C ${midX},${curr.y} ${midX},${next.y} ${next.x},${next.y}`;
    }
    return d;
  }
}

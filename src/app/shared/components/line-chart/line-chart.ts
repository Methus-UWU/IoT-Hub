import { Component, computed, input, signal } from '@angular/core';

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
  format?: (value: number) => string;
}

interface ChartPoint {
  x: number;
  y: number;
}

interface SeriesGeometry {
  name: string;
  color: string;
  rawData: number[];
  format?: (value: number) => string;
  points: ChartPoint[];
}

let lineChartInstanceCounter = 0;

const VIEWBOX_HEIGHT = 40;
const BASELINE_Y = 38;
const TOP_Y = 2;
const GRID_FRACTIONS = [1, 0.75, 0.5, 0.25, 0];
const MAX_X_TICKS = 5;

@Component({
  selector: 'app-line-chart',
  template: `
    <div class="w-full">
      <p class="sr-only">{{ ariaLabel() }}</p>

      <div class="flex gap-2">
        <div
          class="flex w-12 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] font-medium text-slate-400"
          aria-hidden="true"
        >
          @for (line of gridLines(); track line.value) {
            <span>{{ gridFormat()(line.value) }}</span>
          }
        </div>

        <div
          class="relative h-64 flex-1 cursor-crosshair rounded-xl bg-slate-50/60 p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2"
          tabindex="0"
          aria-label="Interactive chart. Use left and right arrow keys to inspect data points."
          (mousemove)="onPointerMove($event)"
          (mouseleave)="onPointerLeave()"
          (focus)="onFocus()"
          (blur)="onPointerLeave()"
          (keydown)="onKeydown($event)"
        >
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              @for (area of areaPaths(); track area.name) {
                <linearGradient [attr.id]="area.gradientId" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" [attr.stop-color]="area.color" [attr.stop-opacity]="areaOpacity()" />
                  <stop offset="100%" [attr.stop-color]="area.color" stop-opacity="0" />
                </linearGradient>
              }
            </defs>

            @for (line of gridLines(); track line.value) {
              <line
                x1="0"
                [attr.y1]="line.y"
                x2="100"
                [attr.y2]="line.y"
                stroke="currentColor"
                class="text-slate-200/80"
                stroke-width="1"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
              />
            }

            @for (area of areaPaths(); track area.name) {
              <path [attr.d]="area.d" [attr.fill]="'url(#' + area.gradientId + ')'" stroke="none" />
            }

            @for (path of paths(); track path.name) {
              <path
                [attr.d]="path.d"
                fill="none"
                [attr.stroke]="path.color"
                stroke-width="1.75"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              />
            }

            @if (hoverPoint(); as hp) {
              <line
                [attr.x1]="hp.x"
                [attr.y1]="topY"
                [attr.x2]="hp.x"
                [attr.y2]="baselineY"
                stroke="currentColor"
                class="text-slate-300"
                stroke-width="1"
                stroke-dasharray="2 2"
                vector-effect="non-scaling-stroke"
              />
            }
          </svg>

          @if (hoverPoint(); as hp) {
            @for (marker of hp.markers; track marker.name) {
              <span
                class="pointer-events-none absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
                [style.left.%]="hp.x"
                [style.top.%]="(marker.y / viewBoxHeight) * 100"
                [style.background-color]="marker.color"
              ></span>
            }
            <div
              class="pointer-events-none absolute z-10 w-max max-w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg shadow-slate-200/80"
              [style.left.%]="hp.x"
              [style.top.%]="hp.topPercent"
              [style.transform]="tooltipTransform()"
            >
              @if (hp.label) {
                <p class="mb-1 font-medium text-slate-400">{{ hp.label }}</p>
              }
              @for (marker of hp.markers; track marker.name) {
                <p class="flex items-center gap-1.5 whitespace-nowrap text-slate-600">
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full" [style.background-color]="marker.color"></span>
                  {{ marker.name }}: <span class="font-semibold text-slate-950">{{ marker.formatted }}</span>
                </p>
              }
            </div>
          }
        </div>
      </div>

      @if (xTicks().length) {
        <div class="ml-14 mt-2 flex justify-between text-[10px] font-medium text-slate-400" aria-hidden="true">
          @for (tick of xTicks(); track $index) {
            <span>{{ tick }}</span>
          }
        </div>
      }

      <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        @for (item of legend(); track item.name) {
          <li class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span class="h-2 w-2 shrink-0 rounded-full" [style.background-color]="item.color" aria-hidden="true"></span>
            {{ item.name }}: <span class="font-semibold text-slate-700">{{ item.latest }}</span>
          </li>
        }
      </ul>
    </div>
  `
})
export class LineChart {
  readonly series = input.required<ChartSeries[]>();
  readonly labels = input<string[]>([]);
  readonly max = input<number | null>(null);
  readonly formatValue = input<(value: number) => string>((value) => `${value}`);
  /** Scales each series to its own max instead of a shared axis. Use when combining series with different units. */
  readonly normalize = input(false);

  protected readonly topY = TOP_Y;
  protected readonly baselineY = BASELINE_Y;
  protected readonly viewBoxHeight = VIEWBOX_HEIGHT;

  private readonly instanceId = `line-chart-${lineChartInstanceCounter++}`;
  private readonly hoverIndex = signal<number | null>(null);

  protected readonly pointCount = computed(() => {
    const lengths = this.series().map((s) => s.data.length);
    return lengths.length ? Math.max(...lengths) : 0;
  });

  private readonly scaleMax = computed(() => {
    const explicitMax = this.max();
    if (explicitMax !== null) return explicitMax;
    const allValues = this.series().flatMap((s) => s.data);
    return allValues.length ? Math.max(...allValues, 1) : 1;
  });

  protected readonly gridLines = computed(() => {
    const max = this.normalize() ? 100 : this.scaleMax();
    return GRID_FRACTIONS.map((fraction) => ({
      value: max * fraction,
      y: BASELINE_Y - fraction * (BASELINE_Y - TOP_Y)
    }));
  });

  protected readonly gridFormat = computed(() =>
    this.normalize() ? (value: number) => `${Math.round(value)}%` : this.formatValue()
  );

  private readonly seriesGeometry = computed<SeriesGeometry[]>(() => {
    const normalize = this.normalize();
    const globalMax = this.scaleMax();
    return this.series().map((s) => ({
      name: s.name,
      color: s.color,
      rawData: s.data,
      format: s.format,
      points: this.toPoints(s.data, normalize ? Math.max(...s.data, 1) : globalMax)
    }));
  });

  protected readonly paths = computed(() =>
    this.seriesGeometry().map((s) => ({
      name: s.name,
      color: s.color,
      d: this.toSmoothPath(s.points)
    }))
  );

  protected readonly areaOpacity = computed(() => (this.series().length > 1 ? 0.12 : 0.25));

  protected readonly areaPaths = computed(() => {
    return this.seriesGeometry().flatMap((s, index) => {
      if (s.points.length < 2) return [];
      const linePath = this.toSmoothPath(s.points);
      const last = s.points[s.points.length - 1];
      const first = s.points[0];
      return [
        {
          name: s.name,
          color: s.color,
          gradientId: `${this.instanceId}-area-${index}`,
          d: `${linePath} L ${last.x},${BASELINE_Y} L ${first.x},${BASELINE_Y} Z`
        }
      ];
    });
  });

  protected readonly legend = computed(() => {
    const fallback = this.formatValue();
    return this.series().map((s) => ({
      name: s.name,
      color: s.color,
      latest: s.data.length ? (s.format ?? fallback)(s.data[s.data.length - 1]) : '-'
    }));
  });

  protected readonly ariaLabel = computed(() => {
    const fallback = this.formatValue();
    const summary = this.series()
      .map(
        (s) => `${s.name} currently ${s.data.length ? (s.format ?? fallback)(s.data[s.data.length - 1]) : 'unknown'}`
      )
      .join(', ');
    return `Line chart: ${summary}`;
  });

  private readonly xTickIndices = computed(() => {
    const count = this.pointCount();
    if (count === 0) return [];
    if (count <= MAX_X_TICKS) return Array.from({ length: count }, (_, i) => i);
    const step = (count - 1) / (MAX_X_TICKS - 1);
    return Array.from({ length: MAX_X_TICKS }, (_, i) => Math.round(i * step));
  });

  protected readonly xTicks = computed(() => {
    const labels = this.labels();
    if (!labels.length) return [];
    return this.xTickIndices().map((i) => labels[i] ?? '');
  });

  protected readonly hoverPoint = computed(() => {
    const index = this.hoverIndex();
    if (index === null) return null;
    const geometry = this.seriesGeometry();
    if (!geometry.length) return null;

    const fallback = this.formatValue();
    const labels = this.labels();
    const markers = geometry
      .filter((s) => index < s.points.length)
      .map((s) => ({
        name: s.name,
        color: s.color,
        y: s.points[index].y,
        formatted: (s.format ?? fallback)(s.rawData[index] ?? 0)
      }));

    if (!markers.length) return null;

    const x = geometry.find((s) => index < s.points.length)!.points[index].x;
    const topY = Math.min(...markers.map((m) => m.y));

    return {
      x,
      label: labels[index] ?? '',
      topPercent: (topY / VIEWBOX_HEIGHT) * 100,
      markers
    };
  });

  protected readonly tooltipTransform = computed(() => {
    const hp = this.hoverPoint();
    if (!hp) return '';
    const xShift = hp.x < 15 ? '0' : hp.x > 85 ? '-100%' : '-50%';
    return `translate(${xShift}, calc(-100% - 10px))`;
  });

  protected onPointerMove(event: MouseEvent): void {
    const count = this.pointCount();
    if (count === 0) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.hoverIndex.set(Math.round(fraction * (count - 1)));
  }

  protected onPointerLeave(): void {
    this.hoverIndex.set(null);
  }

  protected onFocus(): void {
    if (this.hoverIndex() === null) {
      this.hoverIndex.set(this.pointCount() - 1);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.pointCount();
    if (count === 0) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.hoverIndex.update((idx) => Math.max(0, (idx ?? count - 1) - 1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.hoverIndex.update((idx) => Math.min(count - 1, (idx ?? -1) + 1));
    } else if (event.key === 'Escape') {
      this.hoverIndex.set(null);
    }
  }

  private toPoints(data: number[], max: number): ChartPoint[] {
    const step = data.length > 1 ? 100 / (data.length - 1) : 0;
    return data.map((value, index) => ({
      x: index * step,
      y: BASELINE_Y - (Math.min(Math.max(value, 0), max) / max) * (BASELINE_Y - TOP_Y)
    }));
  }

  private toSmoothPath(points: ChartPoint[]): string {
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

import { Component, computed, input } from '@angular/core';

export type StatusTone = 'ok' | 'warning' | 'critical' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  neutral: 'bg-gray-400',
};

@Component({
  selector: 'app-status-badge',
  template: `
    <span
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset"
      [class.font-semibold]="emphasis()"
      [class.font-normal]="!emphasis()"
      [class]="toneClasses()"
    >
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClasses()" aria-hidden="true"></span>
      {{ label() }}
    </span>
  `,
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly tone = input<StatusTone>('neutral');
  readonly emphasis = input(true);

  protected readonly toneClasses = computed(() => TONE_CLASSES[this.tone()]);
  protected readonly dotClasses = computed(() => TONE_DOT_CLASSES[this.tone()]);
}

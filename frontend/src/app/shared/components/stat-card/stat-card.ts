import { Component, input } from '@angular/core';

export type StatIcon = 'users' | 'devices' | 'projects' | 'documents' | 'ai';

@Component({
  selector: 'app-stat-card',
  template: `
    <div
      class="group flex min-h-32 items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/70 transition-colors duration-150 hover:border-slate-300"
      role="group"
      [attr.aria-label]="title() + ' ' + value()"
    >
      <div class="min-w-0">
        <p class="truncate text-xs font-medium text-slate-500">{{ title() }}</p>
        <p class="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="text-2xl font-semibold tracking-tight text-slate-950">{{ value() }}</span>
          @if (live() && caption()) {
            <span class="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
              ></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
          }
        </p>
        @if (caption()) {
          <p class="mt-1 truncate text-xs font-medium text-slate-400">{{ caption() }}</p>
        }
      </div>

      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-150"
        [class.bg-emerald-50]="live()"
        [class.text-emerald-600]="live()"
        [class.bg-slate-100]="!live()"
        [class.text-slate-500]="!live()"
        aria-hidden="true"
      >
        @switch (icon()) {
          @case ('users') {
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4">
              <circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          }
          @case ('devices') {
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4">
              <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
              <circle cx="12" cy="17.3" r="0.9" fill="currentColor" />
            </svg>
          }
          @case ('projects') {
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4">
              <path
                d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4.13a1.5 1.5 0 0 1 1.2.6l1.1 1.4H18.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
            </svg>
          }
          @case ('documents') {
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4">
              <path
                d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <path d="M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          }
          @case ('ai') {
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4">
              <path
                d="M12 3.5 13.8 8.7 19 10.5l-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
          }
        }
      </span>
    </div>
  `
})
export class StatCard {
  readonly title = input.required<string>();
  readonly value = input.required<string>();
  readonly caption = input<string>('');
  readonly icon = input.required<StatIcon>();
  readonly live = input<boolean>(false);
}

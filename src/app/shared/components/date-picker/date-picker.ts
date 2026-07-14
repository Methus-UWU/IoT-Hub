import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

export type DatePickerTheme = 'light' | 'dark';

interface CalendarDay {
  iso: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

@Component({
  selector: 'app-date-picker',
  host: {
    class: 'relative inline-block w-full',
    '(document:click)': 'onDocumentClick($event)'
  },
  template: `
    <div class="relative">
      @if (icon(); as iconName) {
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400" aria-hidden="true">
          <span class="material-symbols-outlined text-[20px]!">{{ iconName }}</span>
        </span>
      }
      <button
        type="button"
        [class]="triggerClass()"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        [attr.aria-label]="label()"
        (click)="toggle()"
        (keydown.escape)="close()"
      >
        <span class="truncate" [class.text-slate-400]="!selectedDate()">{{ displayValue() }}</span>
      </button>
    </div>

    @if (open()) {
      <div [class]="panelClass()" role="dialog" [attr.aria-label]="label() || 'Choose date'">
        <div class="mb-2 flex items-center justify-between px-1">
          <button
            type="button"
            [class]="navButtonClass()"
            aria-label="Previous month"
            (click)="previousMonth()"
          >
            <span class="material-symbols-outlined text-[18px]!" aria-hidden="true">chevron_left</span>
          </button>
          <span class="text-xs font-bold">{{ monthLabel() }} {{ viewYear() }}</span>
          <button
            type="button"
            [class]="navButtonClass()"
            aria-label="Next month"
            (click)="nextMonth()"
          >
            <span class="material-symbols-outlined text-[18px]!" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <div class="grid grid-cols-7 gap-1 px-1 text-center text-[10px] font-semibold text-slate-500">
          @for (weekday of weekdayLabels; track weekday) {
            <span>{{ weekday }}</span>
          }
        </div>

        <div class="grid grid-cols-7 gap-1 p-1" role="grid">
          @for (day of gridDays(); track day.iso) {
            <button
              type="button"
              role="gridcell"
              [attr.aria-selected]="day.isSelected"
              [attr.aria-current]="day.isToday ? 'date' : null"
              [class]="dayClass(day)"
              (click)="selectDay(day)"
            >
              {{ day.dayOfMonth }}
            </button>
          }
        </div>

        <div class="mt-1 flex items-center justify-between border-t px-3 py-2" [class]="footerClass()">
          <button type="button" class="text-xs font-semibold text-primary hover:underline" (click)="clear()">Clear</button>
          <button type="button" class="text-xs font-semibold text-primary hover:underline" (click)="selectToday()">Today</button>
        </div>
      </div>
    }
  `
})
export class DatePicker {
  readonly value = input<string | null>(null);
  readonly label = input<string>('');
  readonly placeholder = input<string>('Select date');
  readonly theme = input<DatePickerTheme>('light');
  readonly icon = input<string | null>(null);
  readonly valueChange = output<string>();

  protected readonly open = signal(false);
  protected readonly weekdayLabels = WEEKDAY_LABELS;

  protected readonly selectedDate = computed(() => {
    const value = this.value();
    return value ? parseIsoDate(value) : null;
  });

  private readonly today = new Date();
  protected readonly viewDate = signal(this.selectedDate() ?? this.today);

  protected readonly viewYear = computed(() => this.viewDate().getFullYear());
  protected readonly monthLabel = computed(() => MONTH_LABELS[this.viewDate().getMonth()]);

  protected readonly displayValue = computed(() => {
    const date = this.selectedDate();
    if (!date) return this.placeholder();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
  });

  protected readonly gridDays = computed<CalendarDay[]>(() => {
    const view = this.viewDate();
    const month = view.getMonth();
    const firstOfMonth = new Date(view.getFullYear(), month, 1);
    const daysInMonth = new Date(view.getFullYear(), month + 1, 0).getDate();
    const start = new Date(view.getFullYear(), month, 1 - firstOfMonth.getDay());
    const cellCount = Math.ceil((firstOfMonth.getDay() + daysInMonth) / 7) * 7;
    const selected = this.selectedDate();

    return Array.from({ length: cellCount }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        iso: toIsoDate(date),
        dayOfMonth: date.getDate(),
        inCurrentMonth: date.getMonth() === month,
        isToday: isSameDay(date, this.today),
        isSelected: selected !== null && isSameDay(date, selected)
      };
    });
  });

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  protected triggerClass(): string {
    const base = 'flex h-11 w-full items-center rounded-lg border pr-4 text-sm outline-none transition-all';
    const padding = this.icon() ? 'pl-10' : 'pl-4';
    const theme =
      this.theme() === 'dark'
        ? 'border-slate-700 bg-slate-800 text-white focus:border-primary focus:ring-2 focus:ring-primary/20'
        : 'border-slate-200 bg-white text-slate-900 focus:border-primary focus:ring-2 focus:ring-primary/20';
    return `${base} ${padding} ${theme}`;
  }

  protected panelClass(): string {
    const base = 'absolute left-0 z-20 mt-1.5 w-72 rounded-xl border p-2 shadow-lg';
    return this.theme() === 'dark'
      ? `${base} border-slate-700 bg-slate-800 text-slate-200 shadow-black/30`
      : `${base} border-slate-200 bg-white text-slate-700 shadow-slate-900/10`;
  }

  protected navButtonClass(): string {
    const base = 'flex h-6 w-6 items-center justify-center rounded-full transition-colors';
    return this.theme() === 'dark' ? `${base} text-slate-400 hover:bg-slate-700 hover:text-white` : `${base} text-slate-500 hover:bg-slate-100 hover:text-slate-900`;
  }

  protected footerClass(): string {
    return this.theme() === 'dark' ? 'border-slate-700' : 'border-slate-100';
  }

  protected dayClass(day: CalendarDay): string {
    const base = 'flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors';

    if (day.isSelected) {
      return `${base} bg-primary font-bold text-white`;
    }

    const muted = this.theme() === 'dark' ? 'text-slate-600 hover:bg-slate-700' : 'text-slate-300 hover:bg-slate-100';
    const normal = this.theme() === 'dark' ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-700 hover:bg-slate-100';
    const today = day.isToday ? 'font-bold text-primary' : '';

    return `${base} ${day.inCurrentMonth ? normal : muted} ${today}`;
  }

  protected toggle(): void {
    this.open.update((isOpen) => !isOpen);
    if (this.open()) {
      this.viewDate.set(this.selectedDate() ?? this.today);
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  protected previousMonth(): void {
    const view = this.viewDate();
    this.viewDate.set(new Date(view.getFullYear(), view.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    const view = this.viewDate();
    this.viewDate.set(new Date(view.getFullYear(), view.getMonth() + 1, 1));
  }

  protected selectDay(day: CalendarDay): void {
    this.valueChange.emit(day.iso);
    this.close();
  }

  protected selectToday(): void {
    this.valueChange.emit(toIsoDate(this.today));
    this.close();
  }

  protected clear(): void {
    this.valueChange.emit('');
    this.close();
  }

  protected onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }
}

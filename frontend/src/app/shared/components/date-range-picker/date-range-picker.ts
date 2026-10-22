import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export interface DateRange {
  start: string;
  end: string;
}

interface CalendarDay {
  date: string;
  day: number;
  currentMonth: boolean;
}

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

const THAI_SHORT_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

@Component({
  selector: 'app-date-range-picker',
  templateUrl: './date-range-picker.html',
  styleUrl: './date-range-picker.css',
  host: {
    class: 'relative block min-w-0',
    '(document:click)': 'handleDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class DateRangePicker {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly start = input('');
  readonly end = input('');
  readonly rangeChange = output<DateRange>();

  protected readonly open = signal(false);
  protected readonly draftStart = signal('');
  protected readonly draftEnd = signal('');
  protected readonly viewDate = signal(this.firstDayOfMonth(new Date()));
  protected readonly weekdays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

  protected readonly hasRange = computed(() => Boolean(this.start() || this.end()));
  protected readonly triggerLabel = computed(() => this.formatRange(this.start(), this.end()));
  protected readonly monthLabel = computed(() => {
    const date = this.viewDate();
    return `${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
  });
  protected readonly calendarDays = computed<readonly CalendarDay[]>(() => {
    const view = this.viewDate();
    const year = view.getFullYear();
    const month = view.getMonth();
    const gridStart = new Date(year, month, 1 - new Date(year, month, 1).getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      );
      return {
        date: this.toDateValue(date),
        day: date.getDate(),
        currentMonth: date.getMonth() === month,
      };
    });
  });

  constructor() {
    effect(() => {
      this.draftStart.set(this.start());
      this.draftEnd.set(this.end());
    });
  }

  protected toggle(): void {
    this.open.update((value) => !value);
    if (this.open()) {
      const focusDate = this.start() || this.end();
      this.viewDate.set(
        focusDate
          ? this.firstDayOfMonth(this.parseDate(focusDate))
          : this.firstDayOfMonth(new Date()),
      );
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  protected previousMonth(): void {
    const current = this.viewDate();
    this.viewDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    const current = this.viewDate();
    this.viewDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }

  protected selectDate(value: string): void {
    const start = this.draftStart();
    const end = this.draftEnd();

    if (!start || end) {
      this.draftStart.set(value);
      this.draftEnd.set('');
      return;
    }

    if (value < start) {
      this.draftStart.set(value);
      this.draftEnd.set(start);
      return;
    }

    this.draftEnd.set(value);
  }

  protected isSelected(value: string): boolean {
    return value === this.draftStart() || value === this.draftEnd();
  }

  protected isInRange(value: string): boolean {
    const start = this.draftStart();
    const end = this.draftEnd();
    return Boolean(start && end && value > start && value < end);
  }

  protected isToday(value: string): boolean {
    return value === this.toDateValue(new Date());
  }

  protected dayAriaLabel(value: string): string {
    return this.formatFullDate(value);
  }

  protected apply(): void {
    this.rangeChange.emit({ start: this.draftStart(), end: this.draftEnd() });
    this.close();
  }

  protected clear(): void {
    this.draftStart.set('');
    this.draftEnd.set('');
    this.rangeChange.emit({ start: '', end: '' });
    this.close();
  }

  protected handleDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  protected formatFullDate(value: string): string {
    if (!value) {
      return 'ยังไม่ได้เลือก';
    }
    const date = this.parseDate(value);
    return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
  }

  private formatRange(start: string, end: string): string {
    if (!start && !end) {
      return 'ทุกช่วงเวลา';
    }
    if (!end) {
      return `ตั้งแต่ ${this.formatCompactDate(start)}`;
    }

    const startDate = this.parseDate(start);
    const endDate = this.parseDate(end);
    if (
      startDate.getMonth() === endDate.getMonth() &&
      startDate.getFullYear() === endDate.getFullYear()
    ) {
      return `${startDate.getDate()}-${endDate.getDate()} ${THAI_SHORT_MONTHS[startDate.getMonth()]} ${startDate.getFullYear() + 543}`;
    }
    return `${this.formatCompactDate(start)} - ${this.formatCompactDate(end)}`;
  }

  private formatCompactDate(value: string): string {
    const date = this.parseDate(value);
    return `${date.getDate()} ${THAI_SHORT_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
  }

  private parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private toDateValue(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private firstDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
}

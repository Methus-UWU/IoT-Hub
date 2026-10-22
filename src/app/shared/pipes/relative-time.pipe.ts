import { Pipe, PipeTransform } from '@angular/core';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const THAI_DATE = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * "3 ชั่วโมงที่แล้ว" for recent timestamps, an absolute Thai date beyond a week.
 *
 * Relative wording is what makes a feed readable at a glance, but it stops being
 * useful once the answer is "48 วันที่แล้ว" — past a week the actual date says
 * more. The pipe is impure-free on purpose: it recomputes only when the input
 * changes, so an open page does not re-render every tick.
 */
@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';

    const time = value instanceof Date ? value : new Date(value);
    const elapsed = Date.now() - time.getTime();
    if (Number.isNaN(elapsed)) return '';

    if (elapsed < MINUTE) return 'เมื่อสักครู่';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} นาทีที่แล้ว`;
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} ชั่วโมงที่แล้ว`;
    if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)} วันที่แล้ว`;

    return THAI_DATE.format(time);
  }
}

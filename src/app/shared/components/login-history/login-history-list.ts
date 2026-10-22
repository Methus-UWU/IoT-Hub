import { Component, input } from '@angular/core';

import type { LoginEvent } from '../../../core/services/auth.service';
import { describeUserAgent } from './describe-user-agent';

const DATE_TIME = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Bangkok',
});

/**
 * Sign-in history as a table: when, from which IP address, on which device.
 *
 * Presentation only — the caller loads the events, so the account page and the
 * admin console share one rendering over their own endpoints.
 */
@Component({
  selector: 'app-login-history-list',
  template: `
    @if (loading()) {
      <p class="login-history-note" role="status">กำลังโหลดประวัติการเข้าสู่ระบบ…</p>
    } @else if (error()) {
      <p class="login-history-note login-history-error" role="alert">{{ error() }}</p>
    } @else if (events().length === 0) {
      <p class="login-history-note">ยังไม่มีประวัติการเข้าสู่ระบบ</p>
    } @else {
      <div class="login-history-scroll">
        <table class="login-history-table">
          <caption class="sr-only">ประวัติการเข้าสู่ระบบ ล่าสุดก่อน</caption>
          <thead>
            <tr>
              <th scope="col">วันและเวลา</th>
              <th scope="col">IP Address</th>
              <th scope="col">อุปกรณ์</th>
            </tr>
          </thead>
          <tbody>
            @for (event of events(); track event.id) {
              <tr>
                <td>{{ formatDate(event.createdAt) }}</td>
                <td class="login-history-mono">{{ event.ipAddress || '—' }}</td>
                <td [attr.title]="event.userAgent || null">{{ device(event.userAgent) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .login-history-note {
      margin: 0;
      font-size: 0.875rem;
      color: #6b7280;
    }
    .login-history-error {
      color: #b91c1c;
    }
    .login-history-scroll {
      overflow-x: auto;
    }
    .login-history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    .login-history-table th {
      padding: 0.5rem 0.75rem;
      text-align: left;
      font-weight: 400;
      font-size: 0.75rem;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
    }
    .login-history-table td {
      padding: 0.625rem 0.75rem;
      color: #111827;
      border-bottom: 1px solid #f3f4f6;
      white-space: nowrap;
    }
    .login-history-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
    }
  `,
})
export class LoginHistoryList {
  readonly events = input<readonly LoginEvent[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  protected formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
  }

  protected device(userAgent: string): string {
    return describeUserAgent(userAgent);
  }
}

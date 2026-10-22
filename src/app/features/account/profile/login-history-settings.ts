import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthService, type LoginEvent } from '../../../core/services/auth.service';
import { LoginHistoryList } from '../../../shared/components/login-history/login-history-list';
import { SettingsSkeleton } from './settings-skeleton';

/** The account owner's own sign-ins, so an unfamiliar device stands out. */
@Component({
  selector: 'app-login-history-settings',
  imports: [LoginHistoryList, SettingsSkeleton],
  template: `
    <header class="section-heading">
      <h2 id="login-history-title">ประวัติการเข้าสู่ระบบ</h2>
      <p class="settings-help">
        วัน เวลา IP Address และอุปกรณ์ของการเข้าสู่ระบบแต่ละครั้ง ถ้าพบรายการที่ไม่ใช่คุณ
        ให้เปลี่ยนรหัสผ่านทันที
      </p>
    </header>
    @if (loading()) {
      <app-settings-skeleton />
    } @else {
      <app-login-history-list [events]="events()" [error]="error()" />
    }
    <footer class="settings-footer">
      <button
        type="button"
        class="settings-button secondary"
        [disabled]="loading()"
        (click)="load()"
      >
        โหลดประวัติใหม่
      </button>
    </footer>
  `,
  styleUrl: './profile.page.css',
})
export class LoginHistorySettings {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly events = signal<LoginEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth
      .listLoginHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (events) => {
          this.events.set(events);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
          this.loading.set(false);
        },
      });
  }
}

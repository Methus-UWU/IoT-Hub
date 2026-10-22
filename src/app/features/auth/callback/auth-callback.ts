import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';

/**
 * Landing page for the OAuth and email-confirmation redirects.
 *
 * The Supabase client parses the fragment and stores the session itself
 * (`detectSessionInUrl`); this component waits for that to settle, then sends the
 * user to the right home screen.
 *
 * When the provider round-trip fails, Supabase reports it in the URL rather than by
 * throwing — in the query string, the fragment, or both. Those parameters are read
 * and shown, because a generic "no session" message here sends people looking for
 * the fault in the wrong place.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    <div class="flex min-h-100 flex-col items-center justify-center gap-4 p-8 text-center">
      @if (error(); as message) {
        <h1 class="text-lg font-semibold text-gray-900">เข้าสู่ระบบไม่สำเร็จ</h1>
        <p class="max-w-md text-sm text-gray-600">{{ message }}</p>
        @if (errorCode(); as code) {
          <p class="font-mono text-xs text-gray-400">{{ code }}</p>
        }
        <div class="flex flex-wrap items-center justify-center gap-2">
          @if (retryable()) {
            <button
              type="button"
              class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
              [disabled]="retrying()"
              (click)="retry()"
            >
              {{ retrying() ? 'กำลังลองใหม่…' : 'ลองอีกครั้ง' }}
            </button>
          }
          <a
            routerLink="/auth/login"
            class="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
            >กลับไปหน้าเข้าสู่ระบบ</a
          >
        </div>
      } @else {
        <div
          class="h-8 w-8 animate-spin rounded-full border-3 border-gray-200 border-t-primary"
          role="status"
          aria-label="กำลังเข้าสู่ระบบ"
        ></div>
        <p class="text-sm text-gray-600">กำลังเข้าสู่ระบบ…</p>
      }
    </div>
  `,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);

  protected readonly error = signal<string | null>(null);
  protected readonly errorCode = signal<string | null>(null);
  protected readonly retryable = signal(false);
  protected readonly retrying = signal(false);

  constructor() {
    void this.complete();
  }

  protected async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    await this.complete();
    this.retrying.set(false);
  }

  private async complete(): Promise<void> {
    this.error.set(null);
    this.errorCode.set(null);
    this.retryable.set(false);

    const reported = readRedirectError();
    if (reported) {
      this.logger.error('OAuth callback returned an error', reported);
      this.errorCode.set(reported.code);
      this.error.set(explain(reported));
      return;
    }

    try {
      const session = await firstValueFrom(this.auth.restoreSession());
      if (!session) {
        this.error.set('ไม่พบเซสชัน กรุณาลองเข้าสู่ระบบอีกครั้ง');
        return;
      }

      const user = await firstValueFrom(this.auth.getCurrentUser());
      const destination =
        user.role.name.toLowerCase() === 'admin' ? '/admin' : '/user/projects';
      await this.router.navigateByUrl(destination);
    } catch (error) {
      this.logger.error('OAuth callback failed', error);
      this.reportProfileFailure(error);
    }
  }

  /**
   * Separates a rejected identity from an unreachable API.
   *
   * Supabase has already stored a valid session by this point. If our own API
   * refused it, that session is useless and is abandoned, or every later route
   * guard repeats the same failing call. A gateway or network fault says nothing
   * about the identity, so the session is kept and the call can simply be retried
   * — signing the visitor out there would make them redo the whole OAuth trip for
   * an outage on our side.
   */
  private reportProfileFailure(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : null;
    const rejected = status === 401 || status === 403;

    if (status !== null) {
      this.errorCode.set(`HTTP ${status}`);
    }

    if (rejected) {
      this.auth.logout().subscribe({ error: () => this.auth.clearSession() });
      this.error.set('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
      return;
    }

    this.retryable.set(true);
    this.error.set(
      status === 0 || status === null
        ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'
        : 'เซิร์ฟเวอร์ไม่พร้อมให้บริการชั่วคราว กรุณาลองอีกครั้งในอีกสักครู่',
    );
  }
}

interface RedirectError {
  code: string;
  description: string;
}

/** Supabase reports failures in the query string, the fragment, or both. */
function readRedirectError(): RedirectError | null {
  const search = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  const code =
    search.get('error_code') ??
    fragment.get('error_code') ??
    search.get('error') ??
    fragment.get('error');
  if (!code) return null;

  const description =
    search.get('error_description') ?? fragment.get('error_description') ?? '';

  return { code, description };
}

function explain({ code, description }: RedirectError): string {
  if (description.includes('Unable to exchange external code')) {
    // The provider accepted the user and returned a code, so the client id and
    // callback URL are right. Only the client secret is used by the exchange.
    return 'ผู้ให้บริการปฏิเสธการแลกเปลี่ยนรหัส — Client Secret ที่ตั้งไว้ใน Supabase ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า';
  }
  if (code === 'access_denied') {
    return 'คุณยกเลิกการอนุญาตที่หน้าผู้ให้บริการ';
  }
  if (description) return description;
  return 'เข้าสู่ระบบผ่านผู้ให้บริการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

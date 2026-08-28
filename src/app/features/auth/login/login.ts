import { Component, inject, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService, OAuthProvider } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { LoginFormValue } from './login.interface';

/**
 * Sign-in against Supabase Auth: email/password, Google, or GitHub.
 *
 * The Cloudflare Turnstile widget was removed. Its token was sent to the API and
 * never verified, so it protected nothing, and sign-in no longer passes through the
 * API at all. Bot protection belongs in the Supabase dashboard under
 * Authentication → Attack Protection, where it is actually enforced.
 */
@Component({
  selector: 'app-login',
  imports: [FormField, RouterLink],
  templateUrl: './login.html',
})
export class Login {
  private readonly logger = inject(LoggerService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  private readonly model = signal<LoginFormValue>({
    email: '',
    password: '',
    rememberMe: false,
  });

  protected readonly loginForm = form(this.model, (path) => {
    required(path.email, { message: 'กรุณากรอกอีเมล' });
    required(path.password, { message: 'กรุณากรอกรหัสผ่าน' });
  });

  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  protected async onSubmit(): Promise<void> {
    this.submitError.set(null);
    this.submitting.set(true);

    try {
      await submit(this.loginForm, async () => {
        const value = this.loginForm().value();
        await firstValueFrom(
          this.authService.loginWithPassword({
            email: value.email.trim(),
            password: value.password,
          }),
        );

        const user = await firstValueFrom(this.authService.getCurrentUser());
        const destination =
          user.role.name.toLowerCase() === 'admin' ? '/admin' : '/user/projects';
        this.logger.info('Login successful');
        await this.router.navigateByUrl(destination);
        return undefined;
      });
    } catch (error) {
      this.logger.error('Login failed', error);
      this.submitError.set(signInErrorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Starts the OAuth redirect. The browser navigates away, so `submitting` is left
   * set: the component is about to be discarded, and re-enabling the buttons would
   * only invite a second click during the redirect.
   */
  protected async onProviderLogin(provider: OAuthProvider): Promise<void> {
    this.submitError.set(null);
    this.submitting.set(true);

    try {
      await firstValueFrom(this.authService.loginWithProvider(provider));
    } catch (error) {
      this.logger.error(`${provider} sign-in failed`, error);
      this.submitError.set('ไม่สามารถเริ่มการเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง');
      this.submitting.set(false);
    }
  }
}

/**
 * Supabase reports a failed sign-in uniformly, whether the address is unknown or
 * the password is wrong, which is what keeps the endpoint from confirming that an
 * account exists. The message here preserves that.
 */
function signInErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('invalid login credentials')) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  }
  if (message.includes('email not confirmed')) {
    return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง';
  }
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

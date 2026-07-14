import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { LoggerService } from '../../../core/services/logger.service';
import { environment } from '../../../../environments/environment';

interface LoginFormValue {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface TurnstileRenderOptions {
  sitekey: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  theme?: 'light' | 'dark' | 'auto';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_POLL_INTERVAL_MS = 500;

@Component({
  selector: 'app-login',
  imports: [FormField, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly turnstileContainer = viewChild<ElementRef<HTMLDivElement>>('turnstileContainer');

  protected readonly turnstileSiteKey = environment.turnstileSiteKey;
  protected readonly turnstileToken = signal('');

  private readonly model = signal<LoginFormValue>({
    email: '',
    password: '',
    rememberMe: false
  });

  protected readonly loginForm = form(this.model, (path) => {
    required(path.email, { message: 'Enter your email' });
    required(path.password, { message: 'Enter your password' });
  });

  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.renderTurnstile());
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  protected async onSubmit(): Promise<void> {
    this.submitError.set(null);

    if (!this.turnstileToken()) {
      this.submitError.set('Please complete the security check.');
      this.logger.warn('Login blocked: Turnstile token missing');
      return;
    }

    this.submitting.set(true);

    try {
      await submit(this.loginForm, async () => {
        this.logger.info('Login submitted', { email: this.model().email });
        return undefined;
      });
    } finally {
      this.submitting.set(false);
    }
  }

  private renderTurnstile(): void {
    const container = this.turnstileContainer()?.nativeElement;
    if (!container) return;

    if (!window.turnstile) {
      const timeoutId = setTimeout(() => this.renderTurnstile(), TURNSTILE_POLL_INTERVAL_MS);
      this.destroyRef.onDestroy(() => clearTimeout(timeoutId));
      return;
    }

    window.turnstile.render(container, {
      sitekey: this.turnstileSiteKey,
      appearance: 'always',
      theme: 'light',
      callback: (token) => {
        this.turnstileToken.set(token);
      },
      'expired-callback': () => {
        this.turnstileToken.set('');
        this.logger.warn('Turnstile token expired');
      },
      'error-callback': () => {
        this.turnstileToken.set('');
        this.logger.error('Turnstile error occurred');
      }
    });
  }
}

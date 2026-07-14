import { Component, computed, inject, signal } from '@angular/core';
import { FormField, ReadonlyFieldState, email, form, minLength, pattern, required, submit, validate, validateHttp } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

type AvailabilityField = 'username' | 'email';
type CheckStatus = 'idle' | 'checking' | 'valid' | 'invalid';

interface SignupFormValue {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface AvailabilityResult {
  exists: boolean;
}

interface PasswordRule {
  label: string;
  met: (password: string, confirmPassword: string) => boolean;
}

const PASSWORD_RULES: readonly PasswordRule[] = [
  { label: 'Minimum 8 characters', met: (password) => password.length >= 8 },
  { label: 'At least one uppercase letter', met: (password) => /[A-Z]/.test(password) },
  { label: 'At least one special character', met: (password) => /[!@#$%^&*(),.?":{}|<>]/.test(password) },
  { label: 'Passwords match', met: (password, confirmPassword) => confirmPassword.length > 0 && password === confirmPassword }
];

@Component({
  selector: 'app-signup',
  imports: [FormField, RouterLink, FieldError],
  templateUrl: './signup.html',
  styleUrl: './signup.css'
})
export class Signup {
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly authService = inject(AuthService);

  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly passwordRulesVisible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  private readonly model = signal<SignupFormValue>({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  protected readonly signupForm = form(this.model, (path) => {
    required(path.username, { message: 'Enter a username' });
    pattern(path.username, /^\S+$/, { message: 'Username cannot contain spaces' });
    validateHttp(path.username, {
      request: (ctx) => this.availabilityUrl('username', ctx.value()),
      debounce: 500,
      onSuccess: (result: AvailabilityResult) => (result.exists ? [{ kind: 'taken', message: 'This username is already taken' }] : []),
      onError: (error) => {
        this.logger.warn('Username availability check failed', error);
        return [];
      }
    });

    required(path.email, { message: 'Enter your email address' });
    email(path.email, { message: 'Enter a valid email address' });
    validateHttp(path.email, {
      request: (ctx) => this.availabilityUrl('email', ctx.value()),
      debounce: 500,
      onSuccess: (result: AvailabilityResult) => (result.exists ? [{ kind: 'taken', message: 'This email is already taken' }] : []),
      onError: (error) => {
        this.logger.warn('Email availability check failed', error);
        return [];
      }
    });

    required(path.password, { message: 'Enter a password' });
    minLength(path.password, 8, { message: 'Minimum 8 characters' });
    pattern(path.password, /[A-Z]/, { message: 'Add an uppercase letter' });
    pattern(path.password, /[!@#$%^&*(),.?":{}|<>]/, { message: 'Add a special character' });

    required(path.confirmPassword, { message: 'Confirm your password' });
    validate(path.confirmPassword, (ctx) =>
      ctx.value() !== ctx.valueOf(path.password) ? { kind: 'mismatch', message: 'Passwords do not match' } : null
    );
  });

  protected readonly passwordRules = computed(() => {
    const { password, confirmPassword } = this.model();
    return PASSWORD_RULES.map((rule) => ({
      label: rule.label,
      status: (!password ? 'idle' : rule.met(password, confirmPassword) ? 'valid' : 'invalid') as 'idle' | 'valid' | 'invalid'
    }));
  });

  protected fieldCheckStatus(state: ReadonlyFieldState<string>): CheckStatus {
    if (!state.value().trim()) return 'idle';
    if (state.pending()) return 'checking';
    return state.invalid() ? 'invalid' : 'valid';
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  protected toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((value) => !value);
  }

  protected showPasswordRules(): void {
    this.passwordRulesVisible.set(true);
  }

  protected async onSubmit(): Promise<void> {
    this.submitError.set(null);
    this.submitting.set(true);

    try {
      await submit(this.signupForm, async () => {
        const value = this.signupForm().value();

        await firstValueFrom(
          this.authService.register({
            username: value.username,
            email: value.email,
            password: value.password
          })
        );

        this.logger.info('Signup submitted', { username: value.username });
        this.router.navigateByUrl('/auth/login');
        return undefined;
      });
    } catch (error) {
      this.logger.error('Signup failed', error);
      this.submitError.set('Something went wrong. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  private availabilityUrl(field: AvailabilityField, value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return `${environment.apiUrl}auth/availability?field=${field}&value=${encodeURIComponent(trimmed)}`;
  }
}

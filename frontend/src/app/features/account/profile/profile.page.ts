import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormField,
  form,
  minLength,
  maxLength,
  pattern,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import {
  AuthService,
  AuthUser,
  ChangePasswordPayload,
  UpdateProfilePayload,
} from '../../../core/services/auth.service';
import { Toast } from '../../../shared/components/toast/toast';
import { LoginHistorySettings } from './login-history-settings';
import { EmailSettings } from './email-settings';
import { AvatarEditor } from './avatar-editor';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { SettingsSkeleton } from './settings-skeleton';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountAvatarService } from '../../../core/services/account-avatar.service';

type SettingsSection = 'profile' | 'security' | 'logins';
const SECTIONS: readonly SettingsSection[] = ['profile', 'security', 'logins'];

interface PasswordFormValue extends ChangePasswordPayload {
  confirmNewPassword: string;
}

const EMPTY_PROFILE: UpdateProfilePayload = { username: '', displayName: '', bio: '' };
const EMPTY_PASSWORD: PasswordFormValue = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

@Component({
  selector: 'app-profile-page',
  imports: [
    FormField,
    Toast,
    EmailSettings,
    AvatarEditor,
    FieldError,
    LoginHistorySettings,
    SettingsSkeleton,
  ],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.css',
})
export class ProfilePage {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly avatar = inject(AccountAvatarService);
  private readonly canGoBack: boolean;
  private readonly model = signal<UpdateProfilePayload>({ ...EMPTY_PROFILE });
  private readonly initialProfile = signal<UpdateProfilePayload | null>(null);
  private readonly passwordModel = signal<PasswordFormValue>({ ...EMPTY_PASSWORD });

  protected readonly loading = signal(true);
  protected readonly credentialSettingsReady = this.authService.credentialSettingsReady;
  protected readonly canEditCredentials = this.authService.canEditCredentials;
  protected readonly usesExternalLogin = this.authService.usesExternalLogin;
  protected readonly activeSection = signal<SettingsSection>('profile');
  protected readonly profileLoaded = signal(false);
  protected readonly pageLoading = computed(
    () => this.loading() || (this.profileLoaded() && !this.avatar.ready()),
  );
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordSaving = signal(false);
  protected readonly passwordSaved = signal(false);
  protected readonly showPasswords = signal(false);
  protected readonly historyOpened = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly initials = computed(() =>
    (this.model().displayName.trim() || this.model().username.trim() || 'User')
      .slice(0, 2)
      .toUpperCase(),
  );
  protected readonly roleLabel = computed(() =>
    this.authService.currentUser()?.role.name.toLowerCase() === 'admin'
      ? 'ผู้ดูแลระบบ'
      : 'ผู้ใช้งาน',
  );
  /** Owned by Supabase Auth, shown read-only. */
  protected readonly emailAddress = this.authService.accountEmail;
  protected readonly hasProfileChanges = computed(() => {
    const initial = this.initialProfile();
    const current = this.model();
    return Boolean(
      initial &&
      (current.username !== initial.username ||
        current.displayName !== initial.displayName ||
        current.bio !== initial.bio),
    );
  });

  protected readonly profileForm = form(this.model, (path) => {
    maxLength(path.displayName, 60, { message: 'ชื่อที่แสดงต้องไม่เกิน 60 ตัวอักษร' });
    maxLength(path.bio, 280, { message: 'แนะนำตัวต้องไม่เกิน 280 ตัวอักษร' });
    required(path.username, { message: 'กรุณากรอกชื่อผู้ใช้งาน' });
    minLength(path.username, 2, { message: 'ชื่อผู้ใช้งานต้องมีอย่างน้อย 2 ตัวอักษร' });
    maxLength(path.username, 40, { message: 'ชื่อผู้ใช้งานต้องไม่เกิน 40 ตัวอักษร' });
    pattern(path.username, /^[a-zA-Z0-9._-]+$/, {
      message: 'ใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดล่าง และขีดกลาง',
    });
  });

  protected readonly passwordForm = form(this.passwordModel, (path) => {
    required(path.currentPassword, { message: 'กรุณากรอกรหัสผ่านปัจจุบัน' });

    required(path.newPassword, { message: 'กรุณากรอกรหัสผ่านใหม่' });
    minLength(path.newPassword, 8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    pattern(path.newPassword, /[A-Z]/, { message: 'ต้องมีตัวอักษรภาษาอังกฤษพิมพ์ใหญ่' });
    pattern(path.newPassword, /[!@#$%^&*(),.?":{}|<>]/, {
      message: 'ต้องมีอักขระพิเศษอย่างน้อย 1 ตัว',
    });
    validate(path.newPassword, (ctx) =>
      ctx.value() === ctx.valueOf(path.currentPassword)
        ? { kind: 'samePassword', message: 'รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านปัจจุบัน' }
        : null,
    );

    required(path.confirmNewPassword, { message: 'กรุณายืนยันรหัสผ่านใหม่' });
    validate(path.confirmNewPassword, (ctx) =>
      ctx.value() !== ctx.valueOf(path.newPassword)
        ? { kind: 'passwordMismatch', message: 'รหัสผ่านใหม่ไม่ตรงกัน' }
        : null,
    );
  });

  constructor() {
    const previous = this.router.currentNavigation()?.previousNavigation?.finalUrl?.toString();
    const state = this.location.getState() as Record<string, unknown> | null;
    this.canGoBack = Boolean(
      (previous && !/^\/(?:user\/settings|admin\/profile|auth)(?:[/?#;]|$)/.test(previous)) ||
      state?.['accountSettingsHasPreviousPage'] === true,
    );
    afterNextRender(() => {
      this.location.replaceState(this.location.path(), '', {
        ...(this.location.getState() as Record<string, unknown>),
        accountSettingsHasPreviousPage: this.canGoBack,
      });
    });
    const requested = inject(ActivatedRoute).snapshot.queryParamMap.get('section');
    if (requested && (SECTIONS as readonly string[]).includes(requested)) {
      this.openSection(requested as SettingsSection);
    }
    const user = this.authService.currentUser();
    if (user) {
      this.acceptProfile(user);
    } else {
      this.loadProfile();
    }
  }

  protected goBack(): void {
    if (this.canGoBack) {
      this.location.back();
    } else {
      const fallback =
        this.authService.currentUser()?.role.name.toLowerCase() === 'admin'
          ? '/admin'
          : '/user/projects';
      void this.router.navigateByUrl(fallback, { replaceUrl: true });
    }
  }

  protected loadProfile(): void {
    this.loading.set(true);
    this.error.set(null);
    this.authService
      .getCurrentUser()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => this.acceptProfile(user),
        error: () => {
          this.error.set('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้');
          this.loading.set(false);
        },
      });
  }

  private acceptProfile(user: AuthUser): void {
    const profile = {
      username: user.username,
      displayName: user.displayName ?? '',
      bio: user.bio ?? '',
    };
    this.model.set(profile);
    this.initialProfile.set(profile);
    this.profileForm().reset();
    this.loading.set(false);
    this.profileLoaded.set(true);
  }

  protected resetProfile(): void {
    const profile = this.initialProfile();
    if (!profile || this.saving()) return;
    this.model.set({ ...profile });
    this.profileForm().reset();
    this.dismissNotifications();
  }

  protected openSection(section: SettingsSection): void {
    this.activeSection.set(section);
    this.showPasswords.set(false);
    if (section === 'logins') this.historyOpened.set(true);
  }

  protected async saveProfile(): Promise<void> {
    if (this.saving() || !this.profileLoaded()) return;
    this.dismissNotifications();
    this.saving.set(true);

    try {
      await submit(this.profileForm, async () => {
        const user = await firstValueFrom(this.authService.updateCurrentUser(this.model()));
        this.acceptProfile(user);
        this.saved.set(true);
        return undefined;
      });
    } catch {
      this.error.set('ไม่สามารถบันทึกโปรไฟล์ได้ ชื่อผู้ใช้งานอาจถูกใช้งานแล้ว กรุณาลองอีกครั้ง');
    } finally {
      this.saving.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordSaving() || !this.canEditCredentials()) return;
    this.dismissNotifications();
    this.passwordSaving.set(true);

    try {
      await submit(this.passwordForm, async () => {
        const value = this.passwordModel();
        await firstValueFrom(
          this.authService.changePassword({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
          }),
        );
        this.passwordModel.set({ ...EMPTY_PASSWORD });
        this.showPasswords.set(false);
        this.passwordForm().reset();
        this.passwordSaved.set(true);
        return undefined;
      });
    } catch {
      this.passwordError.set('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาตรวจสอบรหัสผ่านปัจจุบัน');
    } finally {
      this.passwordSaving.set(false);
    }
  }

  protected dismissNotifications(): void {
    this.error.set(null);
    this.saved.set(false);
    this.passwordError.set(null);
    this.passwordSaved.set(false);
  }
}

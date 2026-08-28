import { Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  form,
  minLength,
  pattern,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import {
  AuthService,
  ChangePasswordPayload,
  UpdateProfilePayload,
} from '../../../core/services/auth.service';
import { Toast } from '../../../shared/components/toast/toast';

interface PasswordFormValue extends ChangePasswordPayload {
  confirmNewPassword: string;
}

const EMPTY_PROFILE: UpdateProfilePayload = { username: '' };
const EMPTY_PASSWORD: PasswordFormValue = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

@Component({
  selector: 'app-profile-page',
  imports: [FormField, Toast],
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.css',
})
export class ProfilePage {
  private readonly authService = inject(AuthService);
  private readonly model = signal<UpdateProfilePayload>({ ...EMPTY_PROFILE });
  private readonly initialProfile = signal<UpdateProfilePayload | null>(null);
  private readonly passwordModel = signal<PasswordFormValue>({ ...EMPTY_PASSWORD });

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordSaving = signal(false);
  protected readonly passwordSaved = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly initials = computed(() =>
    (this.model().username.trim() || 'Admin').slice(0, 2).toUpperCase().padEnd(2, 'A'),
  );
  protected readonly roleLabel = computed(() =>
    this.authService.currentUser()?.role.name.toLowerCase() === 'admin'
      ? 'ผู้ดูแลระบบ'
      : 'ผู้ใช้งาน',
  );
  /** Owned by Supabase Auth, shown read-only. */
  protected readonly emailAddress = computed(
    () => this.authService.currentUser()?.email ?? '',
  );
  protected readonly hasProfileChanges = computed(() => {
    const initial = this.initialProfile();
    const current = this.model();
    return Boolean(initial && current.username !== initial.username);
  });

  protected readonly profileForm = form(this.model, (path) => {
    required(path.username, { message: 'กรุณากรอกชื่อผู้ใช้งาน' });
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
    this.authService.getCurrentUser().subscribe({
      next: (user) => {
        const profile = { username: user.username };
        this.model.set(profile);
        this.initialProfile.set(profile);
        this.profileForm().reset();
        this.loading.set(false);
      },
      error: () => {
        this.error.set('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้');
        this.loading.set(false);
      },
    });
  }

  protected async saveProfile(): Promise<void> {
    this.dismissNotifications();
    this.saving.set(true);

    try {
      await submit(this.profileForm, async () => {
        const user = await firstValueFrom(this.authService.updateCurrentUser(this.model()));
        const profile = { username: user.username };
        this.model.set(profile);
        this.initialProfile.set(profile);
        this.profileForm().reset();
        this.saved.set(true);
        return undefined;
      });
    } catch {
      this.error.set('ไม่สามารถบันทึกโปรไฟล์ได้ ชื่อผู้ใช้งานหรืออีเมลอาจถูกใช้งานแล้ว');
    } finally {
      this.saving.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
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

import { Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import {
  FormField,
  email,
  form,
  maxLength,
  minLength,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';

import type { AdminUserRole } from '../../../core/models/admin.model';
import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { UserManagementStore } from './user-management.store';

interface NewUserValue {
  email: string;
  username: string;
  password: string;
  role: AdminUserRole;
}

/**
 * Creates an account on someone's behalf.
 *
 * Rules mirror self sign-up, so an administrator cannot create a password the
 * sign-up form would refuse. The account is confirmed immediately; the owner can
 * change the password from their settings.
 */
@Component({
  selector: 'app-create-user-dialog',
  imports: [FormField, CustomSelect],
  templateUrl: './create-user-dialog.html',
  styleUrl: './user-management.page.css',
  host: { '(document:keydown.escape)': 'close()' },
})
export class CreateUserDialog {
  readonly roleOptions = input.required<readonly CustomSelectOption[]>();
  readonly closed = output<void>();

  private readonly store = inject(UserManagementStore);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  private readonly model = signal<NewUserValue>({
    email: '',
    username: '',
    password: '',
    role: 'user',
  });

  protected readonly userForm = form(this.model, (path) => {
    required(path.email, { message: 'กรุณากรอกอีเมล' });
    email(path.email, { message: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    required(path.username, { message: 'กรุณากรอกชื่อผู้ใช้งาน' });
    minLength(path.username, 2, { message: 'ชื่อผู้ใช้งานต้องมีอย่างน้อย 2 ตัวอักษร' });
    maxLength(path.username, 40, { message: 'ชื่อผู้ใช้งานต้องไม่เกิน 40 ตัวอักษร' });
    pattern(path.username, /^[a-zA-Z0-9._-]+$/, {
      message: 'ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดล่าง และขีดกลาง',
    });
    required(path.password, { message: 'กรุณากรอกรหัสผ่าน' });
    minLength(path.password, 8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    maxLength(path.password, 72, { message: 'รหัสผ่านต้องไม่เกิน 72 ตัวอักษร' });
    pattern(path.password, /[A-Z]/, { message: 'ต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว' });
    pattern(path.password, /[!@#$%^&*(),.?":{}|<>]/, {
      message: 'ต้องมีอักขระพิเศษอย่างน้อย 1 ตัว',
    });
  });

  constructor() {
    afterNextRender(() => this.emailInput()?.nativeElement.focus());
  }

  protected onRoleChange(value: string): void {
    this.model.update((current) => ({ ...current, role: value as AdminUserRole }));
  }

  protected close(): void {
    if (!this.saving()) this.closed.emit();
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await submit(this.userForm, async () => {
        const failure = await this.store.create(this.model());
        if (failure) {
          this.error.set(failure);
        } else {
          this.saving.set(false);
          this.closed.emit();
        }
        return undefined;
      });
    } finally {
      this.saving.set(false);
    }
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';

@Component({
  selector: 'app-email-settings',
  imports: [ReactiveFormsModule, FieldError],
  templateUrl: './email-settings.html',
  styleUrl: './profile.page.css',
})
export class EmailSettings {
  private readonly auth = inject(AuthService);
  protected readonly currentEmail = this.auth.accountEmail;
  protected readonly pendingEmail = this.auth.pendingEmail;
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly emailForm = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
  });

  protected async save(): Promise<void> {
    if (this.saving() || !this.auth.canEditCredentials()) return;
    this.error.set('');
    this.success.set('');
    const email = this.emailForm.controls.email.value.trim().toLowerCase();
    this.emailForm.controls.email.setValue(email);
    this.emailForm.markAllAsTouched();
    if (this.emailForm.invalid) return;
    if (email === this.currentEmail().toLowerCase()) {
      this.error.set('กรุณากรอกอีเมลใหม่ที่ต่างจากอีเมลปัจจุบัน');
      return;
    }
    this.saving.set(true);
    try {
      await firstValueFrom(this.auth.changeEmail(email));
      this.emailForm.reset();
      this.success.set(
        this.pendingEmail()
          ? 'ส่งคำขอแล้ว กรุณาตรวจสอบอีเมลเดิมและอีเมลใหม่เพื่อยืนยันการเปลี่ยนแปลง'
          : 'เปลี่ยนอีเมลเรียบร้อยแล้ว',
      );
    } catch {
      this.error.set(
        'เปลี่ยนอีเมลไม่สำเร็จ อีเมลอาจถูกใช้แล้ว หรือส่งคำขอบ่อยเกินไป กรุณาลองอีกครั้ง',
      );
    } finally {
      this.saving.set(false);
    }
  }
}

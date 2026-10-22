import { Component, computed, inject, signal } from '@angular/core';
import { FormField, HttpValidatorOptions, ReadonlyFieldState, email, form, minLength, pattern, required, submit, validate, validateHttp } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { AvailabilityField, AvailabilityResult, CheckStatus, PasswordRule, PasswordRuleView, SignupFormValue } from './signup.interface';

/** หน่วงก่อนยิงเช็คชื่อผู้ใช้/อีเมลซ้ำ เพื่อไม่ให้ยิง API ทุกครั้งที่พิมพ์ */
const AVAILABILITY_DEBOUNCE_MS = 500;

/**
 * กฎรหัสผ่านที่แสดงเป็น checklist ใต้ช่องกรอก
 * ต้องสอดคล้องกับ validator ของ path.password ด้านล่าง (checklist = ฝั่งบอกผู้ใช้, validator = ฝั่งบังคับจริง)
 */
const PASSWORD_RULES: readonly PasswordRule[] = [
  { label: 'อย่างน้อย 8 ตัวอักษร', met: (password) => password.length >= 8 },
  { label: 'มีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว', met: (password) => /[A-Z]/.test(password) },
  {
    label: 'มีอักขระพิเศษอย่างน้อย 1 ตัว',
    met: (password) => /[!@#$%^&*(),.?":{}|<>]/.test(password),
  },
  {
    label: 'รหัสผ่านตรงกัน',
    met: (password, confirmPassword) => confirmPassword.length > 0 && password === confirmPassword,
  },
];

@Component({
  selector: 'app-signup',
  imports: [FormField, RouterLink, FieldError],
  templateUrl: './signup.html',
})
export class Signup {
  // --- Dependencies -----------------------------------------------------
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly authService = inject(AuthService);

  // --- Form state -------------------------------------------------------

  /** ค่าปัจจุบันของฟอร์ม เป็น source of truth ที่ signal form อ่าน/เขียนผ่าน [formField] */
  private readonly model = signal<SignupFormValue>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  /**
   * form + validation schema
   * username / email: ตรวจรูปแบบในเครื่องก่อน แล้วค่อยเช็คซ้ำกับ backend (async)
   * password: ความยาว + ตัวพิมพ์ใหญ่ + อักขระพิเศษ
   * confirmPassword: ต้องตรงกับ password
   */
  protected readonly signupForm = form(this.model, (path) => {
    required(path.username, { message: 'กรุณากรอกชื่อผู้ใช้งาน' });
    pattern(path.username, /^\S+$/, { message: 'ชื่อผู้ใช้งานต้องไม่มีช่องว่าง' });
    validateHttp(path.username, this.availabilityCheck('username', 'ชื่อผู้ใช้งานนี้ถูกใช้แล้ว'));

    required(path.email, { message: 'กรุณากรอกอีเมล' });
    email(path.email, { message: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    validateHttp(path.email, this.availabilityCheck('email', 'อีเมลนี้ถูกใช้แล้ว'));

    required(path.password, { message: 'กรุณากรอกรหัสผ่าน' });
    minLength(path.password, 8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    pattern(path.password, /[A-Z]/, { message: 'เพิ่มตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว' });
    pattern(path.password, /[!@#$%^&*(),.?":{}|<>]/, {
      message: 'เพิ่มอักขระพิเศษอย่างน้อย 1 ตัว',
    });

    required(path.confirmPassword, { message: 'กรุณายืนยันรหัสผ่าน' });
    validate(path.confirmPassword, (ctx) =>
      ctx.value() !== ctx.valueOf(path.password)
        ? { kind: 'mismatch', message: 'รหัสผ่านไม่ตรงกัน' }
        : null,
    );
  });

  // --- UI state ---------------------------------------------------------

  /** true = แสดงรหัสผ่าน / ยืนยันรหัสผ่าน เป็นตัวอักษรธรรมดา (สลับด้วยปุ่มรูปตา) */
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  /** checklist รหัสผ่านจะโผล่หลังผู้ใช้โฟกัสช่องรหัสผ่านครั้งแรก แล้วแสดงค้างไว้ */
  protected readonly passwordRulesVisible = signal(false);

  /** true ระหว่างรอผลจาก API ใช้ปิดปุ่ม submit กันกดซ้ำ */
  protected readonly submitting = signal(false);

  /** ข้อความ error ระดับฟอร์ม (null = ไม่มี error) แสดงเหนือปุ่ม submit */
  protected readonly submitError = signal<string | null>(null);

  // --- Derived state ----------------------------------------------------

  /** กฎรหัสผ่านพร้อมสถานะ คำนวณใหม่ทุกครั้งที่ผู้ใช้พิมพ์ ยังไม่กรอกรหัสผ่าน = idle ทุกข้อ */
  protected readonly passwordRules = computed<PasswordRuleView[]>(() => {
    const { password, confirmPassword } = this.model();
    return PASSWORD_RULES.map((rule) => ({
      label: rule.label,
      status: !password ? 'idle' : rule.met(password, confirmPassword) ? 'valid' : 'invalid',
    }));
  });

  // --- Template helpers -------------------------------------------------

  /** แปลงสถานะของ field เป็นไอคอนท้ายช่อง input (ว่าง / สปินเนอร์ / ถูก / ผิด) */
  protected fieldCheckStatus(state: ReadonlyFieldState<string>): CheckStatus {
    if (!state.value().trim()) return 'idle';
    if (state.pending()) return 'checking';
    return state.invalid() ? 'invalid' : 'valid';
  }

  // --- Actions ----------------------------------------------------------

  /** สลับการแสดง/ซ่อนรหัสผ่าน */
  protected togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  /** สลับการแสดง/ซ่อนช่องยืนยันรหัสผ่าน */
  protected toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((value) => !value);
  }

  /** เปิด checklist รหัสผ่าน (เรียกตอนโฟกัสช่องรหัสผ่าน) */
  protected showPasswordRules(): void {
    this.passwordRulesVisible.set(true);
  }

  /** สมัครสมาชิก: submit() จะตรวจ validation ให้ก่อน เมื่อสำเร็จจะพาไปหน้า login */
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
            password: value.password,
          }),
        );

        this.logger.info('Signup submitted', { username: value.username });
        this.router.navigateByUrl('/auth/login');
        return undefined;
      });
    } catch (error) {
      this.logger.error('Signup failed', error);
      this.submitError.set('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      this.submitting.set(false);
    }
  }

  // --- Availability check -----------------------------------------------

  /**
   * สร้าง config ของ validateHttp สำหรับเช็คว่าค่าซ้ำกับที่มีในระบบหรือยัง (ใช้ร่วมกันทั้ง username และ email)
   * ถ้าเช็คไม่สำเร็จจะแค่ log แล้วปล่อยผ่าน เพื่อไม่บล็อกผู้ใช้ตอน API ล่ม (backend ตรวจซ้ำอีกชั้นตอน register)
   */
  private availabilityCheck(
    field: AvailabilityField,
    takenMessage: string,
  ): HttpValidatorOptions<string, AvailabilityResult> {
    return {
      request: (ctx) => this.availabilityUrl(field, ctx.value()),
      debounce: AVAILABILITY_DEBOUNCE_MS,
      onSuccess: (result) => (result.exists ? [{ kind: 'taken', message: takenMessage }] : []),
      onError: (error) => {
        this.logger.warn(`${field} availability check failed`, error);
        return [];
      },
    };
  }

  /** URL สำหรับเช็คค่าซ้ำ — คืน undefined เมื่อค่ายังว่าง เพื่อให้ validateHttp ข้ามการยิง API */
  private availabilityUrl(field: AvailabilityField, value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return `${environment.apiUrl}auth/availability?field=${field}&value=${encodeURIComponent(trimmed)}`;
  }
}

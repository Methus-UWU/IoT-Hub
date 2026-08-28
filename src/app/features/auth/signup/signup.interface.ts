/**
 * Types ของหน้าสมัครสมาชิก (features/auth/signup)
 * ใช้ร่วมกันระหว่าง signup.ts และ signup.html เท่านั้น
 * ถ้า type ไหนถูกใช้ข้าม feature ให้ย้ายไป core/interfaces แทน
 */

// --- Form ---------------------------------------------------------------

/** โครงค่าของฟอร์มสมัครสมาชิก = shape ของ model signal ที่ส่งเข้า form() */
export interface SignupFormValue {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

// --- Availability check (เช็คซ้ำกับ backend) -----------------------------

/** ฟิลด์ที่ต้องเช็คว่าซ้ำหรือยัง ผ่าน GET auth/availability?field=... */
export type AvailabilityField = 'username' | 'email';

/** รูปแบบ response ของ auth/availability — true = มีคนใช้ค่านี้แล้ว */
export interface AvailabilityResult {
  exists: boolean;
}

/** สถานะไอคอนท้ายช่อง input: ยังไม่กรอก / กำลังเช็ค / ใช้ได้ / ใช้ไม่ได้ */
export type CheckStatus = 'idle' | 'checking' | 'valid' | 'invalid';

// --- Password checklist --------------------------------------------------

/** สถานะของกฎรหัสผ่านแต่ละข้อ (ไม่มี 'checking' เพราะเช็คในเครื่อง ไม่ต้องยิง API) */
export type PasswordRuleStatus = 'idle' | 'valid' | 'invalid';

/** นิยามกฎรหัสผ่าน 1 ข้อ — met() คืน true เมื่อรหัสผ่านผ่านกฎนั้น */
export interface PasswordRule {
  label: string;
  met: (password: string, confirmPassword: string) => boolean;
}

/** กฎ 1 ข้อพร้อมสถานะที่คำนวณแล้ว ใช้ render checklist ใน template */
export interface PasswordRuleView {
  label: string;
  status: PasswordRuleStatus;
}

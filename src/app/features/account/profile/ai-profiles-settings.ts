import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, maxLength, pattern, required, submit } from '@angular/forms/signals';

import { apiErrorMessage } from '../../../core/models/api-error';
import {
  AiProfile,
  AiProfileInput,
  AiProfileScope,
  AiProfileTier,
  AiProfilesStore,
} from '../../../core/services/ai-profiles.store';
import { AuthService } from '../../../core/services/auth.service';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { SettingsSkeleton } from './settings-skeleton';

interface ProfileFormValue extends AiProfileInput {
  model: string;
  scope: AiProfileScope;
}

const EMPTY_FORM: ProfileFormValue = {
  name: '',
  description: '',
  model: '',
  tier: 'auto',
  instructions: '',
  scope: 'personal',
};

const TIER_LABELS: Record<AiProfileTier, string> = {
  auto: 'อัตโนมัติ',
  balanced: 'สมดุล',
  deep: 'คิดละเอียด',
};

/**
 * AI profiles in account settings, the same section for users and admins.
 *
 * Everyone manages their own profiles. An admin also sees the controls for system
 * profiles, which every user is offered. That difference is presentation only: the
 * server checks the admin role on every system-profile write.
 */
@Component({
  selector: 'app-ai-profiles-settings',
  imports: [FormField, FieldError, NgTemplateOutlet, SettingsSkeleton],
  templateUrl: './ai-profiles-settings.html',
  styleUrls: ['./profile.page.css', './ai-profiles-settings.css'],
})
export class AiProfilesSettings {
  private readonly store = inject(AiProfilesStore);
  private readonly auth = inject(AuthService);

  protected readonly tierLabels = TIER_LABELS;
  protected readonly tiers: AiProfileTier[] = ['auto', 'balanced', 'deep'];
  protected readonly loading = computed(() => !this.store.loaded() && !this.store.failed());
  protected readonly failed = this.store.failed;
  protected readonly isAdmin = computed(
    () => this.auth.currentUser()?.role.name.toLowerCase() === 'admin',
  );
  protected readonly systemProfiles = computed(() =>
    this.store.profiles().filter((profile) => profile.scope === 'system'),
  );
  protected readonly personalProfiles = computed(() =>
    this.store.profiles().filter((profile) => profile.scope === 'personal'),
  );

  /** `null`: no form open; `''`: creating; otherwise the id being edited. */
  protected readonly editing = signal<string | null>(null);
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind: 'success' | 'error' } | null>(null);

  private readonly model = signal<ProfileFormValue>({ ...EMPTY_FORM });
  protected readonly profileForm = form(this.model, (path) => {
    required(path.name, { message: 'กรุณาตั้งชื่อโปรไฟล์' });
    maxLength(path.name, 60, { message: 'ชื่อยาวได้ไม่เกิน 60 ตัวอักษร' });
    maxLength(path.description, 200, { message: 'คำอธิบายยาวได้ไม่เกิน 200 ตัวอักษร' });
    pattern(path.model, /^$|^[A-Za-z0-9][A-Za-z0-9._/:-]{0,159}$/, {
      message: 'ใช้รหัสโมเดลจากแคตตาล็อก เช่น vendor/model หรือเว้นว่างให้ระบบเลือก',
    });
    maxLength(path.instructions, 4000, { message: 'คำสั่งเพิ่มเติมยาวได้ไม่เกิน 4,000 ตัวอักษร' });
  });

  constructor() {
    void this.store.load();
  }

  protected tierLabel(tier: string): string {
    return TIER_LABELS[tier as AiProfileTier] ?? tier;
  }

  protected retry(): void {
    void this.store.load(true);
  }

  protected startCreate(scope: AiProfileScope = 'personal'): void {
    this.model.set({ ...EMPTY_FORM, scope });
    this.profileForm().reset();
    this.status.set(null);
    this.editing.set('');
  }

  protected startEdit(profile: AiProfile): void {
    this.model.set({
      name: profile.name,
      description: profile.description,
      model: profile.model ?? '',
      tier: profile.tier,
      instructions: profile.instructions,
      scope: profile.scope,
    });
    this.profileForm().reset();
    this.status.set(null);
    this.editing.set(profile.id);
  }

  protected cancel(): void {
    this.editing.set(null);
  }

  protected setTier(value: string): void {
    this.model.update((current) => ({ ...current, tier: value as AiProfileTier }));
  }

  protected setScope(value: string): void {
    this.model.update((current) => ({ ...current, scope: value as AiProfileScope }));
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      await submit(this.profileForm, async () => {
        const value = this.model();
        const input: AiProfileInput = {
          name: value.name.trim(),
          description: value.description.trim(),
          model: value.model.trim() || null,
          tier: value.tier,
          instructions: value.instructions,
        };
        const id = this.editing();
        if (id) await this.store.update(id, input);
        else await this.store.create(input, value.scope);
        this.status.set({ text: `บันทึก "${input.name}" แล้ว`, kind: 'success' });
        this.editing.set(null);
        return undefined;
      });
    } catch (error: unknown) {
      this.status.set({
        text: apiErrorMessage(error) ?? 'บันทึกโปรไฟล์ไม่สำเร็จ ลองอีกครั้ง',
        kind: 'error',
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(profile: AiProfile): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirmingDelete.set(null);
    try {
      await this.store.remove(profile.id);
      this.status.set({
        text: `ลบ "${profile.name}" แล้ว บทสนทนาที่ใช้โปรไฟล์นี้กลับไปใช้ค่าเริ่มต้น`,
        kind: 'success',
      });
    } catch (error: unknown) {
      this.status.set({
        text: apiErrorMessage(error) ?? 'ลบโปรไฟล์ไม่สำเร็จ',
        kind: 'error',
      });
    } finally {
      this.busy.set(false);
    }
  }
}

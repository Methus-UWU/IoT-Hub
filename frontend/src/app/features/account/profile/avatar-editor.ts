import { Component, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { AccountAvatarService } from '../../../core/services/account-avatar.service';
import { AccountAvatar } from '../../../shared/components/account-avatar/account-avatar';
import { AvatarCropper } from './avatar-cropper';

@Component({
  selector: 'app-avatar-editor',
  imports: [AccountAvatar, AvatarCropper],
  templateUrl: './avatar-editor.html',
  styleUrl: './profile.page.css',
})
export class AvatarEditor {
  protected readonly avatar = inject(AccountAvatarService);
  readonly initials = input.required<string>();
  protected readonly image = signal<ImageBitmap | null>(null);
  protected readonly preparing = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  private destroyed = false;
  private readonly chooseButton = viewChild<ElementRef<HTMLButtonElement>>('chooseButton');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.discard();
    });
  }

  protected async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.preparing() || this.avatar.busy()) return;
    this.discard();
    this.error.set('');
    this.success.set('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      this.error.set('เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB');
      return;
    }
    await this.prepare(file);
  }

  protected async edit(): Promise<void> {
    const url = this.avatar.url();
    if (!url || this.preparing() || this.avatar.busy()) return;
    this.error.set('');
    this.success.set('');
    this.preparing.set(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Image unavailable');
      await this.prepare(await response.blob());
    } catch {
      this.error.set('เปิดรูปเดิมไม่ได้ กรุณาเลือกรูปใหม่');
    } finally {
      this.preparing.set(false);
    }
  }

  private async prepare(file: Blob): Promise<void> {
    this.preparing.set(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (this.destroyed) {
        bitmap.close();
        return;
      }
      this.discard();
      this.image.set(bitmap);
    } catch {
      this.error.set('เปิดรูปนี้ไม่ได้ กรุณาเลือกไฟล์รูปอื่น');
    } finally {
      this.preparing.set(false);
    }
  }

  protected discard(): void {
    this.image()?.close();
    this.image.set(null);
  }

  protected cancelCrop(): void {
    this.discard();
    this.chooseButton()?.nativeElement.focus();
  }

  protected async save(image: Blob): Promise<void> {
    if (this.destroyed || this.avatar.busy()) return;
    this.error.set('');
    try {
      await this.avatar.save(image);
      this.discard();
      this.success.set('บันทึกรูปโปรไฟล์แล้ว');
      if (!this.destroyed) this.chooseButton()?.nativeElement.focus();
    } catch {
      this.error.set('บันทึกรูปไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  }

  protected async remove(): Promise<void> {
    if (this.avatar.busy()) return;
    this.error.set('');
    this.success.set('');
    try {
      await this.avatar.remove();
      this.discard();
      this.success.set('ลบรูปโปรไฟล์แล้ว');
    } catch {
      this.error.set('ลบรูปไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  }
}

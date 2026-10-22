import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

import type { AdminUser } from '../../../core/models/admin.model';

/**
 * Confirms a permanent account deletion. Opens on the safe choice, because the
 * account's workspaces, projects, and posts go with it and cannot be restored.
 */
@Component({
  selector: 'app-delete-user-dialog',
  host: { '(document:keydown.escape)': 'cancel()' },
  template: `
    <div
      class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-950/40 p-4 backdrop-blur-sm"
      (click)="cancel()"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        aria-describedby="delete-user-detail"
        class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
        (click)="$event.stopPropagation()"
      >
        <h2 id="delete-user-title" class="text-base font-normal text-gray-900">
          ลบบัญชี {{ user().username }}?
        </h2>
        <p id="delete-user-detail" class="mt-2 text-sm text-gray-600">
          บัญชี {{ user().email }} รวมถึงเวิร์กสเปซ โปรเจกต์ โพสต์ และประวัติทั้งหมดจะถูกลบถาวร
          และกู้คืนไม่ได้ ถ้าต้องการหยุดการใช้งานชั่วคราว ให้ใช้ "ระงับ" แทน
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <button
            #cancelButton
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-normal text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
            [disabled]="busy()"
            (click)="cancel()"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-normal text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            [disabled]="busy()"
            (click)="confirmed.emit()"
          >
            {{ busy() ? 'กำลังลบ...' : 'ลบบัญชีถาวร' }}
          </button>
        </div>
      </section>
    </div>
  `,
})
export class DeleteUserDialog {
  readonly user = input.required<AdminUser>();
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());
  }

  protected cancel(): void {
    if (!this.busy()) this.cancelled.emit();
  }
}

import { Component, computed, effect, input, output, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'info';

@Component({
  selector: 'app-toast',
  templateUrl: './toast.html',
  styleUrl: './toast.css',
})
export class Toast {
  readonly message = input.required<string>();
  readonly tone = input<ToastTone>('info');
  readonly duration = input(5000);
  readonly dismissed = output<void>();

  protected readonly leaving = signal(false);
  protected readonly role = computed(() => (this.tone() === 'error' ? 'alert' : 'status'));

  constructor() {
    effect((onCleanup) => {
      this.message();
      this.leaving.set(false);
      let exitTimeout: number | null = null;
      const timeout = window.setTimeout(() => {
        this.leaving.set(true);
        exitTimeout = window.setTimeout(() => this.dismissed.emit(), 180);
      }, this.duration());
      onCleanup(() => {
        window.clearTimeout(timeout);
        if (exitTimeout !== null) {
          window.clearTimeout(exitTimeout);
        }
      });
    });
  }

  protected dismiss(): void {
    this.dismissed.emit();
  }
}

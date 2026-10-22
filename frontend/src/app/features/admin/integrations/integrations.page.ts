import { Component, inject, signal } from '@angular/core';

import { apiErrorMessage } from '../../../core/models/api-error';

import { Toast, ToastTone } from '../../../shared/components/toast/toast';
import { AiCreditsPanel } from './ai-credits-panel';
import { AiModelsPanel } from './ai-models-panel';
import { AiSettings, AiSettingsClient } from './ai-settings.client';
import { IntegrationsSkeleton } from './integrations-skeleton';

@Component({
  selector: 'app-integrations-page',
  imports: [AiCreditsPanel, AiModelsPanel, Toast, IntegrationsSkeleton],
  providers: [AiSettingsClient],
  templateUrl: './integrations.page.html',
  host: { class: 'block' },
})
export class IntegrationsPage {
  private readonly aiApi = inject(AiSettingsClient);
  /** Models and credit defaults, read and written through the admin API. */
  protected readonly aiSettings = signal<AiSettings | null>(null);
  protected readonly aiError = signal<string | null>(null);
  protected readonly aiLoading = signal(true);
  /** Save results, newest last; each toast closes itself or on demand. */
  protected readonly toasts = signal<{ id: number; text: string; tone: ToastTone }[]>([]);
  private nextToastId = 0;

  constructor() {
    void this.loadAiSettings();
  }

  protected async loadAiSettings(): Promise<void> {
    this.aiLoading.set(true);
    this.aiError.set(null);
    try {
      this.aiSettings.set(await this.aiApi.settings());
    } catch (error: unknown) {
      this.aiError.set(apiErrorMessage(error) ?? 'โหลดการตั้งค่า AI ไม่สำเร็จ');
    } finally {
      this.aiLoading.set(false);
    }
  }

  /** A panel saved: show what changed and read the settings back from the server. */
  protected async onSaved(text: string): Promise<void> {
    this.notify(text, 'success');
    await this.loadAiSettings();
  }

  protected notify(text: string, tone: ToastTone): void {
    const id = ++this.nextToastId;
    // Keep the stack short so it never covers the page.
    this.toasts.update((list) => [...list.slice(-2), { id, text, tone }]);
  }

  protected dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }
}

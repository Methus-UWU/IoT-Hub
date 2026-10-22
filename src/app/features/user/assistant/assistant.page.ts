import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { AdvisorMessage, AdvisorMode, IotAdvisorApiService } from './iot-advisor-api.service';

/** Keep the request under the API's 30-message ceiling, newest turns first. */
const MAX_MESSAGES = 30;
const MAX_TEXT = 12_000;

const SUGGESTIONS = [
  {
    label: 'เลือกอุปกรณ์รดน้ำต้นไม้',
    prompt: 'อยากทำระบบรดน้ำต้นไม้อัตโนมัติด้วย ESP32 ต้องใช้อุปกรณ์อะไรบ้าง',
  },
  { label: 'ต่อ DHT22 กับ ESP32', prompt: 'ต่อ DHT22 เข้ากับ ESP32 DevKit V1 ยังไง ขาไหนดี' },
  {
    label: 'เขียนโค้ดอ่านระยะทาง',
    prompt: 'ขอโค้ดตัวอย่างอ่านค่า HC-SR04 บน Arduino Uno ทั้ง Arduino IDE และ PlatformIO',
  },
  { label: 'ใช้รีเลย์กับ ESP32', prompt: 'รีเลย์ 5V ใช้กับ ESP32 ที่เป็น 3.3V ได้ไหม' },
];

/**
 * The IoT advisor: general questions (devices, wiring, example code) and
 * analysis of Arduino IDE / PlatformIO errors, outside any one project.
 *
 * The conversation lives in this page only. Nothing is stored server-side, so a
 * reload starts fresh; that is stated in the UI rather than implied.
 */
@Component({
  selector: 'app-assistant-page',
  imports: [MarkdownPipe],
  templateUrl: './assistant.page.html',
  styleUrl: './assistant.page.css',
})
export class AssistantPage {
  private readonly api = inject(IotAdvisorApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly mode = signal<AdvisorMode>('advice');
  protected readonly messages = signal<readonly AdvisorMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  private pending?: Subscription;

  protected setMode(mode: AdvisorMode): void {
    if (this.mode() === mode || this.sending()) return;
    this.mode.set(mode);
    this.startOver();
  }

  protected startOver(): void {
    this.pending?.unsubscribe();
    this.sending.set(false);
    this.messages.set([]);
    this.error.set(null);
    this.draft.set('');
  }

  protected updateDraft(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onDraftKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.sendDraft();
    }
  }

  protected sendDraft(text = this.draft()): void {
    const content = text.trim();
    if (!content || this.sending()) return;
    this.draft.set('');
    this.send(content.slice(0, MAX_TEXT));
  }

  private send(content: string): void {
    const conversation = [...this.messages(), { role: 'user' as const, content }];
    this.messages.set(conversation);
    this.sending.set(true);
    this.error.set(null);
    this.scrollToEnd();

    this.pending = this.api
      .chat(this.mode(), conversation.slice(-MAX_MESSAGES))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          this.messages.update((messages) => [
            ...messages,
            { role: 'assistant', content: reply.content },
          ]);
          this.sending.set(false);
          this.scrollToEnd();
        },
        error: (err: {
          status?: number;
          error?: { error?: { code?: unknown; message?: unknown } };
        }) => {
          this.sending.set(false);
          // A 429 is our own throttle, the user's AI credits, or the upstream AI
          // provider's quota; only the error code tells them apart.
          const body = err.error?.error;
          this.error.set(
            body?.code === 'AI_CREDIT_LIMIT_REACHED' && typeof body.message === 'string'
              ? body.message
              : body?.code === 'AI_RATE_LIMITED'
                ? 'ผู้ให้บริการ AI จำกัดจำนวนคำขออยู่ในขณะนี้ กรุณาลองใหม่ภายหลัง'
                : err.status === 429
                  ? 'ส่งคำถามถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
                  : 'ผู้ช่วยตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
          );
        },
      });
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const element = this.thread()?.nativeElement;
      element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    });
  }
}

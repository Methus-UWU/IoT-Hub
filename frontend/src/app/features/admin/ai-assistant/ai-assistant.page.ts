import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { AiAssistantStore } from './ai-assistant.store';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';

interface PromptSuggestion {
  label: string;
  prompt: string;
}

const SUGGESTIONS: PromptSuggestion[] = [
  {
    label: 'สรุป error logs วันนี้',
    prompt: 'ช่วยสรุป error logs ของวันนี้ จัดกลุ่มตามสาเหตุ และเรียงสิ่งที่ควรแก้ก่อน',
  },
  {
    label: 'วิเคราะห์ CPU / RAM spike',
    prompt: 'วิเคราะห์สาเหตุที่ CPU และ RAM พุ่งสูง พร้อมเสนอขั้นตอนตรวจสอบทีละข้อ',
  },
  {
    label: 'สรุปกิจกรรมผู้ใช้',
    prompt: 'สรุปกิจกรรมผู้ใช้ในสัปดาห์นี้ และชี้พฤติกรรมที่ผิดปกติถ้ามี',
  },
  {
    label: 'หาโปรเจกต์ใช้ทรัพยากรสูง',
    prompt: 'ช่วยหาโปรเจกต์ที่ใช้ทรัพยากรสูงและแนะนำวิธีลดต้นทุนโดยไม่กระทบผู้ใช้',
  },
];

@Component({
  selector: 'app-ai-assistant-page',
  imports: [DatePipe, MarkdownPipe, ReactiveFormsModule],
  templateUrl: './ai-assistant.page.html',
  styleUrl: './ai-assistant.page.css',
})
export class AiAssistantPage {
  protected readonly store = inject(AiAssistantStore);
  protected readonly promptControl = new FormControl('', { nonNullable: true });
  protected readonly suggestions = SUGGESTIONS;
  protected readonly historyOpen = signal(false);

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  constructor() {
    this.store.loadCatalog();
    effect(() => {
      this.store.messages();
      this.store.sending();
      requestAnimationFrame(() => {
        const element = this.conversation()?.nativeElement;
        element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
      });
    });
  }

  protected submit(): void {
    const prompt = this.promptControl.value;
    if (!prompt.trim() || this.store.sending()) return;
    this.promptControl.setValue('');
    this.store.send(prompt);
  }

  protected stopGeneration(): void {
    this.store.stopGeneration();
  }

  protected useSuggestion(prompt: string): void {
    if (this.store.sending()) return;
    this.store.send(prompt);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.submit();
  }

  protected toggleHistory(): void {
    this.historyOpen.update((open) => !open);
  }

  protected closeHistory(): void {
    this.historyOpen.set(false);
  }

  protected startNewChat(): void {
    this.store.clearConversation();
    this.closeHistory();
  }

  protected openConversation(id: string): void {
    this.store.openConversation(id);
    this.closeHistory();
  }

  protected deleteConversation(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.store.deleteConversation(id);
  }
}

import { Component } from '@angular/core';

@Component({
  selector: 'app-ai-assistant-avatar',
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="16" height="13" rx="5" />
      <path d="M12 4v3M2 12v3m20-3v3M9 16h6" />
      <circle cx="12" cy="3" r="1" class="eye" />
      <circle cx="9" cy="12" r="1.25" class="eye" />
      <circle cx="15" cy="12" r="1.25" class="eye" />
    </svg>
  `,
  styles: `
    :host {
      display: grid;
      width: 2rem;
      height: 2rem;
      flex: none;
      place-items: center;
      border: 1px solid var(--color-indigo-200);
      border-radius: 0.65rem;
      color: var(--color-indigo-700);
      background: var(--color-indigo-50);
    }
    svg {
      width: 1.25rem;
      height: 1.25rem;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .eye { fill: currentColor; stroke: none; }
  `,
})
export class AiAssistantAvatar {}

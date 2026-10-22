import { Component, input } from '@angular/core';

@Component({
  selector: 'app-field-error',
  host: { class: 'flex items-center gap-1.5 text-error' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <p class="text-[11px] font-medium">{{ message() }}</p>
  `
})
export class FieldError {
  readonly message = input.required<string>();
}

import { Component, input } from '@angular/core';

@Component({
  selector: 'app-field-error',
  host: { class: 'flex items-center gap-1.5 text-error' },
  template: `
    <span class="material-symbols-outlined text-[16px]!" aria-hidden="true">error</span>
    <p class="text-[11px] font-medium">{{ message() }}</p>
  `
})
export class FieldError {
  readonly message = input.required<string>();
}

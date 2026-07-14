import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

export interface DropdownOption<T = string> {
  value: T;
  label: string;
}

export type DropdownVariant = 'pill' | 'field';
export type DropdownTheme = 'light' | 'dark';

let nextDropdownId = 0;

@Component({
  selector: 'app-dropdown',
  host: {
    class: 'relative',
    '[class.inline-block]': "variant() === 'pill'",
    '[class.block]': "variant() === 'field'",
    '[class.w-full]': "variant() === 'field'",
    '(document:click)': 'onDocumentClick($event)'
  },
  template: `
    @if (variant() === 'field') {
      <div class="relative">
        @if (icon(); as iconName) {
          <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400" aria-hidden="true">
            <span class="material-symbols-outlined text-[20px]!">{{ iconName }}</span>
          </span>
        }
        <button
          type="button"
          [id]="triggerId"
          [class]="fieldTriggerClass()"
          [attr.aria-expanded]="open()"
          aria-haspopup="listbox"
          [attr.aria-controls]="listboxId"
          [attr.aria-activedescendant]="open() ? activeOptionId() : null"
          [attr.aria-label]="label()"
          (click)="toggle()"
          (keydown)="onTriggerKeydown($event)"
        >
          <span class="truncate" [class.text-slate-400]="!selectedOption()">{{ selectedOption()?.label ?? placeholder() }}</span>
        </button>
        <span
          class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 transition-transform duration-150"
          [class.rotate-180]="open()"
          aria-hidden="true"
        >
          <span class="material-symbols-outlined text-[20px]!">expand_more</span>
        </span>
      </div>
    } @else {
      <button
        type="button"
        [id]="triggerId"
        class="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-3.5 pr-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="open() ? activeOptionId() : null"
        [attr.aria-label]="label()"
        (click)="toggle()"
        (keydown)="onTriggerKeydown($event)"
      >
        <span class="truncate">{{ selectedOption()?.label ?? placeholder() }}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150"
          [class.rotate-180]="open()"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    }

    @if (open()) {
      <ul [id]="listboxId" role="listbox" [attr.aria-label]="label()" [class]="panelClass()">
        @for (option of options(); track option.value; let i = $index) {
          <li
            [id]="optionId(i)"
            role="option"
            [attr.aria-selected]="option.value === value()"
            [class]="optionClass(i)"
            (click)="select(option)"
            (mouseenter)="activeIndex.set(i)"
          >
            <span class="truncate">{{ option.label }}</span>
            @if (option.value === value()) {
              <svg viewBox="0 0 24 24" fill="none" class="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true">
                <path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            }
          </li>
        }
      </ul>
    }
  `
})
export class Dropdown<T = string> {
  readonly options = input.required<readonly DropdownOption<T>[]>();
  readonly value = input<T | null>(null);
  readonly label = input<string>('');
  readonly placeholder = input<string>('Select…');
  readonly variant = input<DropdownVariant>('pill');
  readonly theme = input<DropdownTheme>('light');
  readonly icon = input<string | null>(null);
  readonly valueChange = output<T>();

  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);

  protected readonly selectedOption = computed(() => this.options().find((option) => option.value === this.value()) ?? null);
  protected readonly activeOptionId = computed(() => (this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null));

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly instanceId = `app-dropdown-${nextDropdownId++}`;
  protected readonly triggerId = `${this.instanceId}-trigger`;
  protected readonly listboxId = `${this.instanceId}-listbox`;

  protected optionId(index: number): string {
    return `${this.instanceId}-option-${index}`;
  }

  protected fieldTriggerClass(): string {
    const base = 'flex h-11 w-full items-center rounded-lg border pr-10 text-sm outline-none transition-all';
    const padding = this.icon() ? 'pl-10' : 'pl-4';
    const theme =
      this.theme() === 'dark'
        ? 'border-slate-700 bg-slate-800 text-white focus:border-primary focus:ring-2 focus:ring-primary/20'
        : 'border-slate-200 bg-white text-slate-900 focus:border-primary focus:ring-2 focus:ring-primary/20';
    return `${base} ${padding} ${theme}`;
  }

  protected panelClass(): string {
    const base = 'absolute left-0 z-20 mt-1.5 min-w-full overflow-hidden rounded-xl border py-1 shadow-lg';
    return this.theme() === 'dark' ? `${base} border-slate-700 bg-slate-800 shadow-black/30` : `${base} border-slate-200 bg-white shadow-slate-900/10`;
  }

  protected optionClass(index: number): string {
    const base = 'flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors';
    const theme = this.theme() === 'dark' ? 'text-slate-200' : 'text-slate-700';
    const active = index === this.activeIndex() ? (this.theme() === 'dark' ? 'bg-slate-700' : 'bg-slate-50') : '';
    return `${base} ${theme} ${active}`;
  }

  protected toggle(): void {
    this.open.update((isOpen) => !isOpen);
    if (this.open()) {
      const index = this.options().findIndex((option) => option.value === this.value());
      this.activeIndex.set(index >= 0 ? index : 0);
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  protected select(option: DropdownOption<T>): void {
    this.valueChange.emit(option.value);
    this.close();
  }

  protected onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    const options = this.options();
    if (!options.length) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) {
          this.toggle();
          return;
        }
        this.activeIndex.update((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) {
          this.toggle();
          return;
        }
        this.activeIndex.update((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Home':
        if (this.open()) {
          event.preventDefault();
          this.activeIndex.set(0);
        }
        break;
      case 'End':
        if (this.open()) {
          event.preventDefault();
          this.activeIndex.set(options.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        if (this.open()) {
          event.preventDefault();
          const active = options[this.activeIndex()];
          if (active) this.select(active);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }
}

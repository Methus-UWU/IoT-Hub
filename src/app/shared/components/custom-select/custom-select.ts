import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

let nextSelectId = 0;

interface SelectMenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

@Component({
  selector: 'app-custom-select',
  templateUrl: './custom-select.html',
  styleUrl: './custom-select.css',
  host: {
    class: 'relative block min-w-0',
    '(document:click)': 'handleDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
    '(keydown)': 'handleKeydown($event)',
    '(focusout)': 'handleFocusout($event)',
    '(window:resize)': 'close()',
  },
})
export class CustomSelect {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly searchTrigger = viewChild<ElementRef<HTMLInputElement>>('searchTrigger');
  private readonly selectId = `custom-select-${nextSelectId++}`;
  private triggerPosition: { top: number; left: number } | null = null;

  readonly options = input.required<readonly CustomSelectOption[]>();
  readonly value = input('');
  readonly placeholder = input('เลือกตัวเลือก');
  readonly ariaLabel = input('เลือกตัวเลือก');
  readonly disabled = input(false);
  readonly compact = input(false);
  readonly dense = input(false);
  readonly menuWidth = input(0);
  readonly textWeight = input<'normal' | 'medium'>('medium');
  readonly closeRequest = input(0);
  readonly searchable = input(false);
  readonly selectedLabel = input<string>();
  readonly emptyText = input('ไม่พบตัวเลือกที่ตรงกัน');
  readonly valueChange = output<string>();
  readonly openChange = output<boolean>();

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly visibleOptions = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return this.searchable() && query
      ? this.options().filter((option) =>
          `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(query),
        )
      : this.options();
  });
  protected readonly displayLabel = computed(
    () => this.selectedLabel() ?? this.selectedOption()?.label ?? '',
  );
  protected readonly activeIndex = signal(0);
  protected readonly menuPosition = signal<SelectMenuPosition>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 272,
  });
  protected readonly menuId = `${this.selectId}-menu`;

  protected readonly activeOptionId = computed(() =>
    this.open() && this.visibleOptions()[this.activeIndex()]
      ? `${this.menuId}-option-${this.activeIndex()}`
      : null,
  );

  protected readonly selectedOption = computed(() =>
    this.options().find((option) => option.value === this.value()),
  );

  constructor() {
    effect(() => {
      this.closeRequest();
      untracked(() => this.close());
    });

    const closeOnParentScroll = (event: Event) => {
      if (
        this.open() &&
        event.target instanceof Node &&
        !this.elementRef.nativeElement.contains(event.target)
      ) {
        const rect = (
          this.searchTrigger() ?? this.trigger()
        )?.nativeElement.getBoundingClientRect();
        // Focus can queue a scroll event before the menu opens. Only close when
        // the anchor actually moved after its position was captured.
        if (
          !rect ||
          rect.top !== this.triggerPosition?.top ||
          rect.left !== this.triggerPosition?.left
        ) {
          this.close();
        }
      }
    };
    document.addEventListener('scroll', closeOnParentScroll, true);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('scroll', closeOnParentScroll, true),
    );
  }

  protected toggle(): void {
    if (this.disabled()) {
      return;
    }
    if (this.open()) {
      this.close();
      return;
    }
    this.openMenu();
  }

  protected select(option: CustomSelectOption): void {
    if (option.disabled) {
      return;
    }
    this.valueChange.emit(option.value);
    this.close();
    (this.searchTrigger() ?? this.trigger())?.nativeElement.focus();
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.query.set('');
    this.openChange.emit(false);
  }

  protected setActiveIndex(index: number): void {
    this.activeIndex.set(index);
  }

  protected handleDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  protected handleFocusout(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !this.elementRef.nativeElement.contains(nextTarget)) {
      this.close();
    }
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (this.disabled()) {
      return;
    }

    if (event.isComposing) return;
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (this.open() && (event.key === 'Enter' || (!this.searchable() && event.key === ' '))) {
      event.preventDefault();
      const option = this.visibleOptions()[this.activeIndex()];
      if (option) this.select(option);
      return;
    }

    if (!this.searchable() && this.open() && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      const enabledOptions = this.visibleOptions()
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => !option.disabled);
      const option = event.key === 'Home' ? enabledOptions[0] : enabledOptions.at(-1);
      if (option) this.activeIndex.set(option.index);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    if (!this.open()) {
      this.openMenu();
      return;
    }

    const enabledOptions = this.visibleOptions()
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled);
    const currentPosition = enabledOptions.findIndex(({ index }) => index === this.activeIndex());

    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextPosition =
      (Math.max(0, currentPosition) + direction + enabledOptions.length) % enabledOptions.length;
    const nextOption = enabledOptions[nextPosition];
    if (nextOption) {
      this.activeIndex.set(nextOption.index);
      document
        .getElementById(`${this.menuId}-option-${nextOption.index}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  protected search(value: string): void {
    if (!this.open()) this.openMenu();
    this.query.set(value);
    this.activeIndex.set(
      Math.max(
        0,
        this.visibleOptions().findIndex((option) => !option.disabled),
      ),
    );
  }

  protected openMenu(): void {
    if (this.disabled() || this.open()) return;
    const trigger = (this.searchTrigger() ?? this.trigger())?.nativeElement;
    if (!trigger) return;

    const selectedIndex = this.options().findIndex((option) => option.value === this.value());
    this.activeIndex.set(Math.max(0, selectedIndex));
    const rect = trigger.getBoundingClientRect();
    this.triggerPosition = { top: rect.top, left: rect.left };
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const maxMenuHeight = 272;
    const estimatedHeight = this.searchable()
      ? maxMenuHeight
      : Math.min(this.options().length * 58 + 12, maxMenuHeight);
    const spaceBelow = viewportHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < Math.min(estimatedHeight, 160) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(96, openAbove ? spaceAbove : spaceBelow);
    const menuHeight = Math.min(estimatedHeight, maxMenuHeight, availableHeight);
    const top = openAbove ? Math.max(6, rect.top - menuHeight - 6) : rect.bottom + 6;
    const width = Math.min(Math.max(rect.width, this.menuWidth()), viewportWidth - 12);
    const left = Math.min(Math.max(6, rect.left), viewportWidth - width - 6);

    this.menuPosition.set({ top, left, width, maxHeight: menuHeight });
    this.open.set(true);
    this.openChange.emit(true);
  }
}

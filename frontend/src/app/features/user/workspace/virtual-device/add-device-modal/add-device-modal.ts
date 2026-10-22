import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { DeviceThumbnail } from '../device-thumbnail';
import {
  DEVICE_CATEGORY_OPTIONS,
  DeviceCategoryId,
  DeviceKind,
  DeviceLibraryItem,
} from '../device-library.models';

type QuickFilterId = 'all' | 'popular' | 'favorites' | 'recently-used';
type CategoryFilterId = 'all' | DeviceCategoryId;

interface LibraryFilterOption {
  id: QuickFilterId;
  label: string;
}

interface CategoryFilterOption {
  id: CategoryFilterId;
  label: string;
  count: number;
}

const QUICK_FILTERS: readonly LibraryFilterOption[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'popular', label: 'ยอดนิยม' },
  { id: 'favorites', label: 'รายการโปรด' },
  { id: 'recently-used', label: 'ใช้ล่าสุด' },
];

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled):not([tabindex="-1"])',
  'input:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function deviceMatchesSearch(device: DeviceLibraryItem, query: string): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchValue(
    [device.name, device.model, device.category, ...device.aliases, ...device.tags].join(' '),
  );
  const compactHaystack = haystack.replaceAll(' ', '');

  return normalizedQuery.split(/\s+/).every((term) => {
    const compactTerm = term.replaceAll(' ', '');
    return haystack.includes(term) || compactHaystack.includes(compactTerm);
  });
}

/**
 * Centred device picker. A card click immediately hands one exact catalog part
 * back to the canvas for placement; the modal never keeps a second selection
 * state that can drift from what the user is about to place.
 */
@Component({
  selector: 'app-add-device-modal',
  imports: [DeviceThumbnail],
  templateUrl: './add-device-modal.html',
  styleUrl: './add-device-modal.css',
})
export class AddDeviceModal {
  readonly devices = input.required<readonly DeviceLibraryItem[]>();
  readonly favoriteIds = input.required<readonly DeviceKind[]>();
  readonly recentIds = input.required<readonly DeviceKind[]>();

  readonly closed = output<void>();
  readonly devicesAdded = output<readonly DeviceKind[]>();
  readonly favoriteToggled = output<DeviceKind>();

  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly returnFocusElement = this.document.activeElement;
  private readonly favoriteIdSet = computed(() => new Set(this.favoriteIds()));
  private readonly recentIdSet = computed(() => new Set(this.recentIds()));

  protected readonly query = signal('');
  protected readonly activeFilter = signal<QuickFilterId>('all');
  protected readonly activeCategory = signal<CategoryFilterId>('all');
  protected readonly focusedId = signal<DeviceKind | null>(null);
  protected readonly quickFilters = QUICK_FILTERS;

  private readonly searchMatches = computed(() => {
    const query = this.query();
    return this.devices().filter((device) => deviceMatchesSearch(device, query));
  });

  protected readonly visibleDevices = computed(() => {
    const filter = this.activeFilter();
    const category = this.activeCategory();
    const favorites = this.favoriteIdSet();
    const recents = this.recentIdSet();
    const matches = this.searchMatches().filter((device) => {
      const matchesQuickFilter =
        filter === 'all' ||
        (filter === 'popular' && device.popularity > 0) ||
        (filter === 'favorites' && favorites.has(device.id)) ||
        (filter === 'recently-used' && recents.has(device.id));
      return matchesQuickFilter && (category === 'all' || device.categoryId === category);
    });

    // Both ranked filters re-sort; every other view keeps catalog order.
    if (filter === 'popular') {
      return [...matches].sort((left, right) => right.popularity - left.popularity);
    }
    if (filter !== 'recently-used') return matches;

    const recentOrder = new Map(this.recentIds().map((id, index) => [id, index]));
    return [...matches].sort(
      (left, right) =>
        (recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  });

  protected readonly focusedDevice = computed(() => {
    const devices = this.visibleDevices();
    return devices.find((device) => device.id === this.focusedId()) ?? devices[0] ?? null;
  });

  protected readonly resultAnnouncement = computed(() => {
    const count = this.visibleDevices().length;
    const query = this.query().trim();
    return query ? `พบ ${count} อุปกรณ์สำหรับ “${query}”` : `${count} อุปกรณ์`;
  });

  protected readonly filterCounts = computed(() => {
    const matches = this.searchMatches();
    const category = this.activeCategory();
    const favorites = this.favoriteIdSet();
    const recents = this.recentIdSet();
    const counts = new Map<QuickFilterId, number>();

    for (const filter of this.quickFilters) {
      const count = matches.filter((device) => {
        if (category !== 'all' && device.categoryId !== category) return false;
        if (filter.id === 'popular') return device.popularity > 0;
        if (filter.id === 'favorites') return favorites.has(device.id);
        if (filter.id === 'recently-used') return recents.has(device.id);
        return true;
      }).length;
      counts.set(filter.id, count);
    }

    return counts;
  });

  protected readonly categoryFilters = computed<readonly CategoryFilterOption[]>(() => {
    const filter = this.activeFilter();
    const favorites = this.favoriteIdSet();
    const recents = this.recentIdSet();
    const matches = this.searchMatches().filter(
      (device) =>
        filter === 'all' ||
        (filter === 'popular' && device.popularity > 0) ||
        (filter === 'favorites' && favorites.has(device.id)) ||
        (filter === 'recently-used' && recents.has(device.id)),
    );
    const counts = new Map<DeviceCategoryId, number>();
    for (const device of matches) {
      counts.set(device.categoryId, (counts.get(device.categoryId) ?? 0) + 1);
    }

    return [
      { id: 'all', label: 'ทุกประเภท', count: matches.length },
      ...DEVICE_CATEGORY_OPTIONS.flatMap((category) => {
        const count = counts.get(category.id) ?? 0;
        return count ? [{ id: category.id, label: category.label, count }] : [];
      }),
    ];
  });

  protected readonly emptyMessage = computed(() => {
    if (this.query().trim()) return 'ลองใช้คำค้นอื่น หรือล้างตัวกรองปัจจุบัน';
    if (this.activeFilter() === 'popular')
      return 'ไม่มีอุปกรณ์ยอดนิยมในหมวดหมู่นี้ ลองเลือกหมวดหมู่อื่น';
    if (this.activeFilter() === 'favorites')
      return 'เพิ่มอุปกรณ์เป็นรายการโปรดเพื่อเรียกใช้ได้เร็วขึ้น';
    if (this.activeFilter() === 'recently-used') {
      return 'อุปกรณ์ที่เพิ่มจะปรากฏที่นี่เพื่อให้เลือกใช้ได้อย่างรวดเร็ว';
    }
    return 'เลือกหมวดหมู่อื่นเพื่อดูอุปกรณ์เพิ่มเติม';
  });

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus());
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.query.set('');
    this.searchInput()?.nativeElement.focus();
  }

  protected resetLibrary(): void {
    this.query.set('');
    this.activeFilter.set('all');
    this.activeCategory.set('all');
    this.searchInput()?.nativeElement.focus();
  }

  protected selectFilter(filter: QuickFilterId): void {
    this.activeFilter.set(filter);
  }

  protected selectCategory(category: CategoryFilterId): void {
    this.activeCategory.set(category);
  }

  protected focusDevice(id: DeviceKind): void {
    this.focusedId.set(id);
  }

  protected chooseDevice(id: DeviceKind): void {
    if (!this.devices().some((candidate) => candidate.id === id)) return;
    this.devicesAdded.emit([id]);
  }

  protected isFavorite(id: DeviceKind): boolean {
    return this.favoriteIdSet().has(id);
  }

  protected toggleFavorite(event: MouseEvent, id: DeviceKind): void {
    event.stopPropagation();
    const shouldRestoreGridFocus = this.activeFilter() === 'favorites' && this.isFavorite(id);
    this.favoriteToggled.emit(id);
    if (shouldRestoreGridFocus) {
      afterNextRender(
        () => {
          const selectedId = this.focusedDevice()?.id;
          const nextCard = selectedId
            ? this.dialog()?.nativeElement.querySelector<HTMLButtonElement>(
                `[data-device-card="${selectedId}"]`,
              )
            : null;
          (nextCard ?? this.searchInput()?.nativeElement)?.focus();
        },
        { injector: this.injector },
      );
    }
  }

  protected closeDialog(): void {
    this.closed.emit();
    queueMicrotask(() => {
      if (this.returnFocusElement instanceof HTMLElement) this.returnFocusElement.focus();
    });
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    if (event.target === event.currentTarget) this.closeDialog();
  }

  protected onGridKeydown(event: KeyboardEvent, id: DeviceKind): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.chooseDevice(id);
      return;
    }

    const cardButtons = this.gridCardButtons();
    if (!cardButtons.length) return;

    const currentIndex = Math.max(
      0,
      cardButtons.findIndex((button) => button.dataset['deviceCard'] === id),
    );
    let nextIndex = currentIndex;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = Math.min(currentIndex + 1, cardButtons.length - 1);
        break;
      case 'ArrowLeft':
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case 'ArrowDown':
        nextIndex = this.findVerticalGridTarget(cardButtons, currentIndex, 1);
        break;
      case 'ArrowUp':
        nextIndex = this.findVerticalGridTarget(cardButtons, currentIndex, -1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = cardButtons.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextButton = cardButtons[nextIndex];
    const nextId = nextButton?.dataset['deviceCard'];
    if (nextId) this.focusDevice(nextId);
    nextButton?.focus();
  }

  protected onDialogKeydown(event: KeyboardEvent): void {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeDialog();
      return;
    }

    if (event.key === 'Tab') {
      this.trapFocus(event);
      return;
    }

    if (event.key === 'Enter' && event.target === this.searchInput()?.nativeElement) {
      const focused = this.focusedDevice();
      if (focused) {
        event.preventDefault();
        this.chooseDevice(focused.id);
      }
    }
  }

  private gridCardButtons(): HTMLButtonElement[] {
    return Array.from(
      this.dialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('[data-device-card]') ?? [],
    ).filter((button) => !button.disabled);
  }

  private findVerticalGridTarget(
    buttons: readonly HTMLButtonElement[],
    currentIndex: number,
    direction: -1 | 1,
  ): number {
    const currentRect = buttons[currentIndex]?.getBoundingClientRect();
    if (!currentRect) return currentIndex;

    const candidates = buttons
      .map((button, index) => ({ index, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) =>
        direction === 1 ? rect.top > currentRect.top + 2 : rect.top < currentRect.top - 2,
      );
    if (!candidates.length) return currentIndex;

    const nearestRowTop =
      direction === 1
        ? Math.min(...candidates.map(({ rect }) => rect.top))
        : Math.max(...candidates.map(({ rect }) => rect.top));
    const currentCenter = currentRect.left + currentRect.width / 2;

    return (
      candidates
        .filter(({ rect }) => Math.abs(rect.top - nearestRowTop) < 3)
        .sort((left, right) => {
          const leftCenter = left.rect.left + left.rect.width / 2;
          const rightCenter = right.rect.left + right.rect.width / 2;
          return Math.abs(leftCenter - currentCenter) - Math.abs(rightCenter - currentCenter);
        })[0]?.index ?? currentIndex
    );
  }

  private trapFocus(event: KeyboardEvent): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.getClientRects().length > 0);
    if (!focusableElements.length) return;

    const first = focusableElements[0];
    const last = focusableElements.at(-1);
    const activeElement = this.document.activeElement;

    if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

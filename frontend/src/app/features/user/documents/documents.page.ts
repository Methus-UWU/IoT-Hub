import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { RecentSearches } from '../../../shared/components/recent-searches/recent-searches';
import { DeviceToolchain } from './device-toolchain';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { ARTICLES, CATEGORY_LABELS, DocumentCategory, KnowledgeArticle } from './documents.catalog';
import { DEVICE_CATEGORY_FILTERS, DEVICE_REFERENCES, DeviceReference } from './device-reference';
import type { DeviceCategoryId } from '../workspace/virtual-device/device-library.models';
import { DeviceThumbnail } from '../workspace/virtual-device/device-thumbnail';
import { DeviceComparison } from './device-comparison';
import { NgOptimizedImage } from '@angular/common';
import { WiringGallery } from './wiring/wiring-gallery';

type DocumentTab = 'guides' | 'devices';

@Component({
  selector: 'app-documents-page',
  templateUrl: './documents.page.html',
  styleUrls: ['./documents.page.css', './documents.comparison.css'],
  imports: [
    MarkdownPipe,
    DeviceThumbnail,
    DeviceComparison,
    RecentSearches,
    DeviceToolchain,
    NgOptimizedImage,
    WiringGallery,
  ],
  host: {
    '(document:keydown.escape)': 'closeReader()',
  },
})
export class DocumentsPage {
  private readonly searchHistory = inject(SearchHistoryService);
  private readonly articleClose = viewChild<ElementRef<HTMLButtonElement>>('articleClose');
  private readonly deviceClose = viewChild<ElementRef<HTMLButtonElement>>('deviceClose');

  /** The card that opened the reader, so focus can return to it on close. */
  private readonly openedFrom = signal<HTMLElement | null>(null);
  private readonly needsReaderFocus = signal(false);

  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly tab = signal<DocumentTab>('guides');
  protected readonly query = signal('');

  protected readonly categories: readonly {
    value: DocumentCategory;
    label: string;
    count: number;
  }[] = (Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((value) => ({
    value,
    label: CATEGORY_LABELS[value],
    count: value === 'all' ? ARTICLES.length : ARTICLES.filter((a) => a.category === value).length,
  }));
  protected readonly category = signal<DocumentCategory>('all');
  protected readonly selectedArticle = signal<KnowledgeArticle | null>(null);

  /**
   * Flipped on every category click. The grid swaps its cards between two
   * identically defined keyframes on this flag, and a changed animation name is
   * what makes a browser replay the entrance on cards that stayed on screen —
   * "all" and "microcontrollers" both open on the same boards, so re-rendering
   * alone would leave them still.
   */
  protected readonly replay = signal(false);

  protected readonly deviceCategories = DEVICE_CATEGORY_FILTERS;
  protected readonly deviceCategory = signal<DeviceCategoryId | 'all'>('all');
  protected readonly selectedDevice = signal<DeviceReference | null>(null);
  protected readonly comparisonLimit = 4;
  protected readonly comparisonDevices = signal<readonly DeviceReference[]>([]);
  protected readonly comparisonIds = computed(
    () => new Set(this.comparisonDevices().map((device) => device.id)),
  );
  protected readonly comparisonFull = computed(
    () => this.comparisonDevices().length >= this.comparisonLimit,
  );

  protected readonly articles = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const category = this.category();
    return ARTICLES.filter((article) => category === 'all' || article.category === category).filter(
      (article) =>
        !query ||
        article.title.toLocaleLowerCase().includes(query) ||
        article.description.toLocaleLowerCase().includes(query),
    );
  });

  protected readonly devices = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const category = this.deviceCategory();
    return DEVICE_REFERENCES.filter(
      (device) => category === 'all' || device.categoryId === category,
    ).filter((device) => !query || device.searchText.includes(query));
  });

  protected readonly resultCount = computed(() =>
    this.tab() === 'guides' ? this.articles().length : this.devices().length,
  );

  constructor() {
    // The reader is a modal dialog, so focus has to move into it once it exists.
    // Guarded by a one-shot flag rather than run on every pass, or the effect would
    // pull focus back out of the body while the user reads it.
    afterRenderEffect(() => {
      if (!this.needsReaderFocus()) return;
      const close = this.articleClose()?.nativeElement ?? this.deviceClose()?.nativeElement;
      if (!close) return;
      close.focus();
      this.needsReaderFocus.set(false);
    });
  }

  protected setTab(tab: DocumentTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    // A guide query means nothing to the device list; carrying it across would land
    // the user on an empty tab.
    this.query.set('');
    this.closeReader();
  }

  protected updateQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.searchHistory.remember('documents', value);
  }

  protected pickRecentSearch(query: string): void {
    this.query.set(query);
  }

  protected setCategory(category: DocumentCategory): void {
    this.category.set(category);
    this.replay.update((value) => !value);
  }

  protected setDeviceCategory(category: DeviceCategoryId | 'all'): void {
    this.deviceCategory.set(category);
    this.replay.update((value) => !value);
  }

  protected openArticle(article: KnowledgeArticle, event: Event): void {
    this.openReader(event);
    this.selectedArticle.set(article);
  }

  protected openDevice(device: DeviceReference, event: Event): void {
    this.openReader(event);
    this.selectedDevice.set(device);
  }

  protected toggleComparison(device: DeviceReference): void {
    if (this.comparisonIds().has(device.id)) {
      this.removeComparison(device.id);
    } else if (!this.comparisonFull()) {
      this.comparisonDevices.update((devices) => [...devices, device]);
    }
  }

  protected removeComparison(id: string): void {
    this.comparisonDevices.update((devices) => devices.filter((device) => device.id !== id));
  }

  protected closeReader(): void {
    if (!this.selectedArticle() && !this.selectedDevice()) return;
    this.selectedArticle.set(null);
    this.selectedDevice.set(null);
    this.needsReaderFocus.set(false);
    // A filter change while the reader was open can remove the card entirely.
    const trigger = this.openedFrom();
    this.openedFrom.set(null);
    if (trigger?.isConnected) trigger.focus();
  }

  private openReader(event: Event): void {
    this.openedFrom.set(event.currentTarget as HTMLElement);
    this.needsReaderFocus.set(true);
  }
}

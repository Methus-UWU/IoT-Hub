import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { apiErrorMessage } from '../../../core/models/api-error';
import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { AiSettings, AiSettingsClient, CatalogOption } from './ai-settings.client';

export const MAX_FALLBACKS = 5;

/**
 * The assistants' primary model and its ordered fallbacks. OpenRouter tries them in
 * order when one is down or rate limited. Leaving the primary empty hands the choice
 * back to the environment pins and the ranked catalog.
 */
@Component({
  selector: 'app-ai-models-panel',
  imports: [CustomSelect],
  templateUrl: './ai-models-panel.html',
  host: { class: 'block' },
})
export class AiModelsPanel {
  private readonly api = inject(AiSettingsClient);

  readonly settings = input.required<AiSettings>();
  readonly saved = output<string>();
  readonly failed = output<string>();

  protected readonly maxFallbacks = MAX_FALLBACKS;
  protected readonly priceFilter = signal('all');
  protected readonly sort = signal('name');
  protected readonly priceOptions: CustomSelectOption[] = [
    { value: 'all', label: 'ทุกราคา' },
    { value: 'free', label: 'เฉพาะโมเดลฟรี' },
    { value: 'paid', label: 'มีค่าใช้จ่าย' },
  ];
  protected readonly sortOptions = computed<CustomSelectOption[]>(() => [
    { value: 'name', label: 'ชื่อโมเดล A–Z' },
    { value: 'price-asc', label: 'ราคา: น้อยไปมาก' },
    { value: 'price-desc', label: 'ราคา: มากไปน้อย' },
    {
      value: 'latency-asc',
      label: 'Latency: น้อยไปมาก',
      disabled: !this.settings().catalog.latencyOrder?.length,
    },
    {
      value: 'latency-desc',
      label: 'Latency: มากไปน้อย',
      disabled: !this.settings().catalog.latencyOrder?.length,
    },
  ]);
  protected readonly primary = signal<string>('');
  protected readonly fallbacks = signal<string[]>([]);
  protected readonly candidate = signal('');
  protected readonly saving = signal(false);

  /** Filters affect discovery, never the saved selection or fallback priority. */
  protected readonly options = computed(() => {
    const models = this.settings().catalog.models.filter(
      (model) =>
        this.priceFilter() === 'all' ||
        (this.priceFilter() === 'free' ? model.isFree : !model.isFree),
    );
    const ranks = new Map(
      (this.settings().catalog.latencyOrder ?? []).map((id, index) => [id, index]),
    );
    const order = this.sort();
    return models.sort((a, b) => {
      if (order.startsWith('latency')) {
        const first = ranks.get(a.id);
        const second = ranks.get(b.id);
        if (first === undefined || second === undefined) {
          return first === second ? a.id.localeCompare(b.id) : first === undefined ? 1 : -1;
        }
        return (first - second) * (order === 'latency-asc' ? 1 : -1);
      }
      if (order.startsWith('price')) {
        const first = combinedPrice(a);
        const second = combinedPrice(b);
        if (first === null || second === null) {
          return first === second ? a.id.localeCompare(b.id) : first === null ? 1 : -1;
        }
        return (first - second) * (order === 'price-asc' ? 1 : -1) || a.id.localeCompare(b.id);
      }
      return a.id.localeCompare(b.id);
    });
  });
  protected readonly primaryOptions = computed<CustomSelectOption[]>(() => [
    { value: '', label: 'ให้ระบบเลือกโมเดลอัตโนมัติ', description: 'เลือกจากโมเดลที่พร้อมใช้งาน' },
    ...this.options().map(toOption),
  ]);
  protected readonly fallbackOptions = computed(() =>
    this.options()
      .filter((model) => model.id !== this.primary() && !this.fallbacks().includes(model.id))
      .map(toOption),
  );
  protected readonly primaryLabel = computed(() =>
    this.primary()
      ? (this.settings().catalog.models.find((model) => model.id === this.primary())?.name ??
        this.primary())
      : 'ให้ระบบเลือกโมเดลอัตโนมัติ',
  );
  protected readonly dirty = computed(() => {
    const settings = this.settings();
    return (
      (settings.primaryModel ?? '') !== this.primary() ||
      settings.fallbackModels.join() !== this.fallbacks().join()
    );
  });

  /** Re-seeds the form whenever fresh settings arrive from the server. */
  private readonly seed = effect(() => {
    this.settings();
    untracked(() => this.reset());
  });

  protected reset(): void {
    const settings = this.settings();
    this.primary.set(settings.primaryModel ?? '');
    this.fallbacks.set([...settings.fallbackModels]);
    this.candidate.set('');
  }

  protected label(id: string): string {
    const model = this.settings().catalog.models.find((entry) => entry.id === id);
    return model ? describe(model) : `${id} (ไม่อยู่ในแคตตาล็อกตอนนี้)`;
  }

  protected setPrimary(id: string): void {
    this.primary.set(id);
    this.candidate.set('');
    // A model cannot be its own fallback.
    this.fallbacks.update((list) => list.filter((entry) => entry !== id));
    if (!id) this.fallbacks.set([]);
  }

  protected addFallback(): void {
    const id = this.candidate();
    if (!id || id === this.primary() || this.fallbacks().includes(id)) return;
    if (this.fallbacks().length >= MAX_FALLBACKS) return;
    this.fallbacks.update((list) => [...list, id]);
    this.candidate.set('');
  }

  protected removeFallback(index: number): void {
    this.fallbacks.update((list) => list.filter((_, position) => position !== index));
  }

  protected moveFallback(index: number, offset: -1 | 1): void {
    this.fallbacks.update((list) => {
      const target = index + offset;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const primaryModel = this.primary() || null;
      await this.api.update({
        primaryModel,
        fallbackModels: primaryModel ? this.fallbacks() : [],
      });
      this.saved.emit(
        primaryModel
          ? `บันทึกแล้ว: ใช้ ${primaryModel} เป็นโมเดลหลัก${this.fallbacks().length ? ` และสำรอง ${this.fallbacks().length} ตัว` : ''}`
          : 'บันทึกแล้ว: กลับไปให้ระบบเลือกโมเดลเอง',
      );
    } catch (error: unknown) {
      this.failed.emit(apiErrorMessage(error) ?? 'บันทึกโมเดลไม่สำเร็จ');
    } finally {
      this.saving.set(false);
    }
  }
}

function toOption(model: CatalogOption): CustomSelectOption {
  return { value: model.id, label: model.name, description: describe(model) };
}

function describe(model: CatalogOption): string {
  const price = model.isFree
    ? 'ฟรี'
    : `เข้า ${formatPrice(model.promptPricePerMillion)} · ออก ${formatPrice(model.completionPricePerMillion)} / 1M tokens`;
  return `${model.id} · ${price}${model.supportsTools ? ' · tools' : ''}`;
}

function combinedPrice(model: CatalogOption): number | null {
  return model.promptPricePerMillion === null || model.completionPricePerMillion === null
    ? null
    : model.promptPricePerMillion + model.completionPricePerMillion;
}

function formatPrice(price: number | null): string {
  return price === null
    ? 'ไม่ทราบราคา'
    : `$${price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

import { Component, computed, output, signal } from '@angular/core';

import { DashboardIcon } from './dashboard-icon';
import {
  WIDGET_CATEGORIES,
  WIDGET_DEFINITIONS,
  WidgetCategory,
  WidgetDropRequest,
  WidgetType,
} from './dashboard-builder.models';

type LibraryFilter = 'All' | 'Favorites' | WidgetCategory;

@Component({
  selector: 'app-widget-library',
  imports: [DashboardIcon],
  templateUrl: './widget-library.html',
  styleUrl: './widget-library.css',
})
export class WidgetLibrary {
  readonly widgetAdded = output<WidgetDropRequest>();
  readonly closeRequested = output<void>();

  protected readonly definitions = WIDGET_DEFINITIONS;
  protected readonly categories = WIDGET_CATEGORIES;
  protected readonly query = signal('');
  protected readonly activeFilter = signal<LibraryFilter>('All');
  protected readonly favorites = signal<ReadonlySet<WidgetType>>(
    new Set<WidgetType>(['switch', 'value', 'gauge', 'line-chart']),
  );
  protected readonly collapsedCategories = signal<ReadonlySet<WidgetCategory>>(new Set());

  protected readonly visibleDefinitions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.definitions.filter((definition) => {
      const matchesQuery =
        query.length === 0 ||
        definition.title.toLowerCase().includes(query) ||
        definition.description.toLowerCase().includes(query) ||
        definition.category.toLowerCase().includes(query);
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Favorites' && this.favorites().has(definition.type)) ||
        definition.category === filter;
      return matchesQuery && matchesFilter;
    });
  });

  protected readonly availableCategories = computed(() =>
    this.categories.filter((category) =>
      this.visibleDefinitions().some((definition) => definition.category === category),
    ),
  );

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  protected selectFilter(filter: LibraryFilter): void {
    this.activeFilter.set(filter);
  }

  protected isFilterActive(filter: LibraryFilter): boolean {
    return this.activeFilter() === filter;
  }

  protected definitionsFor(category: WidgetCategory) {
    return this.visibleDefinitions().filter((definition) => definition.category === category);
  }

  protected addWidget(type: WidgetType): void {
    this.widgetAdded.emit({ type });
  }

  protected toggleFavorite(event: MouseEvent, type: WidgetType): void {
    event.stopPropagation();
    this.favorites.update((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  protected isFavorite(type: WidgetType): boolean {
    return this.favorites().has(type);
  }

  protected toggleCategory(category: WidgetCategory): void {
    this.collapsedCategories.update((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  protected categoryCollapsed(category: WidgetCategory): boolean {
    return this.collapsedCategories().has(category);
  }
}

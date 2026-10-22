import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { IoTProject } from './project.store';
import { ProjectActionsStore } from './project-actions.store';

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

const MENU_WIDTH = 208;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MENU_HEIGHT_BASE = 88;
const MENU_HEIGHT_WITH_DELETE = 134;

@Component({
  selector: 'app-project-actions-menu',
  imports: [RouterLink],
  providers: [ProjectActionsStore],
  templateUrl: './project-actions-menu.html',
  styleUrl: './project-actions-menu.css',
  host: {
    '(document:click)': 'handleDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenu()',
    '(window:resize)': 'closeMenu()',
  },
})
export class ProjectActionsMenu {
  readonly project = input.required<IoTProject>();
  readonly deleted = output<void>();

  protected readonly actions = inject(ProjectActionsStore);
  protected readonly open = signal(false);
  protected readonly confirming = signal(false);
  protected readonly menuPosition = signal<MenuPosition>({ top: 0, left: 0, width: MENU_WIDTH });

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    // The card clips its own overflow, so the menu is positioned against the
    // viewport and has to follow or dismiss when anything underneath scrolls.
    const closeOnOutsideScroll = (event: Event) => {
      if (
        this.open() &&
        event.target instanceof Node &&
        !this.elementRef.nativeElement.contains(event.target)
      ) {
        this.closeMenu();
      }
    };
    document.addEventListener('scroll', closeOnOutsideScroll, true);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('scroll', closeOnOutsideScroll, true),
    );

    // The hover lift on the card is a transform, which would make the card the
    // containing block for a plain fixed-position menu and let its overflow clip
    // it away. The top layer sidesteps both.
    afterRenderEffect(() => {
      const menu = this.menu()?.nativeElement;
      if (menu && !menu.matches(':popover-open')) {
        menu.showPopover();
      }
      if (this.confirming() && !this.confirmDialog()?.nativeElement.open) {
        this.confirmDialog()?.nativeElement.showModal();
      }
      this.cancelButton()?.nativeElement.focus();
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.closeMenu();
      return;
    }
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const width = Math.min(MENU_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
    const estimatedHeight = this.actions.canDelete() ? MENU_HEIGHT_WITH_DELETE : MENU_HEIGHT_BASE;
    const openAbove =
      viewportHeight - rect.bottom - MENU_GAP < estimatedHeight && rect.top > estimatedHeight;

    this.menuPosition.set({
      top: openAbove ? rect.top - estimatedHeight - MENU_GAP : rect.bottom + MENU_GAP,
      left: Math.min(Math.max(VIEWPORT_MARGIN, rect.right - width), viewportWidth - width - VIEWPORT_MARGIN),
      width,
    });
    this.open.set(true);
  }

  protected closeMenu(): void {
    if (!this.open()) return;
    this.open.set(false);
  }

  protected handleDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closeMenu();
    }
  }

  protected startDelete(): void {
    this.closeMenu();
    this.confirming.set(true);
  }

  protected closeConfirm(): void {
    if (this.actions.pending()) return;
    this.confirmDialog()?.nativeElement.close();
    this.confirming.set(false);
    this.trigger().nativeElement.focus();
  }

  protected cancelConfirm(event: Event): void {
    event.preventDefault();
    this.closeConfirm();
  }

  protected async deleteProject(): Promise<void> {
    if (!this.confirming()) return;
    if (await this.actions.delete(this.project().id)) {
      this.confirmDialog()?.nativeElement.close();
      this.confirming.set(false);
      this.deleted.emit();
    }
  }
}

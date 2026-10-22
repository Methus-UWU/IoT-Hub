import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The "⋯" account menu shared by the user and admin shells.
 *
 * The popover anchors to the nearest positioned ancestor, so the host shell decides its width by
 * making the account card `position: relative`.
 */
@Component({
  selector: 'app-account-menu',
  imports: [RouterLink],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
  host: {
    '(document:click)': 'closeOutside($event)',
    '(document:keydown.escape)': 'closeAndFocusTrigger()',
  },
})
export class AccountMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  readonly name = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly profileLink = input.required<string>();
  readonly loggingOut = input(false);

  readonly logout = output<void>();
  /** Emitted when the person follows a menu link, so the shell can close its mobile drawer. */
  readonly navigated = output<void>();

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected followLink(): void {
    this.open.set(false);
    this.navigated.emit();
  }

  protected closeOutside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected closeAndFocusTrigger(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}

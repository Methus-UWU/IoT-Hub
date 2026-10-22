import { Component, computed, inject, input, signal } from '@angular/core';
import { AccountAvatarService } from '../../../core/services/account-avatar.service';

@Component({
  selector: 'app-account-avatar',
  host: { 'aria-hidden': 'true' },
  template: `
    @if (source(); as url) {
      @if (failedUrl() !== url) {
        <img [src]="url" alt="" (error)="failedUrl.set(url)" />
      } @else {
        {{ initials() }}
      }
    } @else if (avatar.loading()) {
      <span class="avatar-placeholder"></span>
    } @else {
      {{ initials() }}
    }
  `,
  styles: `
    :host {
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      overflow: hidden;
      border-radius: inherit;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar-placeholder {
      width: 100%;
      height: 100%;
      background: var(--color-surface-muted);
    }
  `,
})
export class AccountAvatar {
  protected readonly avatar = inject(AccountAvatarService);
  readonly initials = input.required<string>();
  readonly previewUrl = input<string | null>(null);
  protected readonly source = computed(() => this.previewUrl() ?? this.avatar.url());
  protected readonly failedUrl = signal<string | null>(null);
}

import { Component, computed, input } from '@angular/core';

/**
 * Avatar palettes, each a tint with text that clears 4.5:1 on it.
 *
 * Eight rather than a generated hue: a computed colour lands on unreadable
 * combinations, and eight is already enough that two names next to each other
 * rarely collide.
 */
const PALETTES: readonly { background: string; color: string }[] = [
  { background: '#eef2ff', color: '#3730a3' },
  { background: '#ecfdf5', color: '#065f46' },
  { background: '#fef3c7', color: '#92400e' },
  { background: '#ffe4e6', color: '#9f1239' },
  { background: '#f5f3ff', color: '#5b21b6' },
  { background: '#ecfeff', color: '#155e75' },
  { background: '#fff7ed', color: '#9a3412' },
  { background: '#f1f5f9', color: '#334155' },
];

/**
 * A username with its avatar.
 *
 * The colour is derived from the name, so the same person looks the same
 * everywhere without storing anything. The avatar is decorative — the name is
 * right beside it — so it is hidden from assistive technology rather than
 * repeating the text.
 */
@Component({
  selector: 'app-author-badge',
  template: `
    <span
      class="avatar"
      aria-hidden="true"
      [style.background]="palette().background"
      [style.color]="palette().color"
      [style.width.rem]="size()"
      [style.height.rem]="size()"
    >
      {{ initials() }}
    </span>
    <span class="name">{{ username() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }
    .avatar {
      display: grid;
      flex: none;
      place-items: center;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .name {
      overflow: hidden;
      color: #454545;
      font-size: 0.75rem;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class AuthorBadge {
  readonly username = input.required<string>();
  readonly size = input(1.6);

  protected readonly initials = computed(() =>
    this.username().trim().slice(0, 2).toLocaleUpperCase(),
  );

  protected readonly palette = computed(() => {
    const name = this.username();
    let hash = 0;
    for (let index = 0; index < name.length; index++) {
      hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
    }
    return PALETTES[hash % PALETTES.length];
  });
}

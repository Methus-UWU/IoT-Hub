import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { catchError, filter, map, of, switchMap } from 'rxjs';

import { AccountAvatarService } from '../../../core/services/account-avatar.service';
import { AuthService } from '../../../core/services/auth.service';
import { AccountAvatar } from '../../../shared/components/account-avatar/account-avatar';

interface NavLink {
  path: string;
  label: string;
  exact: boolean;
}

const NAV_LINKS: readonly NavLink[] = [
  { path: '/home', label: 'หน้าแรก', exact: true },
  { path: '/community', label: 'ชุมชน', exact: false },
  { path: '/docs', label: 'เอกสารคู่มือ', exact: false },
];

interface PillPosition {
  left: number;
  width: number;
  visible: boolean;
}

@Component({
  selector: 'app-nav',
  imports: [RouterLink, RouterLinkActive, AccountAvatar],
  templateUrl: './nav.html',
  styleUrl: './nav.css',
  host: {
    '(document:click)': 'handleDocumentClick($event)',
    '(document:keydown.escape)': 'closeAccountMenu()',
    '(window:resize)': 'remeasure()',
  },
})
export class Nav {
  private readonly auth = inject(AuthService);
  private readonly avatar = inject(AccountAvatarService);
  private readonly router = inject(Router);
  private readonly accountMenu = viewChild<ElementRef<HTMLElement>>('accountMenu');
  private readonly navList = viewChild<ElementRef<HTMLElement>>('navList');
  private readonly navLinkElements = viewChildren<ElementRef<HTMLAnchorElement>>('navLinkElement');

  protected readonly links = NAV_LINKS;
  protected readonly menuOpen = signal(false);
  protected readonly accountMenuOpen = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly hoveredIndex = signal<number | null>(null);
  protected readonly pill = signal<PillPosition>({ left: 0, width: 0, visible: false });
  private readonly measureToken = signal(0);

  protected readonly user = this.auth.currentUser;
  protected readonly signedIn = this.auth.isAuthenticated;
  // One skeleton until both name and photo settle, so the button swaps once
  // instead of skeleton → initials → photo.
  protected readonly identityLoading = computed(
    () => this.auth.identityLoading() || this.avatar.loading(),
  );
  protected readonly username = computed(() => this.auth.accountDisplayName() ?? 'บัญชีของคุณ');
  protected readonly initials = computed(
    () => this.auth.accountDisplayName()?.trim().slice(0, 2).toUpperCase() ?? '',
  );
  protected readonly accountHome = computed(() =>
    this.user()?.role.name.toLowerCase() === 'admin' ? '/admin' : '/user/projects',
  );

  /** The URL drives which pill is the resting one, so it has to track navigation. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activeIndex = computed(() => {
    const url = this.currentUrl().split(/[?#]/)[0] ?? '';
    return this.links.findIndex((link) =>
      link.exact ? url === link.path : url.startsWith(link.path),
    );
  });

  constructor() {
    // The public shell sits outside every guard, so nothing else would have asked
    // Supabase whether this visitor is signed in.
    this.auth
      .restoreSession()
      .pipe(
        switchMap((session) => (session ? this.auth.getCurrentUser() : of(null))),
        catchError(() => of(null)),
        takeUntilDestroyed(),
      )
      .subscribe();

    // The Thai webfont swaps in after first paint and changes the link widths.
    void document.fonts?.ready.then(() => this.remeasure());

    // The pill rests on the active link and follows the pointer while hovering.

    afterRenderEffect(() => {
      this.measureToken();
      const index = this.hoveredIndex() ?? this.activeIndex();
      const list = this.navList()?.nativeElement;
      const target = this.navLinkElements()[index]?.nativeElement;
      if (!list || !target || index < 0) {
        this.pill.update((current) => ({ ...current, visible: false }));
        return;
      }
      // .nav-list is the offset parent, so offsetLeft is already nav-relative.
      this.pill.set({
        left: target.offsetLeft,
        width: target.offsetWidth,
        visible: true,
      });
    });
  }

  /** Bumped to force a re-measure when layout changes underneath the pill. */
  protected remeasure(): void {
    this.measureToken.update((token) => token + 1);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((isOpen) => !isOpen);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected setHovered(index: number | null): void {
    this.hoveredIndex.set(index);
  }

  protected toggleAccountMenu(): void {
    this.accountMenuOpen.update((isOpen) => !isOpen);
  }

  protected closeAccountMenu(): void {
    this.accountMenuOpen.set(false);
  }

  protected handleDocumentClick(event: Event): void {
    if (!this.accountMenu()?.nativeElement.contains(event.target as Node)) {
      this.closeAccountMenu();
    }
  }

  protected logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.auth.logout().subscribe({
      next: () => this.finishLogout(),
      error: () => this.finishLogout(),
    });
  }

  private finishLogout(): void {
    this.loggingOut.set(false);
    this.closeAccountMenu();
    this.closeMenu();
    void this.router.navigateByUrl('/home');
  }
}

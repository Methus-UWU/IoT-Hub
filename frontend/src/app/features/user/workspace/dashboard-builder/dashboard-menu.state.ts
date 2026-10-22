import { Service, signal } from '@angular/core';

@Service()
export class DashboardMenuState {
  readonly activeMenu = signal<string | null>(null);

  toggle(menuId: string): void {
    this.activeMenu.update((active) => (active === menuId ? null : menuId));
  }

  close(menuId?: string): void {
    if (menuId && this.activeMenu() !== menuId) return;
    this.activeMenu.set(null);
  }
}

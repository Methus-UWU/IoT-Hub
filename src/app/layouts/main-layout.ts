import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Nav } from '../features/main/nav/nav';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Nav],
  // The rows give <main> the exact leftover height, so a page can fill the
  // viewport with h-full instead of guessing the header's height in a calc().
  // <main> is also the scroll container rather than the document, which keeps
  // the scrollbar below the header instead of running alongside it.
  template: `
    <div class="grid h-screen grid-rows-[auto_1fr] bg-surface-soft text-primary-dark">
      <app-nav />

      <main id="main-content" class="page-scroll min-h-0" tabindex="-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class MainLayout {}

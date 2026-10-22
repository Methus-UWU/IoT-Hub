import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-auth-layout',
    imports: [RouterOutlet],
    template: `
        <main class="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 p-6">
          <div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
            <div class="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-gray-300/50 blur-3xl"></div>
            <div class="absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-gray-400/40 blur-3xl"></div>
          </div>

          <div class="w-full max-w-120">
            <router-outlet />
          </div>
        </main>
    `,
})
export class AuthLayout {}

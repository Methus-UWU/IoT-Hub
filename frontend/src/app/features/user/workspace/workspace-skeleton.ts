import { Component, input } from '@angular/core';

/**
 * Loading outline of the IDE: toolbar, tab strip, code area, console, AI panel.
 *
 * It traces the real layout rather than a generic two-column placeholder, because the
 * point of a skeleton is that nothing moves when the content arrives. Every measurement
 * here is the one the workspace stylesheet uses — a 3.5 rem toolbar, a 2.625 rem tab
 * strip, a 13.5 rem console, a 22 rem assistant panel — so the editor lands exactly where
 * its outline was.
 *
 * It is its own component because the workspace page's stylesheet is already at its size
 * budget.
 *
 * `part="code"` draws only the code lines, for the editor area while one file is still
 * being read and the rest of the IDE is already on screen.
 */
@Component({
  selector: 'app-workspace-skeleton',
  template: `
    @if (part() === 'code') {
      <div class="ws-code ws-code-only" role="status">
        <span class="sr-only">กำลังโหลดไฟล์…</span>
        @for (width of codeLines; track $index) {
          <span class="bone bone-code" aria-hidden="true" [style.width.%]="width"></span>
        }
      </div>
    } @else {
      <section class="workspace-skeleton" role="status" aria-live="polite">
        <span class="sr-only">กำลังโหลดโปรเจกต์…</span>

        <div class="ws-toolbar" aria-hidden="true">
          <span class="bone bone-segment"></span>
          <span class="bone bone-title"></span>
          <span class="bone bone-tool"></span>
          <span class="bone bone-tool bone-tool-narrow"></span>
          <span class="bone bone-build"></span>
        </div>

        <div class="ws-body" aria-hidden="true">
          <div class="ws-editor">
            <div class="ws-tabs">
              <span class="bone bone-tab"></span>
              <span class="bone bone-tab bone-tab-add"></span>
              <span class="bone bone-save"></span>
            </div>
            <div class="ws-code">
              @for (width of codeLines; track $index) {
                <span class="bone bone-code" [style.width.%]="width"></span>
              }
            </div>
            <div class="ws-console">
              <span class="bone bone-console-tab"></span>
              <span class="bone bone-console-line"></span>
            </div>
            <div class="ws-statusbar">
              <span class="bone bone-status"></span>
              <span class="bone bone-status bone-status-narrow"></span>
            </div>
          </div>

          <aside class="ws-ai">
            <span class="bone bone-ai-select"></span>
            <span class="bone bone-ai-chip"></span>
            <span class="bone bone-ai-composer"></span>
          </aside>
        </div>
      </section>
    }
  `,
  styleUrl: './workspace-skeleton.css',
})
export class WorkspaceSkeleton {
  readonly part = input<'page' | 'code'>('page');
  /** Line widths, in percent: code is ragged, and an even stack reads as a table. */
  protected readonly codeLines = [42, 68, 55, 30, 62, 48, 74, 36];
}

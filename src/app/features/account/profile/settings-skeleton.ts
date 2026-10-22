import { Component, input } from '@angular/core';

@Component({
  selector: 'app-settings-skeleton',
  host: { role: 'status', 'aria-label': 'กำลังโหลดข้อมูลบัญชี', 'aria-busy': 'true' },
  template: `
    <div aria-hidden="true" class="skeleton" [class.profile]="layout() === 'profile'">
      <div class="line title"></div>
      <div class="line subtitle"></div>
      @if (layout() === 'profile') {
        <div class="identity">
          <div class="avatar"></div>
          <div class="line subtitle"></div>
        </div>
        <div class="details">
          @for (row of [1, 2]; track row) {
            <div class="field">
              <div class="line label"></div>
              <div class="control"></div>
              <div class="line subtitle"></div>
            </div>
          }
        </div>
        <div class="field">
          <div class="line label"></div>
          <div class="control biography"></div>
          <div class="line subtitle"></div>
        </div>
        <div class="facts">
          <div class="line subtitle"></div>
          <div class="line label"></div>
        </div>
      } @else {
        @for (row of [1, 2, 3]; track row) {
          <div class="field">
            <div class="line label"></div>
            <div class="control"></div>
          </div>
        }
      }
      <div class="action"></div>
    </div>
    <span class="sr-only">กำลังโหลดข้อมูลบัญชี…</span>
  `,
  styles: `
    :host {
      display: block;
    }
    .skeleton {
      min-height: 22rem;
    }
    .profile {
      min-height: 36rem;
    }
    .details {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
    }
    .control.biography {
      height: 6rem;
    }
    .facts {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 6rem;
    }
    @media (max-width: 600px) {
      .details {
        grid-template-columns: minmax(0, 1fr);
        gap: 0;
      }
      .profile {
        min-height: 45rem;
      }
    }
    .line,
    .avatar,
    .control,
    .action {
      background: var(--color-surface-muted);
      border-radius: 0.5rem;
    }
    .line {
      height: 0.75rem;
    }
    .title {
      width: 35%;
      height: 1.1rem;
    }
    .subtitle {
      width: 60%;
      margin-top: 1rem;
    }
    .identity {
      display: flex;
      gap: 1.25rem;
      align-items: center;
      margin: 2rem 0;
    }
    .avatar {
      width: 5rem;
      height: 5rem;
      flex: none;
      border-radius: 1rem;
    }
    .field {
      margin-top: 1.5rem;
    }
    .label {
      width: 22%;
      margin-bottom: 0.75rem;
    }
    .control {
      height: 2.75rem;
    }
    .action {
      width: 10rem;
      height: 2.5rem;
      margin: 2rem 0 0 auto;
    }
  `,
})
export class SettingsSkeleton {
  readonly layout = input<'profile' | 'fields'>('fields');
}

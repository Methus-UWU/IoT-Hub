import { Component, computed, input } from '@angular/core';

const ICON_PATHS: Readonly<Record<string, string>> = {
  search: 'm21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  star: 'm12 3 2.8 5.67 6.2.9-4.5 4.38 1.06 6.18L12 17.2l-5.56 2.93 1.06-6.18L3 9.57l6.2-.9L12 3Z',
  'star-filled':
    'm12 3 2.8 5.67 6.2.9-4.5 4.38 1.06 6.18L12 17.2l-5.56 2.93 1.06-6.18L3 9.57l6.2-.9L12 3Z',
  toggle: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7Zm0 0a5 5 0 0 0 0 10 5 5 0 0 0 0-10Z',
  button: 'M7 9.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Zm3-4h4',
  sliders: 'M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M10 14v6',
  hash: 'M9 3 7 21m10-18-2 18M4 9h16M3 15h16',
  value: 'M5 5h14v14H5zM8 15l2.5-3 2 2 3.5-5',
  gauge: 'M4.7 17a8 8 0 1 1 14.6 0M12 13l3.5-3.5M8 18h8',
  progress: 'M4 9h16v6H4zM7 12h6',
  status: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.5 2.5L16 9',
  bulb: 'M9 18h6m-5 3h4m3-9a5 5 0 1 0-10 0c0 2 2 3 2 6h6c0-3 2-4 2-6Z',
  'line-chart': 'M4 19V5m0 14h16M7 15l3-4 3 2 5-6',
  'bar-chart': 'M5 19V9h3v10m3 0V5h3v14m3 0v-7h3v7M3 19h18',
  'pie-chart': 'M11 3a9 9 0 1 0 9 9h-9V3Zm3 0v6h6a7 7 0 0 0-6-6Z',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3m5 0h5',
  text: 'M5 6V4h14v2M12 4v16m-3 0h6',
  divider: 'M3 12h18M6 8l-3 4 3 4m12-8 3 4-3 4',
  desktop: 'M3 5h18v12H3zM8 21h8m-4-4v4',
  tablet: 'M6 3h12v18H6zM11 18h2',
  mobile: 'M8 2.5h8v19H8zM11 18.5h2',
  undo: 'M9 7 4 12l5 5m-5-5h9a6 6 0 0 1 6 6',
  redo: 'm15 7 5 5-5 5m5-5h-9a6 6 0 0 0-6 6',
  eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  edit: 'm4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3',
  save: 'M5 3h12l2 2v16H5zM8 3v6h8V3m-8 18v-7h8v7',
  publish: 'M12 16V3m0 0L7 8m5-5 5 5M5 13v7h14v-7',
  library: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
  inspector: 'M4 5h16M4 12h16M4 19h16M8 2v6m8 1v6M9 16v6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  move: 'M12 2v20m0-20-3 3m3-3 3 3M2 12h20M2 12l3-3m-3 3 3 3m17-3-3-3m3 3-3 3m-7 7-3-3m3 3 3-3',
  resize: 'M8 20H4v-4m12-12h4v4M4 20l6-6M20 4l-6 6',
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  trash: 'M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6',
  lock: 'M6 10h12v11H6zM8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v3',
  unlock: 'M6 10h12v11H6zM9 10V7.5a3.5 3.5 0 0 1 6.4-2M12 14v3',
  close: 'm5 5 14 14M19 5 5 19',
  chevron: 'm8 10 4 4 4-4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  compact: 'M4 5h16M7 9h10M4 19h16M7 15h10M12 9v6m0 0-2-2m2 2 2-2',
  'align-left': 'M5 4v16M9 7h10M9 12h7M9 17h10',
  'align-top': 'M4 5h16M7 9v10m5-10v7m5-7v10',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m15-6.5L17 7m-10 10-1.5 1.5m13 0L17 17M7 7 5.5 5.5',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6m-16 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  palette:
    'M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3.3-4-6-9-6ZM7 9h.01m3-3h.01m4 0h.01m3 3h.01',
  action: 'M13 2 5 13h6l-1 9 9-12h-6V2Z',
  permissions: 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  device: 'M8 3h8v4h4v10h-4v4H8v-4H4V7h4V3Zm1 6h6v6H9z',
  calendar: 'M4 6h16v14H4zM8 3v6m8-6v6M4 10h16',
  check: 'm5 12 4 4L19 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-10h.01',
  cloud: 'M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z',
};

@Component({
  selector: 'app-dashboard-icon',
  template: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        [attr.d]="path()"
        [attr.fill]="filled() ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.65"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      width: 1.15rem;
      height: 1.15rem;
      flex: none;
      place-items: center;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class DashboardIcon {
  readonly name = input.required<string>();
  protected readonly path = computed(() => ICON_PATHS[this.name()] ?? ICON_PATHS['info']);
  protected readonly filled = computed(() => this.name() === 'star-filled');
}

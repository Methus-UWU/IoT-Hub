import { Component, computed, input } from '@angular/core';

export type FileIconKind =
  'cpp' | 'header' | 'arduino' | 'python' | 'json' | 'config' | 'markup' | 'file';

const EXTENSION_KINDS: Readonly<Record<string, FileIconKind>> = {
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'header',
  hh: 'header',
  hpp: 'header',
  ino: 'arduino',
  pde: 'arduino',
  py: 'python',
  pyi: 'python',
  json: 'json',
  cfg: 'config',
  conf: 'config',
  env: 'config',
  ini: 'config',
  toml: 'config',
  yaml: 'config',
  yml: 'config',
  log: 'markup',
  markdown: 'markup',
  md: 'markup',
  txt: 'markup',
};

/** Document outline shared by every kind, so a tab strip keeps one silhouette. */
@Component({
  selector: 'app-file-icon',
  template: `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 2.5h6l4 4v11H5z" stroke="currentColor" stroke-width="1.2" />
      <path d="M11 2.5v4h4" stroke="currentColor" stroke-width="1.2" />

      @switch (kind()) {
        @case ('cpp') {
          <path
            d="M7.3 12.4v2.6M6 13.7h2.6M11.6 12.4v2.6M10.3 13.7h2.6"
            stroke="currentColor"
            stroke-width="1.15"
            stroke-linecap="round"
          />
        }
        @case ('header') {
          <path
            d="M9.4 12.4v2.6M8.1 13.7h2.6"
            stroke="currentColor"
            stroke-width="1.15"
            stroke-linecap="round"
          />
        }
        @case ('arduino') {
          <circle cx="8.1" cy="13.9" r="1.35" stroke="currentColor" stroke-width="1.1" />
          <circle cx="11.5" cy="13.9" r="1.35" stroke="currentColor" stroke-width="1.1" />
        }
        @case ('python') {
          <path
            d="M6.6 14.9c1-1.3 2-1.3 3 0s2 1.3 3 0"
            stroke="currentColor"
            stroke-width="1.15"
            stroke-linecap="round"
          />
        }
        @case ('json') {
          <path
            d="M8.7 11.9c-.9 0-.9 1.1-.9 1.6s-.6.8-.6.8.6.3.6.8 0 1.6.9 1.6M11.3 11.9c.9 0 .9 1.1.9 1.6s.6.8.6.8-.6.3-.6.8 0 1.6-.9 1.6"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        }
        @case ('config') {
          <path
            d="M6.4 12.9h7.2M6.4 15.3h7.2"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <circle cx="8.9" cy="12.9" r="1.05" fill="currentColor" />
          <circle cx="11.4" cy="15.3" r="1.05" fill="currentColor" />
        }
        @case ('markup') {
          <path
            d="M6.6 12.4h6.8M6.6 14.2h6.8M6.6 16h4.2"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        }
        @default {
          <path
            d="M6.8 13.4h6.4M6.8 15.6h4.4"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      width: 0.95rem;
      height: 0.95rem;
      flex: none;
      place-items: center;
      /* Colour carries the file type at tab size, where the mark alone is too small. */
      color: #8a94a0;
    }

    :host(.kind-cpp) {
      color: #3f7bd0;
    }
    :host(.kind-header) {
      color: #6b8fd6;
    }
    :host(.kind-arduino) {
      color: #1f9b93;
    }
    :host(.kind-python) {
      color: #c08a1f;
    }
    :host(.kind-json) {
      color: #8a63c9;
    }
    :host(.kind-config) {
      color: #4f8a5b;
    }
    :host(.kind-markup) {
      color: #7b8794;
    }

    svg {
      width: 100%;
      height: 100%;
    }
  `,
  host: {
    '[class]': '"kind-" + kind()',
  },
})
export class FileIcon {
  readonly filename = input.required<string>();

  protected readonly kind = computed<FileIconKind>(() => {
    const name = this.filename().trim().toLowerCase();
    const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
    return EXTENSION_KINDS[extension] ?? 'file';
  });
}

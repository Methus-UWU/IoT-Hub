import { Component, forwardRef, input } from '@angular/core';

import type { Shape } from '../devices/core/device-shape';

/**
 * Draws a device's declarative shape list as SVG.
 *
 * This is the only component that knows how to turn artwork into DOM, so the
 * canvas, the placement ghost, the library thumbnail and the inspector preview
 * all render from one code path and can never drift apart. Parts stay pure data.
 *
 * The component recurses into itself for `group` shapes, which is why it appears
 * in its own `imports` behind a `forwardRef`.
 */
@Component({
  selector: '[appDeviceShapes]',
  imports: [forwardRef(() => DeviceShapes)],
  template: `
    @for (shape of shapes(); track $index) {
      @switch (shape.kind) {
        @case ('rect') {
          <svg:rect
            [attr.x]="shape.x"
            [attr.y]="shape.y"
            [attr.width]="shape.width"
            [attr.height]="shape.height"
            [attr.rx]="shape.rx ?? null"
            [attr.fill]="shape.fill ?? 'none'"
            [attr.stroke]="shape.stroke ?? null"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('circle') {
          <svg:circle
            [attr.cx]="shape.cx"
            [attr.cy]="shape.cy"
            [attr.r]="shape.r"
            [attr.fill]="shape.fill ?? 'none'"
            [attr.stroke]="shape.stroke ?? null"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('ellipse') {
          <svg:ellipse
            [attr.cx]="shape.cx"
            [attr.cy]="shape.cy"
            [attr.rx]="shape.rx"
            [attr.ry]="shape.ry"
            [attr.fill]="shape.fill ?? 'none'"
            [attr.stroke]="shape.stroke ?? null"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('path') {
          <svg:path
            [attr.d]="shape.d"
            [attr.fill]="shape.fill ?? 'none'"
            [attr.stroke]="shape.stroke ?? null"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.stroke-linecap]="shape.strokeLinecap ?? null"
            [attr.stroke-linejoin]="shape.strokeLinejoin ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('line') {
          <svg:line
            [attr.x1]="shape.x1"
            [attr.y1]="shape.y1"
            [attr.x2]="shape.x2"
            [attr.y2]="shape.y2"
            [attr.stroke]="shape.stroke ?? 'currentColor'"
            [attr.stroke-width]="shape.strokeWidth ?? 1"
            [attr.stroke-linecap]="shape.strokeLinecap ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('text') {
          <svg:text
            [attr.x]="shape.x"
            [attr.y]="shape.y"
            [attr.font-size]="shape.size ?? 11"
            [attr.fill]="shape.fill ?? 'currentColor'"
            [attr.text-anchor]="shape.anchor ?? 'start'"
            [attr.font-weight]="shape.weight ?? null"
            [attr.letter-spacing]="shape.letterSpacing ?? null"
            [attr.transform]="textTransform(shape)"
            [attr.opacity]="shape.opacity ?? null"
            [class.mono]="shape.mono"
            class="shape-text"
          >
            {{ shape.text }}
          </svg:text>
        }
        @case ('group') {
          <svg:g
            [appDeviceShapes]="shape.children"
            [attr.transform]="shape.transform ?? null"
            [attr.opacity]="shape.opacity ?? null"
          ></svg:g>
        }
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .shape-text {
      /* Artwork lettering must not inherit the page font, or a theme change
         would reflow every silkscreen label on the canvas. */
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      pointer-events: none;
      user-select: none;
    }

    .shape-text.mono {
      font-family: 'JetBrains Mono', 'SFMono-Regular', 'Consolas', monospace;
    }
  `,
})
export class DeviceShapes {
  readonly shapes = input.required<readonly Shape[]>({ alias: 'appDeviceShapes' });

  protected textTransform(shape: Extract<Shape, { kind: 'text' }>): string | null {
    return shape.rotate ? `rotate(${shape.rotate} ${shape.x} ${shape.y})` : null;
  }
}

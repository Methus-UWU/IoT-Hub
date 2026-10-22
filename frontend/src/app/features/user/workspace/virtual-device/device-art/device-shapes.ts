import { Component, forwardRef, input } from '@angular/core';

import type { Paint, Shape } from '../devices/core/device-shape';
import { paintRef } from '../devices/core/device-shape';

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
            [attr.fill]="paint(shape.fill, 'none')"
            [attr.stroke]="paint(shape.stroke, null)"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('circle') {
          <svg:circle
            [attr.cx]="shape.cx"
            [attr.cy]="shape.cy"
            [attr.r]="shape.r"
            [attr.fill]="paint(shape.fill, 'none')"
            [attr.stroke]="paint(shape.stroke, null)"
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
            [attr.fill]="paint(shape.fill, 'none')"
            [attr.stroke]="paint(shape.stroke, null)"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.opacity]="shape.opacity ?? null"
          />
        }
        @case ('path') {
          <svg:path
            [attr.d]="shape.d"
            [attr.fill]="paint(shape.fill, 'none')"
            [attr.stroke]="paint(shape.stroke, null)"
            [attr.stroke-width]="shape.strokeWidth ?? null"
            [attr.fill-rule]="shape.fillRule ?? null"
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
            [attr.stroke]="paint(shape.stroke, 'currentColor')"
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
            [attr.fill]="paint(shape.fill, 'currentColor')"
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
    /*
      The host is always an <svg:g> — the canvas root and, when this component
      recurses, the group element carrying a shape's own transform. It must NOT
      be given "display: contents": that removes the element from SVG rendering,
      children draw against the parent's coordinate system, and any transform on
      the group is silently dropped.
    */

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

  /**
   * Resolves a paint to an attribute value: a colour passes through, a gradient
   * becomes the `url(#…)` of the definition `DeviceGradients` emitted for it.
   */
  protected paint(value: Paint | undefined, fallback: string | null): string | null {
    return paintRef(value, fallback);
  }

  protected textTransform(shape: Extract<Shape, { kind: 'text' }>): string | null {
    return shape.rotate ? `rotate(${shape.rotate} ${shape.x} ${shape.y})` : null;
  }
}

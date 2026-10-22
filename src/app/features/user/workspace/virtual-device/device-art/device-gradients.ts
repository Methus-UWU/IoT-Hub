import { Component, computed, input } from '@angular/core';

import type { GradientPaint, Shape } from '../devices/core/device-shape';
import { collectGradients, linearAxis, paintId } from '../devices/core/device-shape';

/**
 * Emits the `<defs>` a shape list's gradients refer to.
 *
 * Gradient ids are derived from the gradient itself, so the same gold header
 * fill reached through twenty parts produces one id — and, per artwork, one
 * definition. Two artworks that both use it each emit their own copy, which is
 * legal: identical id, identical definition, and `url(#…)` resolves to the
 * first. Sharing one document-wide `<defs>` instead would mean the canvas had
 * to know which parts are currently placed, which is exactly the coupling the
 * shape pipeline exists to avoid.
 */
@Component({
  selector: '[appDeviceGradients]',
  template: `
    @for (gradient of gradients(); track gradient.id) {
      @if (gradient.paint.kind === 'linear') {
        <svg:linearGradient
          [attr.id]="gradient.id"
          [attr.x1]="axis(gradient.paint).x1"
          [attr.y1]="axis(gradient.paint).y1"
          [attr.x2]="axis(gradient.paint).x2"
          [attr.y2]="axis(gradient.paint).y2"
        >
          @for (stop of gradient.paint.stops; track $index) {
            <svg:stop
              [attr.offset]="stop.offset"
              [attr.stop-color]="stop.color"
              [attr.stop-opacity]="stop.opacity ?? null"
            />
          }
        </svg:linearGradient>
      } @else {
        <svg:radialGradient
          [attr.id]="gradient.id"
          [attr.cx]="gradient.paint.cx ?? 0.5"
          [attr.cy]="gradient.paint.cy ?? 0.5"
          [attr.r]="gradient.paint.r ?? 0.5"
        >
          @for (stop of gradient.paint.stops; track $index) {
            <svg:stop
              [attr.offset]="stop.offset"
              [attr.stop-color]="stop.color"
              [attr.stop-opacity]="stop.opacity ?? null"
            />
          }
        </svg:radialGradient>
      }
    }
  `,
})
export class DeviceGradients {
  readonly shapes = input.required<readonly Shape[]>({ alias: 'appDeviceGradients' });

  protected readonly gradients = computed(() =>
    collectGradients(this.shapes()).map((paint) => ({ id: paintId(paint), paint })),
  );

  protected axis(paint: GradientPaint): { x1: number; y1: number; x2: number; y2: number } {
    return linearAxis(paint.kind === 'linear' ? (paint.angle ?? 90) : 90);
  }
}

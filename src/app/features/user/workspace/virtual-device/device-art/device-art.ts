import { Component, computed, input } from '@angular/core';

import { defaultStateFor } from '../devices/core/device-definition';
import type { DetailLevel } from '../devices/core/device-shape';
import { shapesForDetail } from '../devices/core/device-shape';
import type { VirtualDevice } from '../models/virtual-device.model';
import { DeviceShapes } from './device-shapes';

/**
 * Single source of truth for component artwork. The same drawing is used by the
 * canvas, by the placement ghost, and by the Add Device thumbnails, so a part
 * always looks identical wherever it appears.
 *
 * Every catalog part now describes itself as a shape list, so this component has
 * no per-device knowledge at all — it renders whatever `draw()` returns. The
 * hand-written templates that used to sit here (one `@case` per part, plus 700
 * lines of CSS naming their internals) are gone: they were a second, divergent
 * copy of artwork that the shape pipeline already produced.
 *
 * Interactive pins are intentionally *not* drawn here — the canvas layers its own
 * hit targets on top so the artwork stays a pure, reusable illustration.
 */
@Component({
  selector: '[appDeviceArt]',
  imports: [DeviceShapes],
  templateUrl: './device-art.html',
  styleUrl: './device-art.css',
  host: { class: 'virtual-component' },
})
export class DeviceArt {
  readonly device = input.required<VirtualDevice>();
  readonly running = input(false);
  readonly showCaption = input(true);
  /** Live property and simulation values, keyed by property id. */
  readonly state = input<Readonly<Record<string, unknown>>>({});
  readonly detail = input<DetailLevel>('normal');

  protected readonly shapes = computed(() => {
    const device = this.device();
    const render = device.render;
    if (!render) return [];

    // A part dropped on the canvas before its state exists — a placement ghost,
    // a library thumbnail — still has to draw something, so fall back to its own
    // declared defaults rather than an empty object.
    const state = Object.keys(this.state()).length
      ? this.state()
      : defaultStateFor(device.properties);

    return shapesForDetail(
      render.draw({ state, detail: this.detail(), running: this.running() }),
      this.detail(),
    );
  });

  protected readonly captionText = computed(() => {
    const device = this.device();
    return device.model || device.name;
  });
}

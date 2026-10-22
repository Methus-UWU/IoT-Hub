import { Component, computed, input } from '@angular/core';

import { DeviceArt } from './device-art/device-art';
import type { DeviceKind } from './device-library.models';
import { defaultStateFor } from './devices/core/device-definition';
import { deviceById } from './devices/device-catalog';

const PADDING = 12;
/**
 * Fallback bleed for the original catalog parts, whose backpacks, connector
 * shells and metal leads reach left of the body origin. Parts on the
 * declarative pipeline declare their own bleed instead of relying on this.
 */
const LEGACY_LEFT_OVERHANG = 40;

/**
 * Renders a catalog device using the exact artwork the canvas uses, scaled to fit
 * without cropping pins or connectors.
 */
@Component({
  selector: 'app-device-thumbnail',
  imports: [DeviceArt],
  template: `
    @if (device(); as part) {
      <svg
        class="device-art"
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <g appDeviceArt [device]="part" [state]="state()" detail="normal" [showCaption]="false"></g>
      </svg>
    }
  `,
  styleUrl: './device-thumbnail.css',
})
export class DeviceThumbnail {
  readonly kind = input.required<DeviceKind>();

  protected readonly device = computed(() => deviceById(this.kind()));

  /** Property defaults, so a thumbnail shows the part in its resting state. */
  protected readonly state = computed(() => defaultStateFor(this.device()?.properties));

  protected readonly viewBox = computed(() => {
    const part = this.device();
    if (!part) return '0 0 100 100';

    const bleed = part.render?.bleed;
    const left = bleed ? (bleed.left ?? 0) : LEGACY_LEFT_OVERHANG;
    const right = bleed?.right ?? 0;
    const top = bleed?.top ?? 0;
    const bottom = bleed?.bottom ?? 0;

    return [
      -left - PADDING,
      -top - PADDING,
      part.width + left + right + PADDING * 2,
      part.height + top + bottom + PADDING * 2,
    ].join(' ');
  });
}

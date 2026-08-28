import { Component, computed, input } from '@angular/core';

import type { DetailLevel } from '../devices/core/device-shape';
import { shapesForDetail } from '../devices/core/device-shape';
import type { VirtualDevice } from '../models/virtual-device.model';
import { DeviceShapes } from './device-shapes';

interface LcdCell {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LcdLine {
  readonly row: number;
  readonly y: number;
  readonly text: string;
}

interface LcdMetrics {
  readonly cells: readonly LcdCell[];
  readonly lines: readonly LcdLine[];
  readonly textX: number;
  readonly fontSize: number;
  readonly letterSpacing: number;
}

/**
 * Single source of truth for component artwork. The same drawing is used by the
 * canvas, by the placement ghost, and by the Add Device thumbnails, so a part
 * always looks identical wherever it appears.
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
  readonly distance = input(42);
  readonly servoAngle = input(90);
  readonly buttonPressed = input(false);
  readonly relayStates = input<readonly boolean[]>([]);
  readonly showCaption = input(true);
  /** Live property values for parts drawn from the declarative shape pipeline. */
  readonly state = input<Readonly<Record<string, unknown>>>({});
  readonly detail = input<DetailLevel>('normal');

  /**
   * Declarative artwork for parts that declare a `render`. Returns null for the
   * original hand-authored parts so the template falls through to their
   * bespoke markup — both kinds of part therefore render side by side.
   */
  protected readonly shapes = computed(() => {
    const render = this.device().render;
    if (!render) return null;
    return shapesForDetail(
      render.draw({ state: this.state(), detail: this.detail(), running: this.running() }),
      this.detail(),
    );
  });

  protected readonly artKind = computed<string>(() => {
    const device = this.device();
    if (device.lcdConfig) return 'lcd';
    const channels = device.relayChannels?.length;
    if (channels === 1) return 'relay1';
    if (channels === 8) return 'relay8';
    if (channels) return 'relayn';
    return device.id;
  });

  protected readonly lcd = computed<LcdMetrics | null>(() => {
    const device = this.device();
    const config = device.lcdConfig;
    if (!config) return null;

    const areaX = 40;
    const areaY = 38;
    const areaWidth = device.width - 80;
    const areaHeight = device.height - 96;
    const stepX = areaWidth / config.columns;
    const stepY = areaHeight / config.rows;
    const cellWidth = stepX * 0.66;
    const cellHeight = stepY * 0.68;

    const cells: LcdCell[] = [];
    for (const row of config.rowIndexes) {
      for (const column of config.columnIndexes) {
        cells.push({
          key: `${row}-${column}`,
          x: areaX + column * stepX + (stepX - cellWidth) / 2,
          y: areaY + row * stepY + (stepY - cellHeight) / 2,
          width: cellWidth,
          height: cellHeight,
        });
      }
    }

    const texts = this.lcdTexts(config.rows, config.columns);
    return {
      cells,
      lines: config.rowIndexes.map((row) => ({
        row,
        y: areaY + row * stepY + stepY * 0.74,
        text: texts[row] ?? '',
      })),
      textX: areaX + stepX * 0.22,
      fontSize: Math.min(stepY * 0.66, stepX * 1.42),
      letterSpacing: stepX * 0.2,
    };
  });

  protected readonly captionText = computed(() => {
    const device = this.device();
    // Parts on the declarative pipeline caption themselves from catalog data
    // instead of needing a hand-written case below.
    if (device.render) return device.model || device.name;
    switch (this.artKind()) {
      case 'lcd':
        return `LCD ${device.lcdConfig?.columns}x${device.lcdConfig?.rows} · ${
          device.lcdConfig?.interface === 'i2c' ? 'I2C' : 'Parallel'
        }`;
      case 'led':
        return 'LED 5 mm';
      case 'ultrasonic':
        return `HC-SR04 · ${this.distance()} cm`;
      case 'button':
        return 'Push button';
      case 'servo':
        return `SG90 · ${this.servoAngle()}°`;
      case 'dc-motor':
        return `DC motor · ${this.running() ? 'running' : 'stopped'}`;
      default:
        return `${device.relayChannels?.length ?? 1}-channel 5 V relay`;
    }
  });

  protected relayOn(index: number): boolean {
    return this.relayStates()[index] ?? false;
  }

  private lcdTexts(rows: number, columns: number): readonly string[] {
    const running = this.running();
    if (rows === 2) {
      return running ? ['DISTANCE', `${this.distance()} CM`] : ['IOT HUB', 'READY'];
    }
    return running
      ? [
          'IOT HUB MONITOR'.slice(0, columns),
          `DIST  ${this.distance()} CM`,
          `SERVO ${this.servoAngle()} DEG`,
          'STATUS   ONLINE',
        ]
      : ['IOT HUB MONITOR'.slice(0, columns), 'READY', '', 'PRESS START'];
  }
}

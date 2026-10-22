import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext, DevicePropertyDefinition } from '../core/device-definition';
import { HEADER_PITCH, u, UNITS_PER_MM } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { rect, repeat, text, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';

type DipPositions = 2 | 4 | 6 | 8;

/** One switch per 0.1 in column, the same grid as the pins beneath it. */
const SWITCH_PITCH = HEADER_PITCH;
/** A DIP switch package is 9.8 mm across the rows whatever its length. */
const BODY_HEIGHT = u(9.8);
const MARGIN = u(1.3);

/**
 * DIP switch bank.
 *
 * Pin `n` on the top row pairs with pin `n` on the bottom row — closing switch
 * `n` shorts exactly that pair, which is why the two rows are laid out in
 * mirrored columns rather than numbered continuously around the package.
 */
function createDipSwitch(positions: DipPositions): VirtualDevice {
  const width = MARGIN * 2 + positions * SWITCH_PITCH;
  const height = BODY_HEIGHT;
  const firstX = MARGIN + SWITCH_PITCH / 2;

  const properties: readonly DevicePropertyDefinition[] = Array.from(
    { length: positions },
    (_, index) => ({
      id: `switch${index + 1}`,
      label: `Switch ${index + 1}`,
      kind: 'boolean' as const,
      defaultValue: false,
      group: 'general' as const,
      description: `Closes pin ${index + 1} to pin ${index + 1}' when on.`,
    }),
  );

  function draw(context: DeviceDrawContext): readonly Shape[] {
    return [
      // Red package with the cream actuator channel down the middle.
      rect(0, 0, width, height, {
        rx: u(0.4),
        fill: '#b23030',
        stroke: OUTLINE,
        strokeWidth: u(0.15),
      }),
      rect(MARGIN - u(0.4), u(2.6), width - (MARGIN - u(0.4)) * 2, u(4.5), {
        rx: u(0.2),
        fill: '#7f2020',
        detail: 'normal',
      }),

      // Actuators. Up is ON, matching the silkscreen arrow on a real package.
      ...repeat(
        positions,
        { x: SWITCH_PITCH },
        (index, x) => {
          const on = context.state[`switch${index + 1}`] === true;
          return [
            rect(x - u(0.6), on ? u(2.9) : u(4.8), u(1.2), u(1.9), {
              rx: u(0.15),
              fill: on ? PART.plasticCream : '#cfc6b0',
              stroke: OUTLINE,
              strokeWidth: u(0.08),
            }),
            text(x, u(2.2), String(index + 1), {
              size: u(0.9),
              fill: SILK.white,
              anchor: 'middle',
              weight: 700,
              mono: true,
              detail: 'normal',
            }),
          ];
        },
        { x: firstX, y: 0 },
      ),

      text(width - u(0.6), height - u(0.7), 'ON', {
        size: u(0.9),
        fill: SILK.soft,
        anchor: 'end',
        weight: 700,
        mono: true,
        detail: 'normal',
      }),

      // Gull-wing leads.
      ...repeat(
        positions,
        { x: SWITCH_PITCH },
        (_, x) => [
          rect(x - u(0.35), -u(0.7), u(0.7), u(0.8), { fill: PART.headerGold, detail: 'normal' }),
          rect(x - u(0.35), height - u(0.1), u(0.7), u(0.8), {
            fill: PART.headerGold,
            detail: 'normal',
          }),
        ],
        { x: firstX, y: 0 },
      ),
    ];
  }

  return {
    id: `dip-switch-${positions}`,
    name: `DIP switch ${positions}-position`,
    model: `SPST ×${positions}`,
    description: `Bank of ${positions} independent SPST switches for configuration or addressing.`,
    x: 480,
    y: 720,
    width,
    height,
    // Length follows the switch count; the 9.8 mm package height never does.
    physicalSize: { widthMm: width / UNITS_PER_MM, heightMm: height / UNITS_PER_MM },
    initiallyVisible: false,
    interfaces: ['digital', 'passive'],
    pins: [
      ...Array.from({ length: positions }, (_, index) =>
        pin(String(index + 1), firstX + index * SWITCH_PITCH, 0, 'passive', {
          side: 'top',
          description: `Switch ${index + 1}, side A`,
        }),
      ),
      ...Array.from({ length: positions }, (_, index) =>
        pin(`${index + 1}'`, firstX + index * SWITCH_PITCH, height, 'passive', {
          side: 'bottom',
          description: `Switch ${index + 1}, side B`,
        }),
      ),
    ],
    properties,
    render: { draw, bleed: { top: u(1), bottom: u(1) } },
    catalog: {
      categoryId: 'switches',
      category: 'Switches',
      aliases: ['dip switch', `${positions} position switch`, 'สวิตช์ดิป', 'config switch'],
      tags: ['dip', 'switch', 'config', 'address', 'input', 'spst', `${positions}-position`],
      interfaceLabel: `SPST ×${positions} · ${positions * 2} ขา`,
      typicalUsage: 'Setting I2C addresses, boot options, and hardware configuration.',
    },
  };
}

export const DIP_SWITCH_2 = createDipSwitch(2);
export const DIP_SWITCH_4 = createDipSwitch(4);
export const DIP_SWITCH_8 = createDipSwitch(8);

/**
 * Each position is an independent SPST contact between pin `n` and pin `n'`.
 * Attached after construction so the factory stays a pure description.
 */
function createDipBehavior(positions: number): DeviceBehavior {
  return {
    connect(context) {
      for (let index = 1; index <= positions; index++) {
        if (context.properties[`switch${index}`] === true) {
          context.bond(String(index), `${index}'`);
        }
      }
    },
  };
}

for (const [device, positions] of [
  [DIP_SWITCH_2, 2],
  [DIP_SWITCH_4, 4],
  [DIP_SWITCH_8, 8],
] as const) {
  device.simulation = () => createDipBehavior(positions);
}

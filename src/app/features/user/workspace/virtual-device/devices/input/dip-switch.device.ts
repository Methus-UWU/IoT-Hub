import type { VirtualDevice } from '../../models/virtual-device.model';
import type {
  DeviceDrawContext,
  DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, repeat, text, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';

type DipPositions = 2 | 4 | 6 | 8;

const SWITCH_PITCH = PIN_PITCH;
const BODY_HEIGHT = 96;
const MARGIN = 14;

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
        rx: 4,
        fill: '#b23030',
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      rect(MARGIN - 4, 26, width - (MARGIN - 4) * 2, 44, {
        rx: 2,
        fill: '#7f2020',
        detail: 'normal',
      }),

      // Actuators. Up is ON, matching the silkscreen arrow on a real package.
      ...repeat(positions, { x: SWITCH_PITCH }, (index, x) => {
        const on = context.state[`switch${index + 1}`] === true;
        return [
          rect(x - 6, on ? 29 : 49, 12, 19, {
            rx: 1.5,
            fill: on ? PART.plasticCream : '#cfc6b0',
            stroke: OUTLINE,
            strokeWidth: 0.75,
          }),
          text(x, 22, String(index + 1), {
            size: 8.5,
            fill: SILK.white,
            anchor: 'middle',
            weight: 700,
            mono: true,
            detail: 'normal',
          }),
        ];
      }, { x: firstX, y: 0 }),

      text(width - 6, height - 6, 'ON', {
        size: 8,
        fill: SILK.soft,
        anchor: 'end',
        weight: 700,
        mono: true,
        detail: 'normal',
      }),

      // Gull-wing leads.
      ...repeat(positions, { x: SWITCH_PITCH }, (_, x) => [
        rect(x - 3.5, -7, 7, 8, { fill: PART.headerGold, detail: 'normal' }),
        rect(x - 3.5, height - 1, 7, 8, { fill: PART.headerGold, detail: 'normal' }),
      ], { x: firstX, y: 0 }),
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
    render: { draw, bleed: { top: 10, bottom: 10 } },
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

import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, path, rect, repeat, type Shape } from '../core/device-shape';

const POLE_PITCH = PIN_PITCH * 1.4;
const MARGIN = 12;
const HEIGHT = 92;

/**
 * Screw terminal block.
 *
 * A passthrough connector: each screw is one net, so its two sides bond
 * together. That makes it useful in simulation as a labelled junction — wire a
 * battery to one side and a load to the other and current flows through.
 */
function createScrewTerminal(poles: number): VirtualDevice {
  const width = MARGIN * 2 + (poles - 1) * POLE_PITCH + POLE_PITCH;
  const firstX = MARGIN + POLE_PITCH / 2;

  const pins: DevicePin[] = [
    ...Array.from({ length: poles }, (_, index) =>
      pin(`${index + 1}`, firstX + index * POLE_PITCH, HEIGHT, 'passive', {
        side: 'bottom',
        description: `Screw ${index + 1} — board side`,
      }),
    ),
    ...Array.from({ length: poles }, (_, index) =>
      pin(`${index + 1}W`, firstX + index * POLE_PITCH, 0, 'passive', {
        side: 'top',
        description: `Screw ${index + 1} — wire side`,
      }),
    ),
  ];

  function draw(_context: DeviceDrawContext): readonly Shape[] {
    return [
      rect(0, 8, width, HEIGHT - 16, {
        rx: 5,
        fill: '#1f6f4a',
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      ...repeat(poles, { x: POLE_PITCH }, (_, x) => [
        // Wire entry funnel.
        path(`M ${x - 9} 14 L ${x + 9} 14 L ${x + 5} 30 L ${x - 5} 30 Z`, {
          fill: '#17583b',
          detail: 'normal',
        }),
        // Screw head with its slot.
        rect(x - 9, 34, 18, 18, {
          rx: 2,
          fill: PART.metalLight,
          stroke: PART.metalDark,
          strokeWidth: 1,
        }),
        line(x - 6, 43, x + 6, 43, { stroke: '#5a616b', strokeWidth: 2, detail: 'normal' }),
        // Solder pin stub.
        rect(x - 2, HEIGHT - 12, 4, 12, { fill: PART.metal, detail: 'normal' }),
      ], { x: firstX, y: 0 }),
    ];
  }

  function createBehavior() {
    return {
      connect(context: { bond(a: string, b: string): void }) {
        for (let index = 1; index <= poles; index++) {
          context.bond(`${index}`, `${index}W`);
        }
      },
    };
  }

  return {
    id: `screw-terminal-${poles}`,
    name: `Screw terminal ${poles}-pin`,
    model: `KF301 · ${poles}P`,
    description: `Passthrough terminal block with ${poles} screw connections.`,
    x: 460,
    y: 740,
    width,
    height: HEIGHT,
    initiallyVisible: false,
    interfaces: ['passive'],
    pins,
    render: { draw, bleed: { top: 8, bottom: 6 } },
    simulation: createBehavior,
    catalog: {
      categoryId: 'connectors',
      category: 'Connectors',
      aliases: ['screw terminal', 'terminal block', 'ขั้วต่อสกรู', `${poles} pin terminal`],
      tags: ['terminal', 'connector', 'screw', 'wire', 'passthrough', `${poles}-pin`],
      interfaceLabel: `พาสทรู · ${poles} ขั้ว`,
      typicalUsage: 'Landing external wiring — power, motors, and sensors — onto a board.',
    },
  };
}

export const SCREW_TERMINAL_2 = createScrewTerminal(2);
export const SCREW_TERMINAL_3 = createScrewTerminal(3);

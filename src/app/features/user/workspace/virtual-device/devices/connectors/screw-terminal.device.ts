import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { u, UNITS_PER_MM } from '../core/device-metrics';
import { OUTLINE, PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { line, path, rect, repeat, type Shape } from '../core/device-shape';

/** KF301 blocks are on a 5 mm pitch — not the 2.54 mm of a pin header. */
const POLE_PITCH = u(5);
/** 10 mm body, plus 2 mm of solder pin below it. */
const BODY_TOP = u(1);
const BODY_HEIGHT = u(10);
const HEIGHT = u(12);

/**
 * Screw terminal block.
 *
 * A passthrough connector: each screw is one net, so its two sides bond
 * together. That makes it useful in simulation as a labelled junction — wire a
 * battery to one side and a load to the other and current flows through.
 */
function createScrewTerminal(poles: number): VirtualDevice {
  const width = poles * POLE_PITCH;
  const firstX = POLE_PITCH / 2;

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
      rect(0, BODY_TOP, width, BODY_HEIGHT, {
        rx: u(0.5),
        fill: '#1f6f4a',
        stroke: OUTLINE,
        strokeWidth: u(0.15),
      }),
      ...repeat(poles, { x: POLE_PITCH }, (_, x) => [
        // Wire entry funnel.
        path(
          `M ${x - u(1.6)} ${BODY_TOP + u(0.4)} L ${x + u(1.6)} ${BODY_TOP + u(0.4)}` +
            ` L ${x + u(1)} ${BODY_TOP + u(2.4)} L ${x - u(1)} ${BODY_TOP + u(2.4)} Z`,
          { fill: '#17583b', detail: 'normal' },
        ),
        // Screw head with its slot.
        rect(x - u(1.5), BODY_TOP + u(3.4), u(3), u(3), {
          rx: u(0.25),
          fill: PART.metalLight,
          stroke: PART.metalDark,
          strokeWidth: u(0.12),
        }),
        line(x - u(1), BODY_TOP + u(4.9), x + u(1), BODY_TOP + u(4.9), {
          stroke: '#5a616b',
          strokeWidth: u(0.25),
          detail: 'normal',
        }),
        // Solder pin stub.
        rect(x - u(0.3), BODY_TOP + BODY_HEIGHT - u(0.4), u(0.6), u(1.4), {
          fill: PART.metal,
          detail: 'normal',
        }),
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
    // One 5 mm pole per screw, so the block grows exactly as the real one does.
    physicalSize: { widthMm: width / UNITS_PER_MM, heightMm: HEIGHT / UNITS_PER_MM },
    initiallyVisible: false,
    interfaces: ['passive'],
    pins,
    render: { draw },
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

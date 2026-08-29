import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { path, rect, text, type Shape } from '../core/device-shape';

/**
 * TO-92: a 4.7 × 4.5 mm half-round package on three legs. The legs leave the
 * package at 1.27 mm and are formed out to 2.54 mm, which is the spacing
 * everything in this catalog plugs into.
 */
const BODY = bodyFromMm({ widthMm: 6.5, heightMm: 11 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CX = WIDTH / 2;
const BODY_TOP = u(0.5);
const BODY_BOTTOM = u(5);
const PIN_START_X = CX - HEADER_PITCH;

type Polarity = 'npn' | 'pnp';

/**
 * TO-92 bipolar transistor.
 *
 * The two polarities share a package and a pinout (E-B-C, flat facing you);
 * only the emitter arrow direction differs. Modelling the switching action
 * needs a current model this simulator does not have, so the part is drawn and
 * wired accurately and left for firmware/behaviour work to animate later.
 */
function createTransistor(polarity: Polarity, model: string): VirtualDevice {
  function draw(_context: DeviceDrawContext): readonly Shape[] {
    return [
      // Three legs, splaying from the package to the 0.1 in grid.
      ...[0, 1, 2].map((index) =>
        path(
          `M ${CX + (index - 1) * u(1.27)} ${BODY_BOTTOM - u(0.3)}` +
            ` L ${PIN_START_X + index * HEADER_PITCH} ${u(7)}` +
            ` L ${PIN_START_X + index * HEADER_PITCH} ${HEIGHT}`,
          {
            fill: 'none',
            stroke: PART.metal,
            strokeWidth: u(0.4),
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
        ),
      ),
      // Half-round black body: domed back, flat face forward.
      path(
        `M ${CX - u(2.35)} ${BODY_BOTTOM}` +
          ` V ${BODY_TOP + u(2.35)}` +
          ` A ${u(2.35)} ${u(2.35)} 0 0 1 ${CX + u(2.35)} ${BODY_TOP + u(2.35)}` +
          ` V ${BODY_BOTTOM} Z`,
        { fill: PART.icBlack, stroke: OUTLINE, strokeWidth: u(0.15) },
      ),
      // The moulded flat, which is how you read the pinout in hand.
      path(`M ${CX - u(2.35)} ${BODY_BOTTOM - u(0.5)} H ${CX + u(2.35)}`, {
        fill: 'none',
        stroke: PART.icShine,
        strokeWidth: u(0.12),
        detail: 'normal',
      }),
      text(CX, BODY_TOP + u(2.4), model, {
        size: u(0.9),
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
      text(CX, BODY_TOP + u(3.6), polarity.toUpperCase(), {
        size: u(0.8),
        fill: SILK.dim,
        anchor: 'middle',
        weight: 700,
        mono: true,
        detail: 'high',
      }),
      // E / B / C markers.
      ...['E', 'B', 'C'].map((label, index) =>
        text(PIN_START_X + index * HEADER_PITCH, HEIGHT - u(0.2), label, {
          size: u(0.9),
          fill: '#6b7280',
          anchor: 'middle',
          weight: 700,
          mono: true,
          detail: 'normal',
        }),
      ),
    ];
  }

  return {
    id: `transistor-${polarity}`,
    name: `${polarity.toUpperCase()} transistor`,
    model,
    description:
      polarity === 'npn'
        ? 'Low-side switch: a small base current lets collector current flow to the emitter.'
        : 'High-side switch: pulling the base low lets current flow from emitter to collector.',
    x: 340,
    y: 720,
    ...BODY,
    initiallyVisible: false,
    interfaces: ['analog'],
    pins: [
      pin('E', PIN_START_X, HEIGHT, polarity === 'npn' ? 'gnd' : 'vcc', {
        side: 'bottom',
        description: 'Emitter',
      }),
      pin('B', PIN_START_X + HEADER_PITCH, HEIGHT, 'digital', {
        side: 'bottom',
        direction: 'input',
        description: 'Base — the control terminal, drive through a resistor',
      }),
      pin('C', PIN_START_X + HEADER_PITCH * 2, HEIGHT, 'passive', {
        side: 'bottom',
        description: 'Collector — switches the load',
      }),
    ],
    render: { draw },
    catalog: {
      categoryId: 'analog',
      category: 'Analog',
      aliases: ['transistor', model.toLowerCase(), polarity, 'ทรานซิสเตอร์', 'switch'],
      tags: ['transistor', 'bjt', polarity, 'switch', 'amplifier', 'analog', 'to-92'],
      interfaceLabel: 'ทรานซิสเตอร์ · 3 ขา',
      typicalUsage: 'Switching loads too heavy for a GPIO, and small-signal amplification.',
    },
  };
}

export const TRANSISTOR_NPN = createTransistor('npn', '2N2222');
export const TRANSISTOR_PNP = createTransistor('pnp', '2N2907');

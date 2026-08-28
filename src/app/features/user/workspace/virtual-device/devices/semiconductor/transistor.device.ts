import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { path, rect, text, type Shape } from '../core/device-shape';

const WIDTH = 96;
const HEIGHT = 118;
const CX = WIDTH / 2;
const PIN_START_X = CX - PIN_PITCH;

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
      // Three legs.
      ...[0, 1, 2].map((index) =>
        rect(PIN_START_X + index * PIN_PITCH - 2, 66, 4, HEIGHT - 66, {
          fill: PART.metal,
          detail: 'normal',
        }),
      ),
      // Half-round black body with the flat face forward.
      path(
        `M 16 66 A ${CX - 16} ${CX - 16} 0 0 1 ${WIDTH - 16} 66 L ${WIDTH - 16} 70 L 16 70 Z`,
        { fill: PART.icBlack, stroke: OUTLINE, strokeWidth: 1.5 },
      ),
      rect(16, 24, WIDTH - 32, 44, {
        rx: 4,
        fill: PART.icBlack,
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      text(CX, 44, model, {
        size: 8.5,
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
      text(CX, 56, polarity.toUpperCase(), {
        size: 7.5,
        fill: SILK.dim,
        anchor: 'middle',
        weight: 700,
        mono: true,
        detail: 'high',
      }),
      // E / B / C markers.
      ...['E', 'B', 'C'].map((label, index) =>
        text(PIN_START_X + index * PIN_PITCH, HEIGHT - 2, label, {
          size: 8,
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
    width: WIDTH,
    height: HEIGHT,
    initiallyVisible: false,
    interfaces: ['analog'],
    pins: [
      pin('E', PIN_START_X, HEIGHT, polarity === 'npn' ? 'gnd' : 'vcc', {
        side: 'bottom',
        description: 'Emitter',
      }),
      pin('B', PIN_START_X + PIN_PITCH, HEIGHT, 'digital', {
        side: 'bottom',
        direction: 'input',
        description: 'Base — the control terminal, drive through a resistor',
      }),
      pin('C', PIN_START_X + PIN_PITCH * 2, HEIGHT, 'passive', {
        side: 'bottom',
        description: 'Collector — switches the load',
      }),
    ],
    render: { draw, bleed: { bottom: 6 } },
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

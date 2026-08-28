import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART } from '../core/device-palette';
import { PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, ellipse, line, path, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';

const WIDTH = 118;
const DOME_CY = 56;
const DOME_R = 40;
const HEIGHT = 150;
const CENTER_X = WIDTH / 2;
/** Four legs at 0.1 in; the longest is the common pin on a real package. */
const PIN_START_X = CENTER_X - PIN_PITCH * 1.5;

type Polarity = 'cathode' | 'anode';

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'red',
    label: 'Red',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 255,
    step: 1,
    group: 'simulation',
    description: 'PWM duty on the red die.',
  },
  {
    id: 'green',
    label: 'Green',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 255,
    step: 1,
    group: 'simulation',
  },
  {
    id: 'blue',
    label: 'Blue',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 255,
    step: 1,
    group: 'simulation',
  },
];

/**
 * Mixes the three dies into one emitted colour.
 *
 * Brightness is tracked separately from hue: at low duty the dome should dim
 * rather than drift toward black, which is what a naive rgb() would do.
 */
export function mixRgb(red: number, green: number, blue: number): { color: string; level: number } {
  const peak = Math.max(red, green, blue);
  if (peak === 0) return { color: '#5b6068', level: 0 };
  const scale = 255 / peak;
  return {
    color: `rgb(${Math.round(red * scale)}, ${Math.round(green * scale)}, ${Math.round(
      blue * scale,
    )})`,
    level: peak / 255,
  };
}

function createRgbLed(polarity: Polarity): VirtualDevice {
  const commonLabel = polarity === 'cathode' ? 'CATH' : 'ANODE';
  const commonType = polarity === 'cathode' ? ('gnd' as const) : ('vcc' as const);

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const red = numberState(context, 'red', 0);
    const green = numberState(context, 'green', 0);
    const blue = numberState(context, 'blue', 0);
    const { color, level } = mixRgb(red, green, blue);
    const lit = level > 0.02 && context.running;

    return [
      // Legs — the common one is drawn longer, as on the real part.
      ...[0, 1, 2, 3].map((index) =>
        line(
          PIN_START_X + index * PIN_PITCH,
          DOME_CY + 34,
          PIN_START_X + index * PIN_PITCH,
          index === 1 ? HEIGHT : HEIGHT - 14,
          { stroke: PART.metal, strokeWidth: 4, strokeLinecap: 'round' },
        ),
      ),

      // Soft halo, only while lit and never strong enough to wash out wires.
      ...(lit
        ? [circle(CENTER_X, DOME_CY, DOME_R + 26, { fill: color, opacity: 0.16 * level })]
        : []),

      // Water-clear dome.
      path(
        `M ${CENTER_X - DOME_R} ${DOME_CY + 30}
         V ${DOME_CY} a ${DOME_R} ${DOME_R} 0 0 1 ${DOME_R * 2} 0
         V ${DOME_CY + 30} z`,
        {
          fill: lit ? color : '#c9ced6',
          opacity: lit ? Math.max(0.45, level) : 0.75,
          stroke: OUTLINE,
          strokeWidth: 1.5,
        },
      ),

      // Flange that marks the flat side of the package.
      ellipse(CENTER_X, DOME_CY + 30, DOME_R + 5, 8, {
        fill: lit ? color : '#b9c0c9',
        opacity: lit ? 0.6 : 0.9,
        stroke: OUTLINE,
        strokeWidth: 1.25,
      }),

      // The three dies, visible through the clear body.
      circle(CENTER_X - 15, DOME_CY + 4, 6, { fill: red > 0 ? '#ff4d4d' : '#8a3a3a', detail: 'normal' }),
      circle(CENTER_X, DOME_CY - 6, 6, { fill: green > 0 ? '#4dff88' : '#356b45', detail: 'normal' }),
      circle(CENTER_X + 15, DOME_CY + 4, 6, { fill: blue > 0 ? '#5599ff' : '#33507f', detail: 'normal' }),

      silkLabel(CENTER_X, HEIGHT - 2, commonLabel, {
        size: 9,
        fill: '#6b7280',
        detail: 'high',
      }),
    ];
  }

  return {
    id: `rgb-led-common-${polarity}`,
    name: `RGB LED (common ${polarity})`,
    model: `5 mm RGB · common ${polarity}`,
    description: `Three dies in one package sharing a common ${polarity}. Mix colour with PWM.`,
    x: 380,
    y: 700,
    width: WIDTH,
    height: HEIGHT,
    initiallyVisible: false,
    operatingVoltage: { min: 2, max: 3.4, recommended: 3.3 },
    interfaces: ['pwm', 'digital'],
    pins: [
      pin('R', PIN_START_X, HEIGHT - 14, 'pwm', {
        side: 'bottom',
        description: 'Red die, needs its own series resistor',
      }),
      pin(commonLabel, PIN_START_X + PIN_PITCH, HEIGHT, commonType, {
        side: 'bottom',
        description:
          polarity === 'cathode' ? 'Common cathode, tie to GND' : 'Common anode, tie to VCC',
      }),
      pin('G', PIN_START_X + PIN_PITCH * 2, HEIGHT - 14, 'pwm', {
        side: 'bottom',
        description: 'Green die, needs its own series resistor',
      }),
      pin('B', PIN_START_X + PIN_PITCH * 3, HEIGHT - 14, 'pwm', {
        side: 'bottom',
        description: 'Blue die, needs its own series resistor',
      }),
    ],
    properties: PROPERTIES,
    render: { draw, bleed: { left: 26, right: 26 } },
    requiresSeriesResistor: true,
    catalog: {
      categoryId: 'leds',
      category: 'LEDs',
      aliases: ['rgb led', 'colour led', 'ไฟ RGB', `common ${polarity}`],
      tags: ['rgb', 'led', 'pwm', 'colour', 'output', 'light', polarity],
      interfaceLabel: 'PWM ×3 · 4 ขา',
      typicalUsage: 'Status colour coding, mood lighting, and colour-mixing demos.',
    },
  };
}

export const RGB_LED_COMMON_CATHODE = createRgbLed('cathode');
export const RGB_LED_COMMON_ANODE = createRgbLed('anode');

/**
 * Each die is an independent LED sharing one common leg. The polarity decides
 * which way current flows, so a common-anode part lights on a *low* channel —
 * getting this backwards is the classic RGB wiring mistake, and the simulation
 * reproduces it rather than hiding it.
 */
function createRgbBehavior(polarity: Polarity): DeviceBehavior {
  const commonLabel = polarity === 'cathode' ? 'CATH' : 'ANODE';

  return {
    update(context) {
      const common = context.readNode(commonLabel);
      for (const [channel, forward] of [
        ['R', 1.8],
        ['G', 2.1],
        ['B', 3.0],
      ] as const) {
        const node = context.readNode(channel);
        if (node.floating || common.floating) {
          context.emit(channelKey(channel), 0);
          continue;
        }
        const across =
          polarity === 'cathode' ? node.voltage - common.voltage : common.voltage - node.voltage;
        const level = across <= forward ? 0 : Math.min((across - forward) / 1.2, 1);
        context.emit(channelKey(channel), Math.round(level * 255));
      }
    },
  };
}

function channelKey(channel: 'R' | 'G' | 'B'): string {
  return channel === 'R' ? 'red' : channel === 'G' ? 'green' : 'blue';
}

RGB_LED_COMMON_CATHODE.simulation = () => createRgbBehavior('cathode');
RGB_LED_COMMON_ANODE.simulation = () => createRgbBehavior('anode');

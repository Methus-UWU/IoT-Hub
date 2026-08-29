import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, ellipse, line, path, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';

/**
 * A 5 mm RGB package is the same T-1¾ body as a single-colour LED, but its four
 * legs on 0.1 in pitch span 7.62 mm — which is what sets the drawn width. The
 * body cannot be narrower than its own lead frame.
 */
const BODY = bodyFromMm({ widthMm: 8.6, heightMm: 14 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTER_X = WIDTH / 2;
/** Dome: 5 mm across, shoulder where the straight sides begin. */
const DOME_R = u(2.5);
const DOME_CY = u(3.4);
const FLANGE_Y = u(8.6);
/** Four legs at 0.1 in; the second is the common pin on a real package. */
const PIN_START_X = CENTER_X - HEADER_PITCH * 1.5;
/** Short legs stop above the common one, as the real lead frame is cut. */
const SHORT_LEG_Y = HEIGHT - u(1.6);

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
          PIN_START_X + index * HEADER_PITCH,
          FLANGE_Y,
          PIN_START_X + index * HEADER_PITCH,
          index === 1 ? HEIGHT : SHORT_LEG_Y,
          { stroke: PART.metal, strokeWidth: u(0.45), strokeLinecap: 'round' },
        ),
      ),

      // Soft halo, only while lit and never strong enough to wash out wires.
      ...(lit
        ? [circle(CENTER_X, DOME_CY, DOME_R + u(2.6), { fill: color, opacity: 0.16 * level })]
        : []),

      // Water-clear dome.
      path(
        `M ${CENTER_X - DOME_R} ${FLANGE_Y}` +
          ` V ${DOME_CY} a ${DOME_R} ${DOME_R} 0 0 1 ${DOME_R * 2} 0` +
          ` V ${FLANGE_Y} z`,
        {
          fill: lit ? color : '#c9ced6',
          opacity: lit ? Math.max(0.45, level) : 0.75,
          stroke: OUTLINE,
          strokeWidth: u(0.15),
        },
      ),

      // Flange that marks the flat side of the package.
      ellipse(CENTER_X, FLANGE_Y, DOME_R + u(0.4), u(0.45), {
        fill: lit ? color : '#b9c0c9',
        opacity: lit ? 0.6 : 0.9,
        stroke: OUTLINE,
        strokeWidth: u(0.13),
      }),

      // The three dies, visible through the clear body.
      circle(CENTER_X - u(1.1), DOME_CY + u(0.5), u(0.55), {
        fill: red > 0 ? '#ff4d4d' : '#8a3a3a',
        detail: 'normal',
      }),
      circle(CENTER_X, DOME_CY - u(0.7), u(0.55), {
        fill: green > 0 ? '#4dff88' : '#356b45',
        detail: 'normal',
      }),
      circle(CENTER_X + u(1.1), DOME_CY + u(0.5), u(0.55), {
        fill: blue > 0 ? '#5599ff' : '#33507f',
        detail: 'normal',
      }),

      silkLabel(CENTER_X, HEIGHT - u(0.2), commonLabel, {
        size: u(0.85),
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
    ...BODY,
    initiallyVisible: false,
    operatingVoltage: { min: 2, max: 3.4, recommended: 3.3 },
    interfaces: ['pwm', 'digital'],
    pins: [
      pin('R', PIN_START_X, SHORT_LEG_Y, 'pwm', {
        side: 'bottom',
        description: 'Red die, needs its own series resistor',
      }),
      pin(commonLabel, PIN_START_X + HEADER_PITCH, HEIGHT, commonType, {
        side: 'bottom',
        description:
          polarity === 'cathode' ? 'Common cathode, tie to GND' : 'Common anode, tie to VCC',
      }),
      pin('G', PIN_START_X + HEADER_PITCH * 2, SHORT_LEG_Y, 'pwm', {
        side: 'bottom',
        description: 'Green die, needs its own series resistor',
      }),
      pin('B', PIN_START_X + HEADER_PITCH * 3, SHORT_LEG_Y, 'pwm', {
        side: 'bottom',
        description: 'Blue die, needs its own series resistor',
      }),
    ],
    properties: PROPERTIES,
    render: { draw, bleed: { left: u(2), right: u(2), top: u(1.5) } },
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

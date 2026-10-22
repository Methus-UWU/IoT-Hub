import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PART } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, ellipse, path, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';
import { pulsedLedBrightness } from './led.device';

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
const FLANGE_Y = u(8.6);
/**
 * The epoxy is the same T-1¾ as the single-colour LED: 8.6 mm of package over a
 * 5 mm dome, so the barrel is about twice the height of the hemisphere capping
 * it. Deriving the shoulder from that height rather than fixing it is what keeps
 * the part slender instead of reading as a squat blob.
 */
const BODY_HEIGHT = u(8.6);
const DOME_SHOULDER_Y = FLANGE_Y - BODY_HEIGHT + DOME_R;
/** The dies sit low in the package, a couple of millimetres above the flange —
 * which is where the reflector cup around them is drawn. */
const DIE_Y = FLANGE_Y - u(2.8);
/** Four legs at 0.1 in; the second is the common pin on a real package. */
const PIN_START_X = CENTER_X - HEADER_PITCH * 1.5;
/** Leads emerge beneath the 5 mm body before spreading to 0.1-inch pitch. */
const LEAD_EXIT_PITCH = u(1.45);
const LEAD_EXIT_START_X = CENTER_X - LEAD_EXIT_PITCH * 1.5;
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

/** Unlit epoxy: the package is water-clear, so it reads as grey glass. */
const CLEAR_TONE = { color: '#c9ced6', edge: '#9aa2ad' };

/**
 * Mixes the three dies into one emitted colour.
 *
 * Brightness is tracked separately from hue: at low duty the dome should dim
 * rather than drift toward black, which is what a naive rgb() would do. The
 * edge tone is the same mix at 55%, so the outline and reflector cup shade with
 * the colour instead of staying a fixed grey against a saturated body.
 */
export function mixRgb(
  red: number,
  green: number,
  blue: number,
): { color: string; edge: string; level: number } {
  const peak = Math.max(red, green, blue);
  if (peak === 0) return { ...CLEAR_TONE, level: 0 };
  const scale = 255 / peak;
  const [r, g, b] = [red, green, blue].map((channel) => Math.round(channel * scale));
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    edge: `rgb(${Math.round(r * 0.55)}, ${Math.round(g * 0.55)}, ${Math.round(b * 0.55)})`,
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
    const { color, edge, level } = mixRgb(red, green, blue);
    const lit = level > 0.02 && context.running;

    return [
      // Legs — the common one is drawn longer, as on the real part.
      ...[0, 1, 2, 3].map((index) => {
        const exitX = LEAD_EXIT_START_X + index * LEAD_EXIT_PITCH;
        const pinX = PIN_START_X + index * HEADER_PITCH;
        const endY = index === 1 ? HEIGHT : SHORT_LEG_Y;
        return path(
          `M ${exitX} ${FLANGE_Y - u(0.2)}` +
            ` C ${exitX} ${FLANGE_Y + u(0.7)}, ${pinX} ${FLANGE_Y + u(0.9)}, ${pinX} ${FLANGE_Y + u(1.8)}` +
            ` V ${endY}`,
          {
            fill: 'none',
            stroke: PART.metal,
            strokeWidth: u(0.45),
            strokeLinecap: 'round',
          },
        );
      }),

      // Soft halo, only while lit and never strong enough to wash out wires.
      ...(lit
        ? [
            circle(CENTER_X, DOME_SHOULDER_Y, DOME_R + u(2.6), {
              fill: color,
              opacity: 0.16 * level,
            }),
          ]
        : []),

      // Epoxy dome, tinted by the mixed colour so the package reads as one
      // coloured lamp instead of three dots behind clear plastic.
      path(
        `M ${CENTER_X - DOME_R} ${FLANGE_Y}` +
          ` V ${DOME_SHOULDER_Y} a ${DOME_R} ${DOME_R} 0 0 1 ${DOME_R * 2} 0` +
          ` V ${FLANGE_Y} z`,
        {
          fill: color,
          opacity: lit ? 0.88 + level * 0.12 : 0.75,
          stroke: edge,
          strokeWidth: u(0.15),
        },
      ),

      // Flange that marks the flat side of the package.
      ellipse(CENTER_X, FLANGE_Y, DOME_R + u(0.4), u(0.45), {
        fill: color,
        opacity: lit ? 1 : 0.88,
        stroke: edge,
        strokeWidth: u(0.13),
      }),

      // Reflector cup and a highlight down the near face — the same pair of
      // marks that gives the single-colour LED its moulded look.
      path(
        `M ${CENTER_X + u(0.2)} ${DIE_Y - u(1.6)} l ${u(1)} ${u(0.9)}` +
          ` v ${u(2.6)} l ${-u(1)} ${u(0.6)} z`,
        {
          fill: edge,
          opacity: lit ? 0.3 : 0.42,
          detail: 'normal',
        },
      ),
      path(`M ${CENTER_X - u(0.8)} ${DOME_SHOULDER_Y} V ${FLANGE_Y - u(1.2)}`, {
        fill: 'none',
        stroke: '#ffffff',
        strokeWidth: u(0.22),
        strokeLinecap: 'round',
        opacity: lit ? 0.72 : 0.48,
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
    variants: {
      label: 'ขาร่วม',
      options: [
        { deviceId: 'rgb-led-common-cathode', label: 'แคโทดร่วม (−)' },
        { deviceId: 'rgb-led-common-anode', label: 'แอโนดร่วม (+)' },
      ],
    },
    render: { draw, bleed: { left: u(2), right: u(2), top: u(3) } },
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
        // Same physics as a single LED, PWM included: a common-cathode die is fed
        // by its channel pin, a common-anode die is sunk by it.
        const level =
          polarity === 'cathode'
            ? pulsedLedBrightness(node, common, forward)
            : pulsedLedBrightness(common, node, forward);
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

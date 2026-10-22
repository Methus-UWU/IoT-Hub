import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { rotaryHotspot } from '../core/device-hotspots';
import { PART, WOKWI } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, group, line, path, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, propertyString, type DeviceBehavior } from '../core/device-simulation';

/**
 * Wokwi-style potentiometer module: a square blue breakout with a large grey
 * rotary knob, four plated mounting holes, and a three-pin header.
 *
 * Sized as the breakout it draws rather than as the bare 13 mm pot it carries:
 * the artwork has mounting holes and a 0.1 in header, which only exist on the
 * module, and at the board's real 24 mm the knob is finally large enough to
 * grab with a pointer.
 */
const BODY = bodyFromMm({ widthMm: 24, heightMm: 26 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTER_X = WIDTH / 2;
const CENTER_Y = u(11);
const KNOB_R = u(8);
const PIN_SPACING = HEADER_PITCH;
const PIN_START_X = CENTER_X - PIN_SPACING;
/** Where each pin ends: clear of the 26 mm board, so the tip is solderable metal. */
const PIN_TIP_Y = u(28.4);
const PIN_RADIUS = u(0.28);
/** The moulded shroud the pins leave through, hugging the bottom edge. */
const HEADER_TOP = u(22.6);
const HEADER_HEIGHT = u(2.5);
const PIN_XS: readonly number[] = [0, 1, 2].map((index) => PIN_START_X + index * PIN_SPACING);

/** Rotation limits of a standard single-turn pot, in degrees from vertical. */
const SWEEP = 135;

/** ESP32 ADC full scale: 12 bits across the 3.3 V rail. */
const ADC_FULL_SCALE = 4095;
/** A pot is shipped and placed turned right down, so a fresh part reads zero. */
const ADC_REST = 0;
const ADC_REFERENCE_VOLTS = 3.3;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'wiper',
    label: 'Wiper',
    kind: 'number',
    defaultValue: ADC_REST,
    min: 0,
    max: ADC_FULL_SCALE,
    step: 1,
    unit: 'counts',
    group: 'simulation',
    description: 'Shaft travel, counted the way analogRead reports it: 0 - 4095.',
  },
  {
    id: 'resistance',
    label: 'Total resistance',
    kind: 'number',
    defaultValue: 10_000,
    min: 100,
    max: 1_000_000,
    step: 100,
    unit: 'Ω',
    group: 'electrical',
  },
  {
    id: 'taper',
    label: 'Taper',
    kind: 'select',
    defaultValue: 'linear',
    group: 'electrical',
    options: [
      { value: 'linear', label: 'Linear (B)' },
      { value: 'log', label: 'Log (A)' },
    ],
  },
];

/**
 * What `analogRead` would return for a wiper sitting at this voltage.
 *
 * Derived from the voltage rather than from the knob angle, so an unpowered or
 * half-wired divider reads what it really produces — turning the shaft on a pot
 * whose VCC is not connected moves nothing, exactly as on the bench.
 */
export function adcCounts(volts: number): number {
  const ratio = Math.min(Math.max(volts / ADC_REFERENCE_VOLTS, 0), 1);
  return Math.round(ratio * ADC_FULL_SCALE);
}

/** Shaft travel as a 0-1 fraction, from the ADC count the wiper is set to. */
export function wiperTravel(counts: number): number {
  return Math.min(Math.max(counts, 0), ADC_FULL_SCALE) / ADC_FULL_SCALE;
}

/** Wiper resistance for a given setting, honouring the taper curve. */
export function wiperResistance(total: number, counts: number, taper: string): number {
  const travel = wiperTravel(counts);
  const curve = taper === 'log' ? travel ** 2.5 : travel;
  return total * curve;
}

/** Mounting-hole geometry: the drilled bore, and the pad ring around it. */
const HOLE_BORE = u(0.74);
const HOLE_PAD = u(0.56);
const HOLE_CENTRES: readonly (readonly [number, number])[] = [
  [u(2.4), u(2.4)],
  [WIDTH - u(2.4), u(2.4)],
  [u(2.4), HEIGHT - u(2.4)],
  [WIDTH - u(2.4), HEIGHT - u(2.4)],
];

/** A rounded rectangle as path data, so holes can be cut out of it. */
function roundedRectPath(x: number, y: number, width: number, height: number, r: number): string {
  const right = x + width;
  const bottom = y + height;
  return [
    `M ${x + r} ${y}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/** A full circle as one subpath, for use as an `evenodd` cut-out. */
function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const angle = -SWEEP + wiperTravel(numberState(context, 'wiper', ADC_REST)) * SWEEP * 2;

  return [
    // The board is drawn as one path with the mounting holes as counter-wound
    // subpaths, so `evenodd` leaves them genuinely unpainted. Nothing else
    // punches a hole through a filled shape: a disc of canvas colour sitting on
    // top would hide the ESP32 the moment this part was dragged over it.
    path(
      [
        roundedRectPath(0, 0, WIDTH, HEIGHT, u(0.65)),
        ...HOLE_CENTRES.map(([cx, cy]) => circlePath(cx, cy, HOLE_BORE)),
      ].join(' '),
      { fill: WOKWI.board, fillRule: 'evenodd' },
    ),
    // The outline is a separate shape: stroking the path above would paint the
    // board edge around the inside of every bore as well.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.65),
      fill: 'none',
      stroke: WOKWI.boardEdge,
      strokeWidth: u(0.4),
    }),
    rect(u(0.5), u(0.5), WIDTH - u(1), HEIGHT - u(1), {
      rx: u(0.4),
      fill: 'none',
      stroke: WOKWI.boardTrace,
      strokeWidth: u(0.18),
      detail: 'normal',
    }),
    // The pad ring around each bore, covering the raw cut edge. Bare metal, not
    // silkscreen white: it is the plating a mounting screw bears against.
    ...HOLE_CENTRES.map(([cx, cy]) =>
      circle(cx, cy, HOLE_BORE + HOLE_PAD / 2, {
        fill: 'none',
        stroke: PART.metal,
        strokeWidth: HOLE_PAD,
      }),
    ),

    circle(CENTER_X, CENTER_Y, KNOB_R, {
      fill: WOKWI.knob,
      stroke: WOKWI.knobEdge,
      strokeWidth: u(0.75),
    }),
    // The pointer is drawn up the -y axis, so mid travel reads as "straight up"
    // the way a real single-turn shaft does, and `angle` is then simply degrees
    // clockwise from that rest position.
    group(
      [
        line(0, -u(1.2), 0, -u(6.6), {
          stroke: WOKWI.indicator,
          strokeWidth: u(0.5),
          strokeLinecap: 'round',
        }),
      ],
      { transform: `translate(${CENTER_X} ${CENTER_Y}) rotate(${angle})` },
    ),

    ...['GND', 'SIG', 'VCC'].map((label, index) =>
      text(PIN_XS[index], HEADER_TOP - u(0.7), label, {
        size: u(1.15),
        fill: WOKWI.label,
        anchor: 'middle',
        weight: 700,
        mono: true,
        detail: 'normal',
      }),
    ),
    // A moulded 0.1 in header, drawn the way the comparator modules draw theirs:
    // a black shroud, a gold pad per way, and a tinned lead standing out past
    // the board edge. The lead is what a wire lands on, so the connection point
    // is metal a person can see rather than a circle painted on the board.
    rect(PIN_XS[0] - u(1.25), HEADER_TOP, PIN_SPACING * 2 + u(2.5), HEADER_HEIGHT, {
      rx: u(0.2),
      fill: PART.headerPlastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.1),
    }),
    ...PIN_XS.flatMap((pinX) => [
      rect(pinX - u(0.45), HEADER_TOP + HEADER_HEIGHT / 2 - u(0.45), u(0.9), u(0.9), {
        rx: u(0.08),
        fill: PART.headerGold,
        stroke: PART.headerGoldDark,
        strokeWidth: u(0.08),
        detail: 'normal',
      }),
      rect(
        pinX - PIN_RADIUS,
        HEADER_TOP + HEADER_HEIGHT,
        PIN_RADIUS * 2,
        PIN_TIP_Y - HEADER_TOP - HEADER_HEIGHT,
        {
          rx: u(0.18),
          fill: PART.metal,
          stroke: PART.metalDark,
          strokeWidth: u(0.06),
        },
      ),
    ]),
  ];
}

/** Single-turn rotary potentiometer wired as a three-terminal divider. */
export const POTENTIOMETER: VirtualDevice = {
  id: 'potentiometer',
  name: 'Potentiometer',
  model: 'RV09 10 kΩ',
  description: 'Rotary voltage divider. The wiper reads between the two end terminals.',
  x: 520,
  y: 640,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  interfaces: ['analog', 'passive'],
  pins: [
    pin('1', PIN_XS[0], PIN_TIP_Y, 'passive', {
      side: 'bottom',
      description: 'End terminal, commonly tied to GND',
    }),
    pin('WIPER', PIN_XS[1], PIN_TIP_Y, 'analog', {
      side: 'bottom',
      direction: 'output',
      description: 'Wiper output, feed this to an ADC pin',
    }),
    pin('3', PIN_XS[2], PIN_TIP_Y, 'passive', {
      side: 'bottom',
      description: 'End terminal, commonly tied to VCC',
    }),
  ],
  properties: PROPERTIES,
  readings: [
    {
      id: 'adc',
      label: 'ADC reading',
      unit: 'counts',
      description: '12-bit ESP32 scale: 0 – 4095 across 3.3 V.',
    },
    { id: 'wiperVolts', label: 'Wiper voltage', unit: 'V' },
  ],
  // The knob cap is the grip: dragging it turns the shaft, exactly as the
  // Wiper field in the inspector does.
  hotspots: [
    rotaryHotspot('shaft', 'Turn the potentiometer', 'wiper', CENTER_X, CENTER_Y, KNOB_R, {
      sweep: SWEEP,
      range: { min: 0, max: ADC_FULL_SCALE },
    }),
  ],
  render: { draw, bleed: { bottom: PIN_TIP_Y - HEIGHT + u(0.4) } },
  catalog: {
    categoryId: 'input-devices',
    category: 'Input Devices',
    aliases: ['pot', 'potentiometer', 'variable resistor', 'ตัวต้านทานปรับค่า', 'knob'],
    tags: ['potentiometer', 'analog', 'input', 'divider', 'knob', 'variable', 'adc'],
    interfaceLabel: 'แอนะล็อก · 3 ขา',
    typicalUsage: 'Volume and brightness control, calibration, and analog test inputs.',
  },
};

/**
 * The wiper sits between the two end terminals, so its voltage is the terminal
 * voltages interpolated by travel — this is a divider, not a source. It drives
 * weakly so anything actually driving that net still wins.
 *
 * Reading its own inputs before driving is exactly why the solver relaxes
 * drive+resolve rather than running it once.
 */
function createPotentiometerBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const low = context.readNode('1');
      const high = context.readNode('3');
      if (low.floating && high.floating) return;

      const travel = wiperTravel(propertyNumber(context, 'wiper', ADC_REST));
      const taper = propertyString(context, 'taper', 'linear');
      const curve = taper === 'log' ? travel ** 2.5 : travel;
      const lowVolts = low.floating ? 0 : low.voltage;
      const highVolts = high.floating ? 0 : high.voltage;

      context.drive('WIPER', lowVolts + (highVolts - lowVolts) * curve, 'weak');
    },
    update(context) {
      const wiper = context.readNode('WIPER');
      const volts = wiper.floating ? 0 : wiper.voltage;
      context.emit('wiperVolts', Math.round(volts * 100) / 100);
      context.emit('adc', adcCounts(volts));
    },
  };
}

POTENTIOMETER.simulation = createPotentiometerBehavior;

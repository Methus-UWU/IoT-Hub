import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { rectHotspot } from '../core/device-hotspots';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, rect, text, type Shape } from '../core/device-shape';
import {
  propertyBoolean,
  propertyString,
  requiresSupply,
  type DeviceBehavior,
} from '../core/device-simulation';

/**
 * TTP223 capacitive touch module.
 *
 * It replaces a button without any moving part: the copper pad on top is one
 * plate of a capacitor and a finger is the other. The chip supports momentary
 * and toggle behaviour, and kits ship it in momentary mode, so that is the
 * default here.
 */

const BODY = bodyFromMm({ widthMm: 15, heightMm: 11 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PAD = { x: u(2.2), y: u(2), width: u(7.4), height: u(7) };
const HEADER_X = WIDTH - u(1.3);
const HEADER_LEAD_END = WIDTH + u(4);
const HEADER_TOP = HEIGHT / 2 - HEADER_PITCH;

const PINS = [
  ['VCC', 'vcc', '2.0-5.5 V supply'],
  ['GND', 'gnd', 'Ground reference'],
  ['SIG', 'digital', 'High while the pad is touched'],
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'touched',
    label: 'Touched',
    kind: 'boolean',
    defaultValue: false,
    group: 'simulation',
    simulationOnly: true,
    description: 'A finger on the pad. Click the pad on the canvas to press it.',
  },
  {
    id: 'mode',
    label: 'Output mode',
    kind: 'select',
    defaultValue: 'momentary',
    group: 'general',
    description:
      'Momentary is high while touched; Toggle flips on each touch. Set on the real board by bridging the A and B solder jumpers.',
    options: [
      { value: 'momentary', label: 'Momentary' },
      { value: 'toggle', label: 'Toggle' },
    ],
  },
  {
    id: 'activeLow',
    label: 'Active low output',
    kind: 'boolean',
    defaultValue: false,
    group: 'general',
    description: 'Inverts SIG, matching a board with the B jumper bridged.',
  },
];

export function touchOutputHigh(touched: boolean, latched: boolean, mode: string): boolean {
  return mode === 'toggle' ? latched : touched;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const touched = booleanState(context, 'touched');
  const latched = booleanState(context, 'latched');
  const mode = stringState(context, 'mode', 'momentary');
  const asserted = touchOutputHigh(touched, latched, mode);

  return [
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.5),
      fill: '#1f4f8f',
      stroke: '#12325e',
      strokeWidth: u(0.18),
    }),
    // The copper touch pad, brighter while it is being touched.
    rect(PAD.x, PAD.y, PAD.width, PAD.height, {
      rx: u(0.6),
      fill: touched ? '#f0c674' : PART.copper,
      stroke: '#8a5c25',
      strokeWidth: u(0.16),
    }),
    rect(PAD.x + u(0.7), PAD.y + u(0.7), PAD.width - u(1.4), PAD.height - u(1.4), {
      rx: u(0.4),
      fill: 'none',
      stroke: '#a5701f',
      strokeWidth: u(0.12),
      opacity: 0.7,
      detail: 'normal',
    }),
    text(PAD.x + PAD.width / 2, PAD.y + PAD.height / 2 + u(0.4), 'TOUCH', {
      size: u(0.8),
      fill: '#4a2f0c',
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    // TTP223 chip and its indicator LED.
    rect(u(10.6), u(2.2), u(2.4), u(3), {
      rx: u(0.25),
      fill: '#20252d',
      stroke: OUTLINE,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    circle(u(11.8), u(8.4), u(0.85), {
      fill: context.running && booleanState(context, 'powered') && asserted ? '#5cf07d' : '#2d6b3c',
      stroke: '#1b3f24',
      strokeWidth: u(0.1),
    }),
    rect(HEADER_X - u(1.3), HEADER_TOP - HEADER_PITCH / 2, u(2.6), HEADER_PITCH * PINS.length, {
      rx: u(0.2),
      fill: '#171a1f',
      stroke: '#0b0d10',
      strokeWidth: u(0.1),
    }),
    ...PINS.flatMap(([name], index) => {
      const y = HEADER_TOP + index * HEADER_PITCH;
      return [
        rect(HEADER_X - u(0.45), y - u(0.45), u(0.9), u(0.9), {
          rx: u(0.08),
          fill: PART.headerGold,
          stroke: PART.headerGoldDark,
          strokeWidth: u(0.08),
        }),
        rect(HEADER_X, y - u(0.28), HEADER_LEAD_END - HEADER_X, u(0.56), {
          rx: u(0.18),
          fill: PART.metal,
          stroke: PART.metalDark,
          strokeWidth: u(0.06),
        }),
        text(HEADER_X - u(1.6), y + u(0.3), name, {
          size: u(0.7),
          fill: SILK.white,
          anchor: 'end',
          mono: true,
          weight: 700,
          detail: 'normal',
        }),
      ];
    }),
    text(u(2.4), HEIGHT - u(0.8), 'TTP223', {
      size: u(0.72),
      fill: SILK.dim,
      anchor: 'start',
      mono: true,
      detail: 'high',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  // Toggle mode has to remember the last flip, and it must flip on the touch
  // edge rather than every tick the finger stays down.
  let latched = false;
  let wasTouched = false;

  return {
    drive(context) {
      const touched = propertyBoolean(context, 'touched', false);
      const mode = propertyString(context, 'mode', 'momentary');
      const activeLow = propertyBoolean(context, 'activeLow', false);

      if (touched && !wasTouched) latched = !latched;
      wasTouched = touched;

      const asserted = touchOutputHigh(touched, latched, mode);
      context.drive('SIG', asserted !== activeLow ? 3.3 : 0, 'strong');
    },
    update(context) {
      const touched = propertyBoolean(context, 'touched', false);
      const mode = propertyString(context, 'mode', 'momentary');
      context.emit('latched', latched);
      context.emit('asserted', touchOutputHigh(touched, latched, mode));
    },
    reset() {
      latched = false;
      wasTouched = false;
    },
  };
}

export const TOUCH_SENSOR: VirtualDevice = {
  id: 'touch-sensor',
  name: 'Capacitive touch sensor',
  model: 'TTP223 module',
  description: 'Solid-state touch pad that replaces a push button, in momentary or toggle mode.',
  x: 1060,
  y: 150,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 2, max: 5.5, recommended: 3.3 },
  interfaces: ['digital', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, HEADER_LEAD_END, HEADER_TOP + index * HEADER_PITCH, type, {
      side: 'right',
      direction: name === 'SIG' ? 'output' : undefined,
      description,
      voltage: name === 'VCC' ? 3.3 : undefined,
    }),
  ),
  hotspots: [
    rectHotspot(
      'touch-pad',
      'Touch pad',
      'touched',
      { x: PAD.x, y: PAD.y, width: PAD.width, height: PAD.height, rx: u(0.6) },
      'momentary',
    ),
  ],
  properties: PROPERTIES,
  simulation: requiresSupply(createBehavior, { minimumVolts: 2 }),
  render: { draw, bleed: { right: u(4) } },
  catalog: {
    categoryId: 'input-devices',
    category: 'Input devices',
    aliases: ['touch sensor', 'ttp223', 'capacitive touch', 'เซนเซอร์สัมผัส', 'ปุ่มสัมผัส'],
    tags: ['touch', 'capacitive', 'ttp223', 'button', 'digital', 'input'],
    interfaceLabel: 'Digital · 3 pins',
    typicalUsage: 'Touch switches, lamp controls, and buttonless panels.',
  },
};

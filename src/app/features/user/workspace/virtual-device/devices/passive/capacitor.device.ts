import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, text, type Shape } from '../core/device-shape';

/** Formats farads the way a schematic labels them: pF / nF / µF. */
export function formatCapacitance(farads: number): string {
  if (farads >= 1e-6) return `${trim(farads / 1e-6)} µF`;
  if (farads >= 1e-9) return `${trim(farads / 1e-9)} nF`;
  return `${trim(farads / 1e-12)} pF`;
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}

// ------------------------------------------------------------- ceramic disc

/**
 * A 6 mm dipped disc on the 5.08 mm lead spacing these are supplied at. The legs
 * leave the body close together through the epoxy drip under the disc, then
 * bend out to the pitch — the kink is what makes it read as a real disc part.
 */
const CERAMIC_BODY = bodyFromMm({ widthMm: 7, heightMm: 11 });
const CERAMIC_W = CERAMIC_BODY.width;
const CERAMIC_H = CERAMIC_BODY.height;
const CERAMIC_CX = CERAMIC_W / 2;
const CERAMIC_LEAD_PITCH = u(5.08);
const CERAMIC_LEG_X0 = CERAMIC_CX - CERAMIC_LEAD_PITCH / 2;
const CERAMIC_DISC_CY = u(3.4);
const CERAMIC_DISC_R = u(3.1);
/** Where the legs leave the epoxy, and where the bend ends. */
const CERAMIC_LEG_EXIT_Y = u(7.4);
const CERAMIC_LEG_EXIT_HALF = u(0.75);
const CERAMIC_BEND_END_Y = u(9);
const CERAMIC_EDGE = '#8a5f22';

const CERAMIC_PROPS: readonly DevicePropertyDefinition[] = [
  {
    id: 'capacitance',
    label: 'Capacitance',
    kind: 'number',
    defaultValue: 1e-7,
    min: 1e-12,
    max: 1e-6,
    step: 1e-12,
    unit: 'F',
    group: 'electrical',
    description: 'Printed as a 3-digit code on the real part (104 = 100 nF).',
  },
];

function drawCeramic(context: DeviceDrawContext): readonly Shape[] {
  const farads = numberState(context, 'capacitance', 1e-7);
  return [
    // Legs: out of the epoxy side by side, bent out to the pitch, then straight.
    ...[-1, 1].map((side) => {
      const exitX = CERAMIC_CX + side * CERAMIC_LEG_EXIT_HALF;
      const pinX = CERAMIC_CX + (side * CERAMIC_LEAD_PITCH) / 2;
      return path(
        `M ${exitX} ${CERAMIC_LEG_EXIT_Y} L ${pinX} ${CERAMIC_BEND_END_Y} V ${CERAMIC_H}`,
        {
          fill: 'none',
          stroke: PART.metal,
          strokeWidth: u(0.45),
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
      );
    }),
    // The epoxy drip the disc was dipped through, tapering onto the legs.
    path(
      `M ${CERAMIC_CX - u(1.3)} ${u(6)} Q ${CERAMIC_CX - u(0.8)} ${u(7.9)} ${CERAMIC_CX} ${u(8)} ` +
        `Q ${CERAMIC_CX + u(0.8)} ${u(7.9)} ${CERAMIC_CX + u(1.3)} ${u(6)} Z`,
      {
        fill: PART.ceramicDisc,
        stroke: CERAMIC_EDGE,
        strokeWidth: u(0.15),
      },
    ),
    // Dipped ceramic disc.
    circle(CERAMIC_CX, CERAMIC_DISC_CY, CERAMIC_DISC_R, {
      fill: PART.ceramicDisc,
      stroke: CERAMIC_EDGE,
      strokeWidth: u(0.2),
    }),
    text(CERAMIC_CX, CERAMIC_DISC_CY + u(0.55), capCode(farads), {
      size: u(1.6),
      fill: '#3a2c12',
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
    text(CERAMIC_CX, CERAMIC_H + u(1.4), formatCapacitance(farads), {
      size: u(1.1),
      fill: '#6b7280',
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'high',
    }),
  ];
}

/** The 3-digit EIA marking, e.g. 100 nF → "104". */
function capCode(farads: number): string {
  const pf = farads / 1e-12;
  if (pf < 100) return String(Math.round(pf));
  const exponent = Math.floor(Math.log10(pf)) - 1;
  const significand = Math.round(pf / 10 ** exponent);
  return `${significand}${exponent}`;
}

export const CAPACITOR_CERAMIC: VirtualDevice = {
  id: 'capacitor-ceramic',
  name: 'Ceramic capacitor',
  model: 'Disc, non-polarised',
  description: 'Small non-polarised capacitor for decoupling and filtering.',
  x: 300,
  y: 720,
  ...CERAMIC_BODY,
  initiallyVisible: false,
  rotatable: true,
  interfaces: ['passive'],
  pins: [
    pin('1', CERAMIC_LEG_X0, CERAMIC_H, 'passive', { side: 'bottom' }),
    pin('2', CERAMIC_LEG_X0 + CERAMIC_LEAD_PITCH, CERAMIC_H, 'passive', { side: 'bottom' }),
  ],
  properties: CERAMIC_PROPS,
  render: { draw: drawCeramic, bleed: { bottom: u(2) } },
  catalog: {
    categoryId: 'passive-components',
    category: 'Passive Components',
    aliases: ['capacitor', 'ceramic cap', 'ตัวเก็บประจุ', 'decoupling'],
    tags: ['capacitor', 'ceramic', 'passive', 'decoupling', 'filter', 'non-polarised'],
    interfaceLabel: 'พาสซีฟ · 2 ขา',
    typicalUsage: 'Supply decoupling, high-frequency filtering, and timing networks.',
  },
};

// ------------------------------------------------------- electrolytic can

/** A 100 µF / 25 V radial can: 6.3 mm across, 11 mm tall, 2.5 mm lead pitch. */
const ELECTRO_BODY = bodyFromMm({ widthMm: 8, heightMm: 15 });
const ELECTRO_W = ELECTRO_BODY.width;
const ELECTRO_H = ELECTRO_BODY.height;
const ELECTRO_CX = ELECTRO_W / 2;
const ELECTRO_LEAD_PITCH = u(2.5);
const ELECTRO_LEG_X0 = ELECTRO_CX - ELECTRO_LEAD_PITCH / 2;
const CAN_TOP = u(0.5);
const CAN_HEIGHT = u(11);
/** The cathode leg is the short one, under the stripe. */
const ELECTRO_SHORT_LEG = ELECTRO_H - u(1.2);

const ELECTRO_PROPS: readonly DevicePropertyDefinition[] = [
  {
    id: 'capacitance',
    label: 'Capacitance',
    kind: 'number',
    defaultValue: 1e-4,
    min: 1e-6,
    max: 1e-2,
    step: 1e-6,
    unit: 'F',
    group: 'electrical',
  },
  {
    id: 'voltage',
    label: 'Voltage rating',
    kind: 'number',
    defaultValue: 25,
    min: 6.3,
    max: 450,
    step: 0.1,
    unit: 'V',
    group: 'electrical',
  },
];

function drawElectrolytic(context: DeviceDrawContext): readonly Shape[] {
  const farads = numberState(context, 'capacitance', 1e-4);
  const volts = numberState(context, 'voltage', 25);
  const canBottom = CAN_TOP + CAN_HEIGHT;

  return [
    // Longer leg is positive; the stripe on the can marks the negative side.
    line(ELECTRO_LEG_X0, canBottom - u(0.3), ELECTRO_LEG_X0, ELECTRO_H, {
      stroke: PART.metal,
      strokeWidth: u(0.45),
      strokeLinecap: 'round',
    }),
    line(
      ELECTRO_LEG_X0 + ELECTRO_LEAD_PITCH,
      canBottom - u(0.3),
      ELECTRO_LEG_X0 + ELECTRO_LEAD_PITCH,
      ELECTRO_SHORT_LEG,
      { stroke: PART.metal, strokeWidth: u(0.45), strokeLinecap: 'round' },
    ),
    // Aluminium can.
    rect(u(0.85), CAN_TOP, u(6.3), CAN_HEIGHT, {
      rx: u(0.8),
      fill: PART.electrolytic,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    // Negative stripe with minus marks, over the shorter leg.
    rect(u(5.35), CAN_TOP, u(1.8), CAN_HEIGHT, { rx: u(0.4), fill: '#9aa6bd', opacity: 0.9 }),
    ...[u(3.5), u(6)].map((y) =>
      text(u(6.25), CAN_TOP + y, '−', {
        size: u(1.2),
        fill: '#1e2a3f',
        anchor: 'middle',
        weight: 800,
        detail: 'normal',
      }),
    ),
    // Scored vent on the top of the can.
    line(u(1.6), CAN_TOP + u(1.2), u(5.2), CAN_TOP + u(1.2), {
      stroke: '#1a2436',
      strokeWidth: u(0.1),
      opacity: 0.5,
      detail: 'high',
    }),
    text(u(3.1), CAN_TOP + u(5), formatCapacitance(farads), {
      size: u(0.95),
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
    text(u(3.1), CAN_TOP + u(6.6), `${trim(volts)}V`, {
      size: u(0.95),
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
    text(ELECTRO_LEG_X0 - u(0.9), ELECTRO_H - u(0.3), '+', {
      size: u(1.2),
      fill: '#6b7280',
      anchor: 'middle',
      weight: 800,
      detail: 'high',
    }),
  ];
}

export const CAPACITOR_ELECTROLYTIC: VirtualDevice = {
  id: 'capacitor-electrolytic',
  name: 'Electrolytic capacitor',
  model: 'Radial, polarised',
  description: 'Polarised bulk capacitor. The striped side is negative.',
  x: 300,
  y: 700,
  ...ELECTRO_BODY,
  initiallyVisible: false,
  rotatable: true,
  operatingVoltage: { min: 0, max: 25, recommended: 25 },
  interfaces: ['passive'],
  pins: [
    pin('+', ELECTRO_LEG_X0, ELECTRO_H, 'passive', {
      side: 'bottom',
      description: 'Anode — the longer leg, must sit at the higher potential',
    }),
    pin('−', ELECTRO_LEG_X0 + ELECTRO_LEAD_PITCH, ELECTRO_SHORT_LEG, 'passive', {
      side: 'bottom',
      description: 'Cathode — marked by the stripe',
    }),
  ],
  properties: ELECTRO_PROPS,
  render: { draw: drawElectrolytic },
  catalog: {
    categoryId: 'passive-components',
    category: 'Passive Components',
    aliases: ['electrolytic', 'polarised cap', 'bulk capacitor', 'ตัวเก็บประจุ'],
    tags: ['capacitor', 'electrolytic', 'passive', 'polarised', 'bulk', 'smoothing'],
    interfaceLabel: 'พาสซีฟมีขั้ว · 2 ขา',
    typicalUsage: 'Supply smoothing, energy storage, and low-frequency filtering.',
  },
};

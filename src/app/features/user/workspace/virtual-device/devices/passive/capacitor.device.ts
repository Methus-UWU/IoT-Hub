import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, rect, text, type Shape } from '../core/device-shape';

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

const CERAMIC_W = 96;
const CERAMIC_H = 96;
const CERAMIC_CX = CERAMIC_W / 2;
const CERAMIC_LEG_X0 = CERAMIC_CX - PIN_PITCH / 2;

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
    line(CERAMIC_LEG_X0, 44, CERAMIC_LEG_X0, CERAMIC_H, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    line(CERAMIC_LEG_X0 + PIN_PITCH, 44, CERAMIC_LEG_X0 + PIN_PITCH, CERAMIC_H, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    // Blue-brown ceramic blob.
    circle(CERAMIC_CX, 30, 30, { fill: PART.ceramicDisc, stroke: OUTLINE, strokeWidth: 1.5 }),
    text(CERAMIC_CX, 34, capCode(farads), {
      size: 12,
      fill: '#3a2c12',
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
    text(CERAMIC_CX, CERAMIC_H + 14, formatCapacitance(farads), {
      size: 10.5,
      fill: '#6b7280',
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
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
  width: CERAMIC_W,
  height: CERAMIC_H,
  initiallyVisible: false,
  rotatable: true,
  interfaces: ['passive'],
  pins: [
    pin('1', CERAMIC_LEG_X0, CERAMIC_H, 'passive', { side: 'bottom' }),
    pin('2', CERAMIC_LEG_X0 + PIN_PITCH, CERAMIC_H, 'passive', { side: 'bottom' }),
  ],
  properties: CERAMIC_PROPS,
  render: { draw: drawCeramic, bleed: { bottom: 18 } },
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

const ELECTRO_W = 100;
const ELECTRO_H = 132;
const ELECTRO_CX = ELECTRO_W / 2;
const ELECTRO_LEG_X0 = ELECTRO_CX - PIN_PITCH / 2;

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
  const bodyTop = 26;

  return [
    // Longer leg is positive; the stripe on the can marks the negative side.
    line(ELECTRO_LEG_X0, bodyTop + 84, ELECTRO_LEG_X0, ELECTRO_H, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    line(ELECTRO_LEG_X0 + PIN_PITCH, bodyTop + 84, ELECTRO_LEG_X0 + PIN_PITCH, ELECTRO_H - 12, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    // Aluminium can.
    rect(14, bodyTop, ELECTRO_W - 28, 90, {
      rx: 8,
      fill: PART.electrolytic,
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    // Negative stripe with minus marks, over the shorter leg.
    rect(ELECTRO_W - 34, bodyTop, 20, 90, { rx: 4, fill: '#9aa6bd', opacity: 0.9 }),
    text(ELECTRO_W - 24, bodyTop + 30, '−', {
      size: 12,
      fill: '#1e2a3f',
      anchor: 'middle',
      weight: 800,
      detail: 'normal',
    }),
    text(ELECTRO_W - 24, bodyTop + 52, '−', {
      size: 12,
      fill: '#1e2a3f',
      anchor: 'middle',
      weight: 800,
      detail: 'normal',
    }),
    // Vent cross on the top.
    line(24, bodyTop + 12, ELECTRO_W - 24, bodyTop + 12, {
      stroke: '#1a2436',
      strokeWidth: 1,
      opacity: 0.5,
      detail: 'high',
    }),
    text(ELECTRO_CX - 6, bodyTop + 52, formatCapacitance(farads), {
      size: 9.5,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
    text(ELECTRO_CX - 6, bodyTop + 66, `${trim(volts)}V`, {
      size: 9.5,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
    text(ELECTRO_LEG_X0, ELECTRO_H + 2, '+', {
      size: 12,
      fill: '#6b7280',
      anchor: 'middle',
      weight: 800,
      detail: 'normal',
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
  width: ELECTRO_W,
  height: ELECTRO_H,
  initiallyVisible: false,
  rotatable: true,
  operatingVoltage: { min: 0, max: 25, recommended: 25 },
  interfaces: ['passive'],
  pins: [
    pin('+', ELECTRO_LEG_X0, ELECTRO_H, 'passive', {
      side: 'bottom',
      description: 'Anode — the longer leg, must sit at the higher potential',
    }),
    pin('−', ELECTRO_LEG_X0 + PIN_PITCH, ELECTRO_H - 12, 'passive', {
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

import type { VirtualDevice } from '../../models/virtual-device.model';
import { bodyFromMm, u } from '../core/device-metrics';
import { FLAT, PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, text, type Shape } from '../core/device-shape';

/**
 * Schematic power symbols, as logic simulators such as CircuitVerse offer them: a
 * VCC arrow and a ground mark that each stand for a whole rail, so a circuit can
 * be powered and closed without placing a board, a battery, or an adapter.
 *
 * Each symbol is an ideal source with one pin. Any number of GND marks are the
 * same 0 V node, exactly as on a schematic. VCC comes in fixed voltages rather
 * than one symbol with a knob, for the same reason the adapters do: the wiring
 * check reads a supply's voltage from its pin.
 *
 * Together the symbols are one supply. A part fed from a VCC symbol closes its
 * loop through any GND symbol, but not through a board's GND unless that GND is
 * wired to a GND symbol too — a board is a supply of its own.
 */

/** The supply every VCC and GND symbol belongs to. */
const SCHEMATIC_SUPPLY = 'schematic-symbols';

const BODY = bodyFromMm({ widthMm: 8, heightMm: 10 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CX = WIDTH / 2;
const STROKE = u(0.55);
/** The dot where a wire lands, drawn on every symbol's single pin. */
const TERMINAL_R = u(0.6);

/** Connection dot, the same on both symbols so their pins read alike. */
function terminal(y: number): Shape {
  return circle(CX, y, TERMINAL_R, { fill: FLAT.plastic });
}

function createVcc(id: string, volts: number): VirtualDevice {
  const label = `${volts}V`;
  const railY = u(4.2);

  function draw(): readonly Shape[] {
    return [
      // The voltage is the one thing that differs between the three symbols, so
      // it is the part printed in colour.
      text(CX, u(2.6), label, {
        size: u(1.8),
        fill: PART.wireRed,
        anchor: 'middle',
        mono: true,
        weight: 700,
      }),
      // Schematic rail: a bar across the top of a stem, drawn with the same pen
      // as the ground symbol so the two read as a pair.
      line(CX - u(3), railY, CX + u(3), railY, {
        stroke: FLAT.plastic,
        strokeWidth: u(0.6),
        strokeLinecap: 'round',
      }),
      line(CX, railY, CX, HEIGHT, {
        stroke: FLAT.plastic,
        strokeWidth: STROKE,
        strokeLinecap: 'round',
      }),
      terminal(HEIGHT),
    ];
  }

  return {
    id,
    name: `VCC ${volts} V`,
    model: `Ideal ${volts} V source`,
    description: `Schematic power symbol: a ${volts} V rail without a board or battery.`,
    x: 60,
    y: 700,
    ...BODY,
    initiallyVisible: false,
    rotatable: true,
    powerSource: true,
    supplyGroup: SCHEMATIC_SUPPLY,
    interfaces: ['power'],
    pins: [
      pin('VCC', CX, HEIGHT, 'vcc', {
        side: 'bottom',
        description: `Ideal ${volts} V supply`,
        voltage: volts,
      }),
    ],
    render: { draw, bleed: { bottom: TERMINAL_R + u(0.2) } },
    catalog: {
      categoryId: 'power',
      category: 'Power',
      aliases: ['vcc', 'power symbol', `${volts}v`, 'แหล่งจ่ายไฟ', 'ไฟเลี้ยง'],
      tags: ['power', 'vcc', 'source', 'symbol', `${volts}V`, 'schematic'],
      interfaceLabel: 'สัญลักษณ์ไฟเลี้ยง · 1 ขา',
      typicalUsage: 'Powering a circuit on the canvas without placing a board or a battery.',
    },
  };
}

export const VCC_3V3 = createVcc('vcc-3v3', 3.3);
export const VCC_5V = createVcc('vcc-5v', 5);
export const VCC_12V = createVcc('vcc-12v', 12);

function drawGround(): readonly Shape[] {
  return [
    line(CX, 0, CX, u(4), { stroke: FLAT.plastic, strokeWidth: STROKE, strokeLinecap: 'round' }),
    // The three shortening bars of an earth symbol.
    ...[
      [u(3.5), u(4)],
      [u(2.3), u(5.4)],
      [u(1.1), u(6.8)],
    ].map(([half, y]) =>
      line(CX - half, y, CX + half, y, {
        stroke: FLAT.plastic,
        strokeWidth: STROKE,
        strokeLinecap: 'round',
      }),
    ),
    text(CX, HEIGHT - u(0.6), 'GND', {
      size: u(1.5),
      fill: FLAT.plastic,
      anchor: 'middle',
      mono: true,
      weight: 700,
    }),
    terminal(0),
  ];
}

export const GROUND_SYMBOL: VirtualDevice = {
  id: 'gnd',
  name: 'Ground',
  model: 'Ideal 0 V reference',
  description: 'Schematic ground symbol. Every ground mark is the same 0 V node.',
  x: 60,
  y: 760,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  powerSource: true,
  supplyGroup: SCHEMATIC_SUPPLY,
  interfaces: ['power'],
  pins: [pin('GND', CX, 0, 'gnd', { side: 'top', description: '0 V reference' })],
  render: { draw: drawGround, bleed: { top: TERMINAL_R + u(0.2) } },
  catalog: {
    categoryId: 'power',
    category: 'Power',
    aliases: ['gnd', 'ground', 'ground symbol', 'กราวด์', '0v'],
    tags: ['power', 'ground', 'gnd', 'symbol', 'schematic', '0V'],
    interfaceLabel: 'สัญลักษณ์กราวด์ · 1 ขา',
    typicalUsage: 'Closing a circuit to 0 V without running a wire back to the board.',
  },
};

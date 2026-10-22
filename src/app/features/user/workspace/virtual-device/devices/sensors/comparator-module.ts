/**
 * The LM393 comparator breakout every hobby sensor ships on.
 *
 * A soil probe, an MQ gas can, a flame photodiode and an electret microphone
 * are all sold on the *same* little board: blue FR4, an LM393, a sensitivity
 * trimmer, a power LED, a comparator LED, and a four-pin header. Only the
 * sensing head at the left changes.
 *
 * Rather than copying two hundred lines of that PCB into every one of those
 * parts, a module declares its head, its pins, its properties and its
 * behaviour, and this file draws the board around it. Adding the next LM393
 * sensor is then a head drawing, not another board.
 */

import type { DeviceCategoryId } from '../../device-library.models';
import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext, DevicePropertyDefinition } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, rect, text, type Shape } from '../core/device-shape';
import { requiresSupply, type DeviceBehaviorFactory } from '../core/device-simulation';
import type { DeviceInterface, PinType } from '../core/device-types';

/** Board outline shared by every module in this family. */
const BOARD = bodyFromMm({ widthMm: 32, heightMm: 15 });
export const MODULE_WIDTH = BOARD.width;
export const MODULE_HEIGHT = BOARD.height;

/** The left third of the board is the module's own; the rest is this file's. */
export const HEAD_WIDTH = u(11);

const HEADER_X = MODULE_WIDTH - u(1.2);
const HEADER_LEAD_END = MODULE_WIDTH + u(4);
const HEADER_TOP = u(3.2);

const PCB_FILL = '#1f4f8f';
const PCB_EDGE = '#12325e';
const PCB_TRACE = '#4f74ad';

export interface ComparatorPinSpec {
  readonly name: string;
  readonly type: PinType;
  readonly description: string;
  /** Set on the pins the module drives, so the wiring checks read correctly. */
  readonly output?: boolean;
}

export interface ComparatorModuleConfig {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly description: string;
  readonly x: number;
  readonly y: number;
  /** Silkscreen printed along the bottom edge, usually the module's part code. */
  readonly silk: string;
  readonly pins: readonly ComparatorPinSpec[];
  /** Artwork for the sensing head, drawn inside the leftmost `HEAD_WIDTH`. */
  readonly head: (context: DeviceDrawContext) => readonly Shape[];
  /** True while the comparator output is asserted, so the DO LED can light. */
  readonly triggered: (context: DeviceDrawContext) => boolean;
  readonly properties: readonly DevicePropertyDefinition[];
  readonly simulation: DeviceBehaviorFactory;
  readonly interfaces: readonly DeviceInterface[];
  readonly categoryId: DeviceCategoryId;
  readonly category: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly interfaceLabel: string;
  readonly typicalUsage: string;
}

/** One 0603 chip resistor. Four of them sit between the head and the LM393. */
export function chipResistor(x: number, y: number): readonly Shape[] {
  return [
    rect(x, y, u(3), u(1.15), {
      rx: u(0.12),
      fill: '#eee9dc',
      stroke: OUTLINE,
      strokeWidth: u(0.08),
      detail: 'normal',
    }),
    rect(x, y, u(0.6), u(1.15), { fill: '#aeb6c2', detail: 'high' }),
    rect(x + u(2.4), y, u(0.6), u(1.15), { fill: '#aeb6c2', detail: 'high' }),
  ];
}

/** Blue trimmer potentiometer — the sensitivity screw on every one of these. */
export function trimmer(x: number, y: number, size = u(6.4)): readonly Shape[] {
  return [
    rect(x, y, size, size, {
      rx: u(0.35),
      fill: '#2f6fbf',
      stroke: '#14417d',
      strokeWidth: u(0.15),
    }),
    circle(x + size / 2, y + size / 2, size / 3.4, {
      fill: '#cfd4db',
      stroke: '#6d7681',
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    line(x + size / 2 - size / 4, y + size / 2, x + size / 2 + size / 4, y + size / 2, {
      stroke: '#5d666f',
      strokeWidth: u(0.32),
      strokeLinecap: 'round',
      detail: 'normal',
    }),
  ];
}

/** The LM393 dual comparator in its SOIC-8 body. */
function comparatorChip(x: number, y: number): readonly Shape[] {
  const width = u(4.6);
  const height = u(6.4);
  const leadLength = u(1);

  return [
    ...Array.from({ length: 4 }, (_, index) => {
      const leadY = y + u(0.8) + index * u(1.6);
      return [
        rect(x - leadLength, leadY, leadLength + u(0.2), u(0.42), {
          fill: '#aeb6c2',
          detail: 'high',
        }),
        rect(x + width - u(0.2), leadY, leadLength + u(0.2), u(0.42), {
          fill: '#aeb6c2',
          detail: 'high',
        }),
      ];
    }).flat(),
    rect(x, y, width, height, {
      rx: u(0.3),
      fill: '#20252d',
      stroke: OUTLINE,
      strokeWidth: u(0.12),
    }),
    circle(x + u(0.7), y + u(0.7), u(0.26), { fill: PART.icShine, detail: 'high' }),
    text(x + width / 2, y + height / 2 + u(0.3), 'LM393', {
      size: u(0.72),
      fill: SILK.dim,
      anchor: 'middle',
      mono: true,
      weight: 600,
      rotate: -90,
      detail: 'high',
    }),
  ];
}

/** An indicator LED with its silkscreen caption. */
export function indicatorLed(
  x: number,
  y: number,
  label: string,
  lit: boolean,
  color: 'red' | 'green' = 'red',
): readonly Shape[] {
  const on = color === 'red' ? '#ff5a5a' : '#5cf07d';
  const off = color === 'red' ? '#7a2b2b' : '#2d6b3c';

  return [
    circle(x, y, u(0.95), {
      fill: lit ? on : off,
      stroke: color === 'red' ? '#431b1b' : '#1b3f24',
      strokeWidth: u(0.1),
    }),
    text(x, y - u(1.7), label, {
      size: u(0.7),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
  ];
}

function header(pins: readonly ComparatorPinSpec[]): readonly Shape[] {
  return [
    rect(HEADER_X - u(1.25), HEADER_TOP - HEADER_PITCH / 2, u(2.5), HEADER_PITCH * pins.length, {
      rx: u(0.2),
      fill: '#171a1f',
      stroke: '#0b0d10',
      strokeWidth: u(0.1),
    }),
    ...pins.flatMap((spec, index) => {
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
        text(HEADER_X - u(1.6), y + u(0.3), spec.name, {
          size: u(0.72),
          fill: SILK.white,
          anchor: 'end',
          mono: true,
          weight: 700,
          detail: 'normal',
        }),
      ];
    }),
  ];
}

/** Builds the finished part: this board, plus the caller's head and behaviour. */
export function createComparatorModule(config: ComparatorModuleConfig): VirtualDevice {
  const pins: readonly DevicePin[] = config.pins.map((spec, index) =>
    pin(spec.name, HEADER_LEAD_END, HEADER_TOP + index * HEADER_PITCH, spec.type, {
      side: 'right',
      direction: spec.output ? 'output' : undefined,
      description: spec.description,
      voltage: spec.name === 'VCC' ? 3.3 : undefined,
    }),
  );

  function draw(context: DeviceDrawContext): readonly Shape[] {
    // Lamps follow the module's own supply, not the Start button.
    const powered = context.running && context.state['powered'] === true;
    const triggered = powered && config.triggered(context);

    return [
      rect(0, 0, MODULE_WIDTH, MODULE_HEIGHT, {
        rx: u(0.45),
        fill: PCB_FILL,
        stroke: PCB_EDGE,
        strokeWidth: u(0.18),
      }),
      rect(u(0.25), u(0.25), MODULE_WIDTH - u(0.5), MODULE_HEIGHT - u(0.5), {
        rx: u(0.3),
        fill: 'none',
        stroke: PCB_TRACE,
        strokeWidth: u(0.1),
        opacity: 0.55,
        detail: 'normal',
      }),
      // Mounting holes, one per corner, as on the real boards.
      ...[
        [u(1.5), u(1.5)],
        [u(1.5), MODULE_HEIGHT - u(1.5)],
      ].map(([x, y]) =>
        circle(x, y, u(0.75), {
          fill: '#0d1f3a',
          stroke: PART.metal,
          strokeWidth: u(0.18),
          detail: 'normal',
        }),
      ),

      ...config.head(context),

      ...chipResistor(u(12.6), u(1.5)),
      ...chipResistor(u(12.6), u(12.3)),
      ...trimmer(u(12.4), u(4.3)),
      ...comparatorChip(u(20.4), u(4.3)),
      ...chipResistor(u(20), u(1.5)),
      ...chipResistor(u(20), u(12.3)),

      ...indicatorLed(u(26.6), u(4.4), 'PWR', powered, 'red'),
      ...indicatorLed(u(26.6), u(10.4), 'OUT', triggered, 'red'),

      ...header(config.pins),

      text(u(16), MODULE_HEIGHT - u(0.9), config.silk, {
        size: u(0.8),
        fill: SILK.dim,
        anchor: 'middle',
        mono: true,
        weight: 600,
        detail: 'high',
      }),
    ];
  }

  return {
    id: config.id,
    name: config.name,
    model: config.model,
    description: config.description,
    x: config.x,
    y: config.y,
    ...BOARD,
    initiallyVisible: false,
    rotatable: true,
    printsOwnPinLabels: true,
    operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
    interfaces: config.interfaces,
    pins,
    properties: config.properties,
    // Every LM393 board needs its own VCC and GND wired before AO/DO mean anything.
    simulation: requiresSupply(config.simulation, { minimumVolts: 2.7 }),
    render: { draw, bleed: { left: u(6), right: u(4) } },
    catalog: {
      categoryId: config.categoryId,
      category: config.category,
      aliases: config.aliases,
      tags: config.tags,
      interfaceLabel: config.interfaceLabel,
      typicalUsage: config.typicalUsage,
    },
  };
}

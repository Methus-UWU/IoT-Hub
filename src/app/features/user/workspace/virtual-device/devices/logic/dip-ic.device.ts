import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, repeat, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';

type PinSpec = readonly [label: string, type: PinType, detail: string];

interface DipOptions {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly description: string;
  readonly categoryId: 'logic-ics' | 'analog';
  /** Left column top→bottom, then right column bottom→top — real DIP order. */
  readonly left: readonly PinSpec[];
  readonly right: readonly PinSpec[];
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly usage: string;
}

const MARGIN_Y = 24;

/**
 * A generic through-hole DIP integrated circuit.
 *
 * DIPs all look alike — a black body, a notch, gold legs — so one factory draws
 * them all and each chip is just its pin list. Pins run down the left then up
 * the right, exactly the numbering a datasheet uses, so wiring matches the real
 * part.
 */
function createDipIc(options: DipOptions): VirtualDevice {
  const rows = Math.max(options.left.length, options.right.length);
  const width = 150;
  const height = MARGIN_Y * 2 + (rows - 1) * PIN_PITCH;
  const leftX = 8;
  const rightX = width - 8;

  const pins: DevicePin[] = [
    ...options.left.map((spec, index) =>
      pin(spec[0], leftX, MARGIN_Y + index * PIN_PITCH, spec[1], {
        side: 'left',
        description: spec[2],
      }),
    ),
    ...options.right.map((spec, index) =>
      pin(spec[0], rightX, MARGIN_Y + index * PIN_PITCH, spec[1], {
        side: 'right',
        description: spec[2],
      }),
    ),
  ];

  function draw(_context: DeviceDrawContext): readonly Shape[] {
    return [
      rect(22, 10, width - 44, height - 20, {
        rx: 4,
        fill: PART.icBlack,
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      // Pin-1 notch and dot.
      path(`M ${width / 2 - 10} 10 a 10 10 0 0 0 20 0 z`, {
        fill: '#15181c',
        stroke: '#000',
        strokeWidth: 0.75,
        detail: 'normal',
      }),
      circle(36, 26, 3.5, { fill: PART.icShine, detail: 'normal' }),
      text(width / 2, height / 2 + 4, options.model, {
        size: 11,
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
      // Gold legs.
      ...repeat(options.left.length, { y: PIN_PITCH }, (_, __, y) =>
        rect(leftX - 4, y - 3, 18, 6, { rx: 1, fill: PART.headerGold, detail: 'normal' }),
      { x: 0, y: MARGIN_Y }),
      ...repeat(options.right.length, { y: PIN_PITCH }, (_, __, y) =>
        rect(rightX - 14, y - 3, 18, 6, { rx: 1, fill: PART.headerGold, detail: 'normal' }),
      { x: 0, y: MARGIN_Y }),
      // Pin labels inside the body.
      ...options.left.map((spec, index) =>
        text(30, MARGIN_Y + index * PIN_PITCH + 3, spec[0], {
          size: 7,
          fill: SILK.dim,
          anchor: 'start',
          mono: true,
          detail: 'high',
        }),
      ),
      ...options.right.map((spec, index) =>
        text(width - 30, MARGIN_Y + index * PIN_PITCH + 3, spec[0], {
          size: 7,
          fill: SILK.dim,
          anchor: 'end',
          mono: true,
          detail: 'high',
        }),
      ),
    ];
  }

  return {
    id: options.id,
    name: options.name,
    model: options.model,
    description: options.description,
    x: 360,
    y: 300,
    width,
    height,
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 15, recommended: 5 },
    pins,
    render: { draw, bleed: { left: 6, right: 6 } },
    catalog: {
      categoryId: options.categoryId,
      category: options.categoryId === 'logic-ics' ? 'Logic ICs' : 'Analog',
      aliases: options.aliases,
      tags: options.tags,
      interfaceLabel: `DIP-${options.left.length + options.right.length} · ${pins.length} ขา`,
      typicalUsage: options.usage,
    },
  };
}

export const NE555: VirtualDevice = createDipIc({
  id: 'ne555',
  name: '555 timer',
  model: 'NE555',
  description: 'Classic timer for pulses, oscillators, and delays.',
  categoryId: 'analog',
  left: [
    ['GND', 'gnd', 'Ground'],
    ['TRIG', 'digital', 'Trigger — fires when pulled below ⅓ VCC'],
    ['OUT', 'digital', 'Output'],
    ['RST', 'reset', 'Reset — active low'],
  ],
  right: [
    ['VCC', 'vcc', 'Supply, 4.5–15 V'],
    ['DIS', 'digital', 'Discharge'],
    ['THR', 'digital', 'Threshold — resets when above ⅔ VCC'],
    ['CTRL', 'analog', 'Control voltage'],
  ],
  aliases: ['555', 'ne555', 'timer', 'ตัวตั้งเวลา', 'oscillator'],
  tags: ['555', 'timer', 'oscillator', 'pwm', 'monostable', 'astable', 'analog'],
  usage: 'Blinkers, tone generators, delays, and PWM without a microcontroller.',
});

export const SN74HC595: VirtualDevice = createDipIc({
  id: '74hc595',
  name: '8-bit shift register',
  model: '74HC595',
  description: 'Turns three serial pins into eight outputs — expand your GPIO.',
  categoryId: 'logic-ics',
  left: [
    ['Q1', 'digital', 'Parallel output 1'],
    ['Q2', 'digital', 'Parallel output 2'],
    ['Q3', 'digital', 'Parallel output 3'],
    ['Q4', 'digital', 'Parallel output 4'],
    ['Q5', 'digital', 'Parallel output 5'],
    ['Q6', 'digital', 'Parallel output 6'],
    ['Q7', 'digital', 'Parallel output 7'],
    ['GND', 'gnd', 'Ground'],
  ],
  right: [
    ['VCC', 'vcc', 'Supply, 2–6 V'],
    ['Q0', 'digital', 'Parallel output 0'],
    ['DS', 'digital', 'Serial data in'],
    ['OE', 'digital', 'Output enable — active low'],
    ['ST', 'digital', 'Storage/latch clock'],
    ['SH', 'digital', 'Shift clock'],
    ['MR', 'reset', 'Master reset — active low'],
    ['Q7S', 'digital', 'Serial out to the next register'],
  ],
  aliases: ['74hc595', 'shift register', 'gpio expander', 'ชิฟต์รีจิสเตอร์'],
  tags: ['74hc595', 'shift-register', 'logic', 'expander', 'serial', 'spi', 'output'],
  usage: 'Driving many LEDs or seven-segment digits from a few pins.',
});

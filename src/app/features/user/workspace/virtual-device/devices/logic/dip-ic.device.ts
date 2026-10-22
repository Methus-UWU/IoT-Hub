import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { HEADER_PITCH, u, UNITS_PER_MM } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
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

/** Half a pitch plus the moulding at each end of a DIP package. */
const MARGIN_Y = u(1.6);
/** Narrow DIP: the two rows are 0.3 in apart. */
const ROW_SPACING = u(7.62);
/** How far the legs reach beyond the pin row, so a wire has something to land on. */
const LEG_REACH = u(1.2);

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
  const width = ROW_SPACING + LEG_REACH * 2;
  const height = MARGIN_Y * 2 + (rows - 1) * HEADER_PITCH;
  const leftX = LEG_REACH;
  const rightX = width - LEG_REACH;
  /** Moulded body: 6.35 mm across, inset from the pin rows. */
  const bodyX = (width - u(6.35)) / 2;

  const pins: DevicePin[] = [
    ...options.left.map((spec, index) =>
      pin(spec[0], leftX, MARGIN_Y + index * HEADER_PITCH, spec[1], {
        side: 'left',
        description: spec[2],
      }),
    ),
    ...options.right.map((spec, index) =>
      pin(spec[0], rightX, MARGIN_Y + index * HEADER_PITCH, spec[1], {
        side: 'right',
        description: spec[2],
      }),
    ),
  ];

  function draw(_context: DeviceDrawContext): readonly Shape[] {
    return [
      // Gold legs, drawn first so the body covers where they enter it.
      ...repeat(
        options.left.length,
        { y: HEADER_PITCH },
        (_, __, y) =>
          rect(leftX - u(0.4), y - u(0.35), u(2.2), u(0.7), {
            rx: u(0.1),
            fill: PART.headerGold,
            detail: 'normal',
          }),
        { x: 0, y: MARGIN_Y },
      ),
      ...repeat(
        options.right.length,
        { y: HEADER_PITCH },
        (_, __, y) =>
          rect(rightX - u(1.8), y - u(0.35), u(2.2), u(0.7), {
            rx: u(0.1),
            fill: PART.headerGold,
            detail: 'normal',
          }),
        { x: 0, y: MARGIN_Y },
      ),

      rect(bodyX, u(0.6), u(6.35), height - u(1.2), {
        rx: u(0.4),
        fill: PART.icBlack,
        stroke: OUTLINE,
        strokeWidth: u(0.15),
      }),
      // Pin-1 notch and dot.
      path(`M ${width / 2 - u(1.1)} ${u(0.6)} a ${u(1.1)} ${u(1.1)} 0 0 0 ${u(2.2)} 0 z`, {
        fill: '#15181c',
        stroke: '#000',
        strokeWidth: u(0.08),
        detail: 'normal',
      }),
      circle(bodyX + u(1), u(2), u(0.35), { fill: PART.icShine, detail: 'normal' }),
      text(width / 2, height / 2 + u(0.4), options.model, {
        size: u(1.1),
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        rotate: -90,
        detail: 'normal',
      }),
      // Pin labels inside the body.
      ...options.left.map((spec, index) =>
        text(bodyX + u(0.4), MARGIN_Y + index * HEADER_PITCH + u(0.3), spec[0], {
          size: u(0.85),
          fill: SILK.dim,
          anchor: 'start',
          mono: true,
          detail: 'high',
        }),
      ),
      ...options.right.map((spec, index) =>
        text(bodyX + u(6.35) - u(0.4), MARGIN_Y + index * HEADER_PITCH + u(0.3), spec[0], {
          size: u(0.85),
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
    // A DIP is exactly as long as its pin count makes it: 2.54 mm per row.
    physicalSize: { widthMm: width / UNITS_PER_MM, heightMm: height / UNITS_PER_MM },
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 15, recommended: 5 },
    pins,
    render: { draw, bleed: { left: u(0.6), right: u(0.6) } },
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

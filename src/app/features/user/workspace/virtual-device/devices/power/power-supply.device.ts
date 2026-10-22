import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, LED_COLORS, PART, PCB, SILK, WOKWI } from '../core/device-palette';
import { flatBoard, flatChip, flatHeader, flatLed, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, rect, text, type Shape } from '../core/device-shape';

/**
 * Supplies that stand on their own, so a circuit is not limited to what the
 * board's regulator can spare.
 *
 * Both parts source power the way a board does: their supply pins declare a
 * fixed voltage and the solver drives those rails directly. The voltage is fixed
 * rather than a knob on purpose — the wiring check reads a supply's voltage from
 * its pins to warn about overvoltage, and a knob would make that warning lie.
 */

// ------------------------------------------------------ MB102 breadboard module

const MB102_BODY = bodyFromMm({ widthMm: 53, heightMm: 33 });
const MB102_W = MB102_BODY.width;
const MB102_H = MB102_BODY.height;
const MB102_HEADER_X = MB102_W - u(2.5);
const MB102_LEAD_END = MB102_W + u(4);
const MB102_CENTRE_Y = MB102_H / 2;

const MB102_PINS = [
  { name: '5V', type: 'vcc', voltage: 5, description: 'Regulated 5 V output' },
  { name: '3V3', type: 'vcc', voltage: 3.3, description: 'Regulated 3.3 V output' },
  {
    name: 'GND',
    type: 'gnd',
    voltage: undefined,
    description: 'Ground. Tie it to the board GND as well',
  },
] as const;

function mb102PinY(index: number): number {
  return MB102_CENTRE_Y + (index - 1) * HEADER_PITCH;
}

function drawMb102(context: DeviceDrawContext): readonly Shape[] {
  return [
    ...flatBoard(MB102_W, MB102_H),

    // Inputs on the left edge: a USB-A socket and the DC barrel jack.
    rect(-u(2), u(4), u(12), u(11), {
      rx: u(0.4),
      fill: WOKWI.usb,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.15),
    }),
    rect(-u(1), u(6.5), u(9.5), u(6), { rx: u(0.3), fill: WOKWI.usbInset, detail: 'normal' }),
    rect(-u(1.5), u(19), u(12.5), u(11), {
      rx: u(0.8),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.18),
    }),
    circle(u(4.5), u(24.5), u(2.4), {
      fill: WOKWI.chipInset,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.15),
      detail: 'normal',
    }),

    // Power switch and the lamp that says the rails are live.
    rect(u(14), u(5), u(6), u(6), {
      rx: u(0.4),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.12),
    }),
    circle(u(17), u(8), u(1.9), {
      fill: WOKWI.button,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.14),
    }),
    ...flatLed(u(17), u(16), context.running ? LED_COLORS.green.on : LED_COLORS.green.off),
    silkLabel(u(17), u(19.2), 'PWR', { size: u(0.9), detail: 'normal' }),

    // One AMS1117 per rail, each with its output capacitor.
    ...flatChip(u(23), u(5), u(8), u(5.5), '1117-5.0', u(0.75)),
    ...flatChip(u(23), u(21), u(8), u(5.5), '1117-3.3', u(0.75)),
    ...[u(8), u(24)].map((y) =>
      circle(u(36.5), y, u(2.2), {
        fill: PART.electrolytic,
        stroke: '#0b0d10',
        strokeWidth: u(0.15),
      }),
    ),

    silkLabel(u(27), u(31), 'MB102', { size: u(1.1), weight: 700, detail: 'normal' }),

    // Output header, leads standing out past the right edge.
    ...flatHeader(MB102_HEADER_X, mb102PinY(0), MB102_PINS.length, 'vertical'),
    ...MB102_PINS.flatMap((spec, index) => [
      rect(MB102_HEADER_X, mb102PinY(index) - u(0.28), MB102_LEAD_END - MB102_HEADER_X, u(0.56), {
        rx: u(0.18),
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
      text(MB102_HEADER_X - u(1.6), mb102PinY(index) + u(0.3), spec.name, {
        size: u(0.9),
        fill: SILK.white,
        anchor: 'end',
        mono: true,
        weight: 700,
        detail: 'normal',
      }),
    ]),
  ];
}

export const POWER_MODULE_MB102: VirtualDevice = {
  id: 'power-module-mb102',
  name: 'Breadboard power module',
  model: 'MB102 · 5 V / 3.3 V',
  description: 'Stand-alone 5 V and 3.3 V supply fed from a DC adapter or USB.',
  x: 120,
  y: 700,
  ...MB102_BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  powerSource: true,
  operatingVoltage: { min: 3.3, max: 5, recommended: 5 },
  interfaces: ['power'],
  pins: MB102_PINS.map((spec, index) =>
    pin(spec.name, MB102_LEAD_END, mb102PinY(index), spec.type, {
      side: 'right',
      description: spec.description,
      voltage: spec.voltage,
    }),
  ),
  render: { draw: drawMb102, bleed: { left: u(2.5), right: u(4.5) } },
  catalog: {
    categoryId: 'power',
    category: 'Power',
    aliases: ['mb102', 'breadboard power supply', 'power module', 'โมดูลจ่ายไฟ', 'ไฟเลี้ยงแยก'],
    tags: ['power', 'supply', '5V', '3.3V', 'breadboard', 'regulator', 'external'],
    interfaceLabel: 'แหล่งจ่ายไฟ · 3 ขา',
    typicalUsage:
      'Powering relays, servos, and sensors from their own supply instead of the board.',
  },
};

// ------------------------------------------------------------ DC wall adapter

interface AdapterOptions {
  readonly id: string;
  readonly volts: number;
  readonly amps: number;
  readonly aliases: readonly string[];
  readonly typicalUsage: string;
}

const ADAPTER_BODY = bodyFromMm({ widthMm: 44, heightMm: 16 });
const ADAPTER_W = ADAPTER_BODY.width;
const ADAPTER_CENTRE_Y = ADAPTER_BODY.height / 2;
/** Screw terminals on the barrel-to-terminal adapter, 5.08 mm apart. */
const TERMINAL_PITCH = u(5.08);
const TERMINAL_X = u(36.5);

function adapterPinY(index: number): number {
  return ADAPTER_CENTRE_Y + (index === 0 ? -TERMINAL_PITCH / 2 : TERMINAL_PITCH / 2);
}

function createDcAdapter(options: AdapterOptions): VirtualDevice {
  function draw(): readonly Shape[] {
    return [
      // The adapter brick.
      rect(0, u(1), u(20), u(14), {
        rx: u(1.5),
        fill: FLAT.plastic,
        stroke: '#0b0d10',
        strokeWidth: u(0.18),
      }),
      silkLabel(u(10), u(8.6), `${options.volts}V ${options.amps}A`, {
        size: u(2),
        fill: SILK.white,
        weight: 700,
        detail: 'normal',
      }),
      silkLabel(u(10), u(12.4), 'DC OUT', { size: u(0.9), fill: SILK.dim, detail: 'normal' }),

      // Cable, then the barrel plug in its screw-terminal adapter.
      rect(u(19.5), u(7), u(8), u(2), { rx: u(1), fill: FLAT.plastic }),
      rect(u(27), u(5), u(6.5), u(6), {
        rx: u(1),
        fill: FLAT.plastic,
        stroke: '#0b0d10',
        strokeWidth: u(0.15),
      }),
      rect(u(33), u(2.2), u(7), u(11.6), {
        rx: u(0.6),
        fill: PCB.green,
        stroke: PCB.greenDark,
        strokeWidth: u(0.18),
      }),

      // Screws, leads, and polarity marks.
      ...[0, 1].flatMap((index) => {
        const y = adapterPinY(index);
        return [
          rect(TERMINAL_X, y - u(0.28), ADAPTER_W - TERMINAL_X, u(0.56), {
            rx: u(0.18),
            fill: FLAT.metal,
            stroke: FLAT.metalDark,
            strokeWidth: u(0.06),
          }),
          circle(TERMINAL_X, y, u(1.5), {
            fill: WOKWI.usb,
            stroke: WOKWI.shieldEdge,
            strokeWidth: u(0.15),
          }),
          line(TERMINAL_X - u(1), y, TERMINAL_X + u(1), y, {
            stroke: WOKWI.espBoardTrace,
            strokeWidth: u(0.35),
            detail: 'normal',
          }),
          text(u(34.1), y + u(0.5), index === 0 ? '+' : '−', {
            size: u(1.4),
            fill: SILK.white,
            anchor: 'middle',
            weight: 800,
            detail: 'normal',
          }),
        ];
      }),
    ];
  }

  return {
    id: options.id,
    name: `DC adapter ${options.volts} V`,
    model: `${options.volts} V ${options.amps} A · barrel to screw terminal`,
    description: `Stand-alone ${options.volts} V supply from the mains, for loads the board cannot power.`,
    x: 100,
    y: 740,
    ...ADAPTER_BODY,
    initiallyVisible: false,
    rotatable: true,
    powerSource: true,
    operatingVoltage: { min: options.volts, max: options.volts, recommended: options.volts },
    interfaces: ['power'],
    pins: [
      pin('VCC', ADAPTER_W, adapterPinY(0), 'vcc', {
        side: 'right',
        description: `Positive output, ${options.volts} V`,
        voltage: options.volts,
      }),
      pin('GND', ADAPTER_W, adapterPinY(1), 'gnd', {
        side: 'right',
        description: 'Negative output. Tie it to the board GND as well',
      }),
    ],
    render: { draw },
    catalog: {
      categoryId: 'power',
      category: 'Power',
      aliases: options.aliases,
      tags: ['power', 'supply', 'adapter', 'dc', `${options.volts}V`, 'external', 'mains'],
      interfaceLabel: 'แหล่งจ่ายไฟ · 2 ขา',
      typicalUsage: options.typicalUsage,
    },
  };
}

export const DC_ADAPTER_5V = createDcAdapter({
  id: 'dc-adapter-5v',
  volts: 5,
  amps: 2,
  aliases: ['5v adapter', 'power adapter 5v', 'dc supply 5v', 'อะแดปเตอร์ 5V', 'ไฟเลี้ยงแยก 5V'],
  typicalUsage: 'Pumps, relays, and LED groups powered separately from the board.',
});

export const DC_ADAPTER_12V = createDcAdapter({
  id: 'dc-adapter-12v',
  volts: 12,
  amps: 2,
  aliases: [
    '12v adapter',
    'power adapter 12v',
    'dc supply 12v',
    'อะแดปเตอร์ 12V',
    'ไฟเลี้ยงแยก 12V',
  ],
  typicalUsage: '12 V pumps, solenoid valves, fans, and LED strips switched by a relay.',
});

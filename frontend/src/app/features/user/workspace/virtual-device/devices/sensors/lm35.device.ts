import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { FLAT, OUTLINE, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { path, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, requiresSupply, type DeviceBehavior } from '../core/device-simulation';

/**
 * LM35 precision temperature sensor.
 *
 * A TO-92 part with no module around it: three legs, a flat face, and an output
 * of exactly 10 mV per °C referenced to ground. That linearity is why it stays
 * in kits next to the DHT sensors — no protocol, no library, just an ADC read.
 */

const BODY = bodyFromMm({ widthMm: 5.2, heightMm: 9.5 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Legs are on a 1.27 mm pitch, splayed out to 2.54 mm at the board. */
const LEG_PITCH = u(1.27);
const LEG_TOP = u(4.6);
const CASE_HEIGHT = u(4.4);

const PINS = [
  ['VS', 'vcc', '4-30 V supply'],
  ['OUT', 'analog', 'Linear output, 10 mV per °C'],
  ['GND', 'gnd', 'Ground reference'],
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'temperature',
    label: 'Temperature',
    kind: 'number',
    defaultValue: 27,
    min: -55,
    max: 150,
    step: 0.5,
    unit: '°C',
    group: 'simulation',
    description: 'Temperature of the sensor body.',
  },
];

/** The datasheet transfer function, in volts. */
export function lm35OutputVoltage(celsius: number): number {
  return Math.max(celsius, 0) * 0.01;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const temperature = numberState(context, 'temperature', 27);

  return [
    // Three tinned legs leaving the bottom of the package.
    ...[-1, 0, 1].flatMap((offset) => {
      const legX = WIDTH / 2 + offset * LEG_PITCH;
      return [
        rect(legX - u(0.24), LEG_TOP, u(0.48), HEIGHT - LEG_TOP, {
          fill: FLAT.metal,
          stroke: FLAT.metalDark,
          strokeWidth: u(0.06),
        }),
        // Kink where the leg is bent out of the package.
        rect(legX - u(0.34), LEG_TOP + u(0.2), u(0.68), u(0.5), {
          rx: u(0.2),
          fill: FLAT.metalDark,
          opacity: 1,
          detail: 'normal',
        }),
      ];
    }),
    // TO-92 package: a half-cylinder with one flat face.
    path(
      `M ${u(0.3)} ${u(2.2)} A ${u(2.3)} ${u(2.3)} 0 1 1 ${WIDTH - u(0.3)} ${u(2.2)} L ${
        WIDTH - u(0.3)
      } ${CASE_HEIGHT} L ${u(0.3)} ${CASE_HEIGHT} Z`,
      {
        fill: FLAT.plastic,
        stroke: OUTLINE,
        strokeWidth: u(0.16),
      },
    ),
    text(WIDTH / 2, u(2.4), 'LM35', {
      size: u(0.95),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    text(WIDTH / 2, u(3.8), `${temperature.toFixed(0)}°C`, {
      size: u(0.85),
      fill: SILK.dim,
      anchor: 'middle',
      mono: true,
      detail: 'high',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const temperature = propertyNumber(context, 'temperature', 27);
      context.drive('OUT', lm35OutputVoltage(temperature), 'strong');
    },
    update(context) {
      const temperature = propertyNumber(context, 'temperature', 27);
      context.emit('outputVoltage', lm35OutputVoltage(temperature));
      context.emit('temperature', temperature);
    },
  };
}

export const LM35: VirtualDevice = {
  id: 'lm35',
  name: 'LM35 temperature sensor',
  model: 'LM35DZ TO-92',
  description: 'Analog temperature sensor with a linear 10 mV per °C output.',
  x: 880,
  y: 490,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: false,
  pinHitRadius: LEG_PITCH / 2 - u(0.05),
  operatingVoltage: { min: 4, max: 30, recommended: 5 },
  interfaces: ['analog', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, WIDTH / 2 + (index - 1) * LEG_PITCH, HEIGHT, type, {
      side: 'bottom',
      direction: name === 'OUT' ? 'output' : undefined,
      description,
      voltage: name === 'VS' ? 5 : undefined,
    }),
  ),
  properties: PROPERTIES,
  // The datasheet minimum is 4 V, so a 3.3 V rail genuinely leaves it dead.
  simulation: requiresSupply(createBehavior, { minimumVolts: 4, supplyPin: 'VS' }),
  render: { draw, bleed: { bottom: u(1) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: [
      'lm35',
      'temperature sensor',
      'analog temperature',
      'เซนเซอร์อุณหภูมิ',
      'วัดอุณหภูมิ',
    ],
    tags: ['temperature', 'analog', 'lm35', 'sensor', 'to-92', 'thermometer'],
    interfaceLabel: 'Analog · 3 pins',
    typicalUsage:
      'Thermometers, fan control, and any project that needs a plain analog temperature.',
  },
};

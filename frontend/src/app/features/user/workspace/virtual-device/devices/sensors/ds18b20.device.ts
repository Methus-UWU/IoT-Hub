import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DevicePropertyDefinition } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { line, path, rect, text, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';
import { readingPublisher } from '../core/bus-peripherals';

/**
 * DS18B20 waterproof temperature probe.
 *
 * A stainless tube with the TO-92 sensor potted inside, on a cable that ends in
 * three bare wires. It is the probe people drop into aquariums, hydroponic
 * tanks and soil, because the DHT sensors cannot get wet.
 *
 * Several probes can share one data wire — each carries a unique 64-bit
 * address — which is the reason to choose it over an analog LM35 when a project
 * needs more than one reading. The cable is drawn short; the real one is a metre.
 */

const BODY = bodyFromMm({ widthMm: 60, heightMm: 14 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTRE_Y = HEIGHT / 2;

const WIRES = [
  { name: 'VCC', type: 'vcc', color: PART.wireRed, description: 'Red wire · 3.0–5.5 V supply' },
  {
    name: 'DATA',
    type: 'digital',
    color: '#e0b13a',
    description: 'Yellow wire · 1-Wire bus, needs a 4.7 kΩ pull-up to VCC',
  },
  { name: 'GND', type: 'gnd', color: PART.wireBlack, description: 'Black wire · ground reference' },
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'temperature',
    label: 'Temperature',
    kind: 'number',
    defaultValue: 25,
    min: -55,
    max: 125,
    step: 0.1,
    unit: '°C',
    group: 'simulation',
    description: 'Temperature at the probe tip. Sensor range −55 to 125 °C.',
  },
];

function wireY(index: number): number {
  return CENTRE_Y + (index - 1) * HEADER_PITCH;
}

function draw(): readonly Shape[] {
  return [
    // Stainless probe tube with a rounded, sealed tip.
    rect(0, u(4), u(30), u(6), {
      rx: u(3),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.18),
    }),
    text(u(14), u(7.5), 'DS18B20', {
      size: u(1.5),
      fill: FLAT.metalDark,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    // Heat-shrink sleeve over the crimp, then the cable.
    rect(u(28), u(3.6), u(9), u(6.8), {
      rx: u(0.8),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.15),
    }),
    rect(u(36), u(5), u(10), u(4), {
      rx: u(2),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.12),
    }),

    // The three conductors fan out to 0.1 in spacing, then end in tinned tips.
    ...WIRES.flatMap((wire, index) => {
      const startY = u(6) + index * u(1);
      const endY = wireY(index);
      return [
        path(
          `M ${u(45)} ${startY} C ${u(50)} ${startY} ${u(50)} ${endY} ${u(54)} ${endY} H ${u(56.5)}`,
          {
            fill: 'none',
            stroke: wire.color,
            strokeWidth: u(0.9),
            strokeLinecap: 'round',
          },
        ),
        line(u(56.5), endY, WIDTH, endY, {
          stroke: FLAT.metal,
          strokeWidth: u(0.55),
          strokeLinecap: 'round',
        }),
      ];
    }),
  ];
}

export const DS18B20: VirtualDevice = {
  id: 'ds18b20',
  name: 'DS18B20 waterproof temperature probe',
  model: 'DS18B20 stainless probe',
  description: 'Sealed 1-Wire temperature probe that can sit in water or soil.',
  x: 720,
  y: 360,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  operatingVoltage: { min: 3, max: 5.5, recommended: 3.3 },
  logicVoltage: 3.3,
  supplyCurrentMa: 1.5,
  interfaces: ['onewire', 'digital'],
  pins: WIRES.map((wire, index) =>
    pin(wire.name, WIDTH, wireY(index), wire.type, {
      side: 'right',
      description: wire.description,
      voltage: wire.name === 'VCC' ? 3.3 : undefined,
      requiresBias: wire.name === 'DATA' ? 'up' : undefined,
    }),
  ),
  properties: PROPERTIES,
  render: { draw, bleed: { right: u(0.5) } },
  // Answers DallasTemperature with the inspector's temperature.
  simulation: requiresSupply(readingPublisher('DATA', 'ds18b20', ['temperature']), {
    minimumVolts: 3,
  }),
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: [
      'ds18b20',
      'waterproof temperature',
      'temperature probe',
      'one wire temperature',
      'เซนเซอร์อุณหภูมิกันน้ำ',
    ],
    tags: [
      'ds18b20',
      'temperature',
      'waterproof',
      'onewire',
      'digital',
      'sensor',
      'aquarium',
      'hydroponics',
    ],
    interfaceLabel: 'บัสสายเดี่ยว · 3 สาย',
    typicalUsage: 'Aquarium, hydroponic tank, and soil temperature monitoring.',
  },
};

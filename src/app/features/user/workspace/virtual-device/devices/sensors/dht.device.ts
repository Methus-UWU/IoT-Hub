import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, rect, repeat, text, type Shape } from '../core/device-shape';

const WIDTH = 132;
const BODY_HEIGHT = 124;
const HEIGHT = 168;
const PIN_Y = HEIGHT;
const PIN_START_X = WIDTH / 2 - (PIN_PITCH * 3) / 2;

interface DhtOptions {
  readonly id: string;
  readonly model: string;
  readonly bodyColor: string;
  readonly temperature: { min: number; max: number; default: number };
  readonly humidity: { min: number; max: number; default: number };
  readonly accuracy: string;
}

/**
 * Both DHT parts share one body: a vented plastic shell over a substrate with
 * four legs. Only the shell colour and the sensing ranges differ, so a factory
 * keeps the artwork and the pinout in exactly one place.
 */
function createDhtDevice(options: DhtOptions): VirtualDevice {
  const properties: readonly DevicePropertyDefinition[] = [
    {
      id: 'temperature',
      label: 'Temperature',
      kind: 'number',
      defaultValue: options.temperature.default,
      min: options.temperature.min,
      max: options.temperature.max,
      step: 0.1,
      unit: '°C',
      group: 'simulation',
      description: `Sensor range ${options.temperature.min} to ${options.temperature.max} °C.`,
    },
    {
      id: 'humidity',
      label: 'Humidity',
      kind: 'number',
      defaultValue: options.humidity.default,
      min: options.humidity.min,
      max: options.humidity.max,
      step: 0.1,
      unit: '%RH',
      group: 'simulation',
      description: `Sensor range ${options.humidity.min} to ${options.humidity.max} %RH.`,
    },
  ];

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const temperature = numberState(context, 'temperature', options.temperature.default);
    const humidity = numberState(context, 'humidity', options.humidity.default);

    return [
      // Four legs.
      ...repeat(4, { x: PIN_PITCH }, (_, x) =>
        line(x, BODY_HEIGHT - 6, x, PIN_Y, {
          stroke: PART.metal,
          strokeWidth: 4,
          strokeLinecap: 'round',
        }),
      { x: PIN_START_X, y: 0 }),

      // Vented shell.
      rect(0, 0, WIDTH, BODY_HEIGHT, {
        rx: 6,
        fill: options.bodyColor,
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      rect(10, 12, WIDTH - 20, 68, {
        rx: 4,
        fill: 'none',
        stroke: OUTLINE,
        strokeWidth: 1,
        opacity: 0.35,
        detail: 'normal',
      }),

      // Grille — the row of rectangular vents over the sensing element.
      ...repeat(
        5,
        { x: 0, y: 13 },
        (_, __, y) =>
          repeat(4, { x: 24 }, (___, x) =>
            rect(x, y, 15, 7, { rx: 2, fill: '#00000030', detail: 'normal' }),
          { x: 20, y: 0 }),
        { x: 0, y: 18 },
      ),

      silkLabel(WIDTH / 2, BODY_HEIGHT - 26, options.model, {
        size: 13,
        fill: options.bodyColor === PART.plasticWhite ? '#4a5058' : SILK.white,
        weight: 700,
      }),

      // Live reading, so the part is readable without opening the inspector.
      text(WIDTH / 2, BODY_HEIGHT - 10, `${temperature.toFixed(1)}°C  ${humidity.toFixed(0)}%`, {
        size: 10,
        fill: options.bodyColor === PART.plasticWhite ? '#6b7280' : SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
    ];
  }

  return {
    id: options.id,
    name: `Temperature & humidity (${options.model})`,
    model: options.model,
    description: `Single-wire digital temperature and humidity sensor. ${options.accuracy}`,
    x: 700,
    y: 300,
    width: WIDTH,
    height: HEIGHT,
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 5.5, recommended: 5 },
    interfaces: ['onewire', 'digital'],
    pins: [
      pin('VCC', PIN_START_X, PIN_Y, 'vcc', {
        side: 'bottom',
        description: '3.3–5.5 V supply',
        voltage: 5,
      }),
      pin('DATA', PIN_START_X + PIN_PITCH, PIN_Y, 'digital', {
        side: 'bottom',
        description: 'Single-wire bus, needs a 4.7 kΩ pull-up',
      }),
      pin('NC', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'nc', {
        side: 'bottom',
        description: 'Not connected internally',
      }),
      pin('GND', PIN_START_X + PIN_PITCH * 3, PIN_Y, 'gnd', {
        side: 'bottom',
        description: 'Ground reference',
      }),
    ],
    properties,
    render: { draw },
    catalog: {
      categoryId: 'sensors',
      category: 'Sensors',
      aliases: [options.model.toLowerCase(), 'temperature sensor', 'humidity sensor', 'เซนเซอร์อุณหภูมิ'],
      tags: [
        options.model.toLowerCase(),
        'dht',
        'temperature',
        'humidity',
        'sensor',
        'onewire',
        'digital',
        'climate',
      ],
      interfaceLabel: 'บัสสายเดี่ยว · 4 ขา',
      typicalUsage: 'Room climate logging, greenhouse monitoring, and comfort dashboards.',
    },
  };
}

export const DHT22 = createDhtDevice({
  id: 'dht22',
  model: 'DHT22',
  bodyColor: PART.plasticWhite,
  temperature: { min: -40, max: 80, default: 24 },
  humidity: { min: 0, max: 100, default: 55 },
  accuracy: 'Accurate to ±0.5 °C and ±2 %RH.',
});

export const DHT11 = createDhtDevice({
  id: 'dht11',
  model: 'DHT11',
  bodyColor: PART.plasticBlue,
  temperature: { min: 0, max: 50, default: 24 },
  humidity: { min: 20, max: 90, default: 55 },
  accuracy: 'Budget sensor, accurate to ±2 °C and ±5 %RH.',
});

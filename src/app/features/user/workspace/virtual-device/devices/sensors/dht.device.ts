import type { VirtualDevice } from '../../models/virtual-device.model';
import { type DevicePropertyDefinition } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, rect, repeat, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';
import { readingPublisher } from '../core/bus-peripherals';

/** How far the legs reach below the moulded shell. */
const LEG_LENGTH = u(5);

interface DhtOptions {
  readonly id: string;
  readonly model: string;
  readonly bodyColor: string;
  /** Shell dimensions, excluding the legs. */
  readonly shellMm: { widthMm: number; heightMm: number };
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
  const BODY = bodyFromMm({
    widthMm: options.shellMm.widthMm,
    heightMm: options.shellMm.heightMm + LEG_LENGTH / 10,
  });
  const WIDTH = BODY.width;
  const HEIGHT = BODY.height;
  const BODY_HEIGHT = u(options.shellMm.heightMm);
  const PIN_Y = HEIGHT;
  const PIN_START_X = WIDTH / 2 - (HEADER_PITCH * 3) / 2;
  const pale = options.bodyColor === PART.plasticWhite;

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

  function draw(): readonly Shape[] {
    return [
      // Four legs.
      ...repeat(
        4,
        { x: HEADER_PITCH },
        (_, x) =>
          line(x, BODY_HEIGHT - u(0.6), x, PIN_Y, {
            stroke: PART.metal,
            strokeWidth: u(0.45),
            strokeLinecap: 'round',
          }),
        { x: PIN_START_X, y: 0 },
      ),

      // Moulded shell.
      rect(0, 0, WIDTH, BODY_HEIGHT, {
        rx: u(0.6),
        fill: options.bodyColor,
        stroke: OUTLINE,
        strokeWidth: u(0.15),
      }),
      rect(u(1), u(1), WIDTH - u(2), BODY_HEIGHT * 0.55, {
        rx: u(0.4),
        fill: 'none',
        stroke: OUTLINE,
        strokeWidth: u(0.1),
        opacity: 0.35,
        detail: 'normal',
      }),

      // Grille — the rows of rectangular vents over the sensing element, which
      // is the feature that tells a DHT apart from any other white block.
      ...repeat(
        Math.max(Math.round((BODY_HEIGHT * 0.45) / u(1.5)), 3),
        { y: u(1.5) },
        (_, __, y) =>
          repeat(
            3,
            { x: (WIDTH - u(3)) / 3 },
            (___, x) =>
              rect(x, y, (WIDTH - u(3)) / 3 - u(0.6), u(0.7), {
                rx: u(0.15),
                fill: '#00000030',
                detail: 'normal',
              }),
            { x: u(1.5) },
          ),
        { y: u(2) },
      ),

      silkLabel(WIDTH / 2, BODY_HEIGHT - u(1.6), options.model, {
        size: u(1.6),
        fill: pale ? '#4a5058' : SILK.white,
        weight: 700,
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
    ...BODY,
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 5.5, recommended: 5 },
    logicVoltage: 3.3,
    supplyCurrentMa: 2.5,
    interfaces: ['onewire', 'digital'],
    pins: [
      pin('VCC', PIN_START_X, PIN_Y, 'vcc', {
        side: 'bottom',
        description: '3.3–5.5 V supply',
        voltage: 5,
      }),
      pin('DATA', PIN_START_X + HEADER_PITCH, PIN_Y, 'digital', {
        side: 'bottom',
        requiresBias: 'up',
        description: 'Single-wire bus, needs a 4.7 kΩ pull-up',
      }),
      pin('NC', PIN_START_X + HEADER_PITCH * 2, PIN_Y, 'nc', {
        side: 'bottom',
        description: 'Not connected internally',
      }),
      pin('GND', PIN_START_X + HEADER_PITCH * 3, PIN_Y, 'gnd', {
        side: 'bottom',
        description: 'Ground reference',
      }),
    ],
    properties,
    render: { draw },
    // Answers the DHT library with the inspector's temperature and humidity.
    simulation: requiresSupply(
      readingPublisher('DATA', 'dht', ['temperature', 'humidity'], { model: options.id }),
      { minimumVolts: 3 },
    ),
    catalog: {
      categoryId: 'sensors',
      category: 'Sensors',
      aliases: [
        options.model.toLowerCase(),
        'temperature sensor',
        'humidity sensor',
        'เซนเซอร์อุณหภูมิ',
      ],
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
  // AM2302 shell, the larger of the two.
  shellMm: { widthMm: 15.1, heightMm: 25.1 },
  temperature: { min: -40, max: 80, default: 24 },
  humidity: { min: 0, max: 100, default: 55 },
  accuracy: 'Accurate to ±0.5 °C and ±2 %RH.',
});

export const DHT11 = createDhtDevice({
  id: 'dht11',
  model: 'DHT11',
  bodyColor: PART.plasticBlue,
  shellMm: { widthMm: 12, heightMm: 15.5 },
  temperature: { min: 0, max: 50, default: 24 },
  humidity: { min: 20, max: 90, default: 55 },
  accuracy: 'Budget sensor, accurate to ±2 °C and ±5 %RH.',
});

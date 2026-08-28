import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, rect, repeat, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';

interface BatteryOptions {
  readonly id: string;
  readonly name: string;
  readonly cells: number;
  readonly cellVolts: number;
  readonly chemistry: string;
}

/**
 * A standalone power source.
 *
 * Board rails are not the only supply — a battery pack drives its own + and −
 * terminals, so a circuit can run with no ESP32 present at all. The pack drives
 * strong, matching a real low-impedance source.
 */
function createBatteryHolder(options: BatteryOptions): VirtualDevice {
  const packVolts = options.cells * options.cellVolts;
  const cellWidth = 44;
  const width = 40 + options.cells * cellWidth;
  const height = 96;

  const properties: readonly DevicePropertyDefinition[] = [
    {
      id: 'voltage',
      label: 'Pack voltage',
      kind: 'number',
      defaultValue: packVolts,
      min: 0,
      max: packVolts * 1.2,
      step: 0.1,
      unit: 'V',
      group: 'simulation',
      description: `${options.cells} × ${options.cellVolts} V ${options.chemistry} cells in series.`,
    },
  ];

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const volts = numberState(context, 'voltage', packVolts);
    return [
      rect(0, 8, width, height - 8, {
        rx: 6,
        fill: '#2b2f36',
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      // Cells.
      ...repeat(options.cells, { x: cellWidth }, (_, x) => [
        rect(x, 22, cellWidth - 8, height - 44, {
          rx: 4,
          fill: '#3a4049',
          stroke: '#20242a',
          strokeWidth: 1,
          detail: 'normal',
        }),
        // Nub end.
        rect(x + cellWidth - 12, 34, 5, height - 66, { fill: PART.metal, detail: 'normal' }),
      ], { x: 24, y: 0 }),

      // Terminal leads.
      line(14, height, 14, height + 18, {
        stroke: PART.wireRed,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),
      line(width - 14, height, width - 14, height + 18, {
        stroke: PART.wireBlack,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),

      text(width / 2, 20, `${options.name} · ${volts.toFixed(1)}V`, {
        size: 9.5,
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
      text(14, height - 6, '+', {
        size: 13,
        fill: '#fca5a5',
        anchor: 'middle',
        weight: 800,
        detail: 'normal',
      }),
      text(width - 14, height - 6, '−', {
        size: 13,
        fill: '#cbd5e1',
        anchor: 'middle',
        weight: 800,
        detail: 'normal',
      }),
    ];
  }

  function createBehavior(): DeviceBehavior {
    return {
      drive(context) {
        const volts = propertyNumber(context, 'voltage', packVolts);
        context.drive('+', volts, 'strong');
        context.drive('-', 0, 'strong');
      },
    };
  }

  return {
    id: options.id,
    name: options.name,
    model: `${options.cells}× ${options.chemistry} · ${packVolts.toFixed(1)} V`,
    description: `Battery pack delivering about ${packVolts.toFixed(1)} V. Powers a circuit with no board.`,
    x: 120,
    y: 760,
    width,
    height,
    initiallyVisible: false,
    operatingVoltage: { min: 0, max: packVolts, recommended: packVolts },
    interfaces: ['power'],
    pins: [
      pin('+', 14, height + 18, 'vcc', {
        side: 'bottom',
        description: 'Positive terminal',
        voltage: packVolts,
      }),
      pin('-', width - 14, height + 18, 'gnd', {
        side: 'bottom',
        description: 'Negative terminal',
      }),
    ],
    properties,
    render: { draw, bleed: { bottom: 22 } },
    simulation: createBehavior,
    catalog: {
      categoryId: 'power',
      category: 'Power',
      aliases: ['battery', 'battery pack', 'แบตเตอรี่', options.chemistry.toLowerCase()],
      tags: ['battery', 'power', 'source', 'supply', options.chemistry.toLowerCase(), 'portable'],
      interfaceLabel: 'แหล่งจ่ายไฟ · 2 ขา',
      typicalUsage: 'Portable power for standalone circuits and field devices.',
    },
  };
}

export const BATTERY_AA_2 = createBatteryHolder({
  id: 'battery-aa-2',
  name: 'AA holder ×2',
  cells: 2,
  cellVolts: 1.5,
  chemistry: 'Alkaline',
});

export const BATTERY_AA_4 = createBatteryHolder({
  id: 'battery-aa-4',
  name: 'AA holder ×4',
  cells: 4,
  cellVolts: 1.5,
  chemistry: 'Alkaline',
});

export const BATTERY_18650 = createBatteryHolder({
  id: 'battery-18650',
  name: '18650 cell',
  cells: 1,
  cellVolts: 3.7,
  chemistry: 'Li-ion',
});

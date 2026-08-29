import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u, UNITS_PER_MM } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { line, rect, repeat, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';

interface BatteryOptions {
  readonly id: string;
  readonly name: string;
  readonly cells: number;
  readonly cellVolts: number;
  readonly chemistry: string;
  /** Cell dimensions. An AA is 14.5 × 50.5 mm; an 18650 is 18.6 × 65.2 mm. */
  readonly cellMm: { readonly diameter: number; readonly length: number };
}

/** Clearance between cells and around the pack, in millimetres. */
const CELL_GAP = 1;
const PACK_MARGIN = 1;
/** How far the flying leads hang below the holder. */
const LEAD_LENGTH = 4;

/**
 * A standalone power source.
 *
 * Board rails are not the only supply — a battery pack drives its own + and −
 * terminals, so a circuit can run with no ESP32 present at all. The pack drives
 * strong, matching a real low-impedance source.
 */
function createBatteryHolder(options: BatteryOptions): VirtualDevice {
  const packVolts = options.cells * options.cellVolts;
  // The holder is exactly as big as the cells it carries, which is what makes
  // an 18650 pack visibly taller than an AA pack rather than a recoloured copy.
  const cellPitch = u(options.cellMm.diameter + CELL_GAP);
  const width = u(PACK_MARGIN * 2) + options.cells * cellPitch;
  const height = u(options.cellMm.length + 5.5);

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
      rect(0, 0, width, height, {
        rx: u(1),
        fill: '#2b2f36',
        stroke: OUTLINE,
        strokeWidth: u(0.2),
      }),

      // Cells, each drawn at its real diameter with a spring at one end and a
      // button contact at the other.
      ...repeat(options.cells, { x: cellPitch }, (_, x) => [
        rect(x, u(2.5), u(options.cellMm.diameter), u(options.cellMm.length), {
          rx: u(0.6),
          fill: '#3a4049',
          stroke: '#20242a',
          strokeWidth: u(0.12),
          detail: 'normal',
        }),
        rect(
          x + u(options.cellMm.diameter) / 2 - u(1.4),
          u(2.5),
          u(2.8),
          u(1.4),
          { rx: u(0.3), fill: PART.metal, detail: 'normal' },
        ),
        rect(
          x,
          u(2.5) + u(options.cellMm.length) - u(1),
          u(options.cellMm.diameter),
          u(1),
          { fill: PART.metalDark, opacity: 0.6, detail: 'high' },
        ),
      ], { x: u(PACK_MARGIN), y: 0 }),

      // Flying leads.
      line(u(2.5), height - u(1), u(2.5), height + u(LEAD_LENGTH), {
        stroke: PART.wireRed,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      }),
      line(width - u(2.5), height - u(1), width - u(2.5), height + u(LEAD_LENGTH), {
        stroke: PART.wireBlack,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      }),

      text(width / 2, u(1.8), `${volts.toFixed(1)}V`, {
        size: u(1.4),
        fill: SILK.soft,
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),
      text(u(2.5), height - u(1.8), '+', {
        size: u(1.6),
        fill: '#fca5a5',
        anchor: 'middle',
        weight: 800,
        detail: 'normal',
      }),
      text(width - u(2.5), height - u(1.8), '−', {
        size: u(1.6),
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
    // Derived from the cells, so the declared millimetres and the drawing can
    // never disagree about how big the pack is.
    physicalSize: { widthMm: width / UNITS_PER_MM, heightMm: height / UNITS_PER_MM },
    initiallyVisible: false,
    operatingVoltage: { min: 0, max: packVolts, recommended: packVolts },
    interfaces: ['power'],
    pins: [
      pin('+', u(2.5), height + u(LEAD_LENGTH), 'vcc', {
        side: 'bottom',
        description: 'Positive terminal',
        voltage: packVolts,
      }),
      pin('-', width - u(2.5), height + u(LEAD_LENGTH), 'gnd', {
        side: 'bottom',
        description: 'Negative terminal',
      }),
    ],
    properties,
    render: { draw, bleed: { bottom: u(LEAD_LENGTH + 0.5) } },
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
  cellMm: { diameter: 14.5, length: 50.5 },
});

export const BATTERY_AA_4 = createBatteryHolder({
  id: 'battery-aa-4',
  name: 'AA holder ×4',
  cells: 4,
  cellVolts: 1.5,
  chemistry: 'Alkaline',
  cellMm: { diameter: 14.5, length: 50.5 },
});

export const BATTERY_18650 = createBatteryHolder({
  id: 'battery-18650',
  name: '18650 cell',
  cells: 1,
  cellVolts: 3.7,
  chemistry: 'Li-ion',
  cellMm: { diameter: 18.6, length: 65.2 },
});

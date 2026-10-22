import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  stringState,
  type DeviceDrawContext,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { FLAT, PART, SILK } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, rect, type Shape } from '../core/device-shape';
import { propertyBoolean, supplyVolts, type DeviceBehavior } from '../core/device-simulation';
import {
  RATED_VOLTAGE_PROPERTY,
  ratedOperatingVoltage,
  ratedVolts,
  startVolts,
} from './motor-rating';

/**
 * Small brushed DC motor, the RF-300-class can found in every hobby kit.
 *
 * Drawn from the side, the way it lies on a bench: a black plastic end cap with
 * the two brass solder tabs sticking out of it, the steel can with its two
 * flattened sides, and the bearing boss and shaft at the far end. The shaft is
 * the thing the user attaches something to, and the tabs are where the wires
 * go, so both are drawn clear of the body.
 *
 * The red dot on the end cap marks the tab that makes the shaft turn clockwise
 * when it is positive, as on real motors.
 */

const BODY = bodyFromMm({ widthMm: 44, heightMm: 24.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const CENTRE_Y = HEIGHT / 2;
/** Tabs sit on the end face, either side of the centre line. */
const TERMINAL_SPACING = u(6);
const TERMINAL_X = u(1);

const TERMINALS = [
  ['M+', 'passive', 'Motor terminal. Swapping the two reverses rotation'],
  ['M−', 'passive', 'Motor terminal. Swapping the two reverses rotation'],
] as const;

const CAP_X = u(4);
const CAP_WIDTH = u(6);
const CAN_X = u(9);
const CAN_WIDTH = u(25);
const CAN_END = CAN_X + CAN_WIDTH;
const SHAFT_Y = CENTRE_Y - u(1);

/** The propeller rides on the shaft, just short of its tip. */
const PROPELLER_X = WIDTH - u(2.2);
const BLADE_HALF_LENGTH = u(10);

/**
 * Canvas spin rate at the rated voltage. A readable turn, not the real
 * few-thousand RPM, which would alias into a stationary blur at the simulator's
 * 20 ticks a second.
 */
const DEGREES_PER_SECOND_AT_RATING = 750;

/** Below half its rating the brushes cannot overcome friction and the shaft stays put. */
export function motorSpins(volts: number, stalled: boolean, rated = 5): boolean {
  return !stalled && Math.abs(volts) >= startVolts(rated);
}

function terminalY(index: number): number {
  return CENTRE_Y + (index === 0 ? -TERMINAL_SPACING : TERMINAL_SPACING);
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  // Both come from the behaviour, which only turns the shaft when the tabs are
  // powered — the Start button alone never spins it.
  const spinning = context.running && booleanState(context, 'spinning', false);
  const angle = numberState(context, 'angle', 0);
  // Seen edge-on, a blade's visible length is its true length times |cos|.
  const bladeHalf = Math.max(Math.abs(Math.cos((angle * Math.PI) / 180)), 0.12) * BLADE_HALF_LENGTH;

  return [
    // Brass solder tabs, drawn first so they run in under the end cap.
    ...TERMINALS.map((_, index) => {
      const y = terminalY(index);
      return [
        rect(0, y - u(1), CAP_X + u(2), u(2), {
          rx: u(0.3),
          fill: FLAT.gold,
          stroke: FLAT.goldDark,
          strokeWidth: u(0.12),
        }),
        // The eyelet the wire is threaded through.
        circle(TERMINAL_X + u(0.5), y, u(0.5), { fill: FLAT.goldDark }),
      ];
    }).flat(),

    // Moulded end cap carrying the brushes.
    rect(CAP_X, u(1.2), CAP_WIDTH, HEIGHT - u(2.4), {
      rx: u(1.2),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.15),
    }),
    circle(CAP_X + u(3), terminalY(0) - u(2.6), u(0.7), { fill: PART.wireRed }),

    // Steel can. The two lines are the edges of its flattened sides.
    rect(CAN_X, 0, CAN_WIDTH, HEIGHT, {
      rx: u(1.6),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.22),
    }),
    ...[u(2.2), HEIGHT - u(2.2)].map((y) =>
      line(CAN_X + u(0.8), y, CAN_END - u(0.8), y, {
        stroke: FLAT.metal,
        strokeWidth: u(0.25),
        detail: 'normal',
      }),
    ),
    // Ventilation slots behind the brushes, and the crimp that closes the can.
    ...[u(4.5), HEIGHT - u(7.5)].map((y) =>
      rect(CAN_X + u(2.5), y, u(2.4), u(3), {
        rx: u(0.4),
        fill: FLAT.metalDark,
        detail: 'normal',
      }),
    ),
    line(CAN_END - u(2.2), u(0.6), CAN_END - u(2.2), HEIGHT - u(0.6), {
      stroke: FLAT.metal,
      strokeWidth: u(0.3),
      detail: 'normal',
    }),

    // Rating label wrapped round the middle of the can.
    rect(CAN_X + u(8), 0, u(12), HEIGHT, {
      fill: FLAT.blue,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.15),
    }),
    silkLabel(
      CAN_X + u(14),
      CENTRE_Y + u(0.3),
      `DC ${stringState(context, 'ratedVoltage', '5')}V`,
      {
        size: u(1.8),
        fill: SILK.white,
        weight: 700,
        detail: 'normal',
      },
    ),
    silkLabel(CAN_X + u(14), CENTRE_Y + u(3), 'RF-300', {
      size: u(1.1),
      fill: SILK.soft,
      detail: 'normal',
    }),

    // Bearing boss and output shaft, seen side-on.
    rect(CAN_END - u(0.2), CENTRE_Y - u(2.5), u(2.2), u(5), {
      rx: u(0.5),
      fill: FLAT.metal,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.15),
    }),
    rect(CAN_END + u(2), SHAFT_Y, WIDTH - CAN_END - u(2), u(2), {
      rx: u(0.3),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.12),
    }),
    // Two-blade propeller on the shaft. It turns with the shaft, so it is the
    // animation: a stopped motor shows it still, a powered one spins it.
    rect(PROPELLER_X - u(0.6), CENTRE_Y - bladeHalf, u(1.2), bladeHalf * 2, {
      rx: u(0.5),
      fill: spinning ? FLAT.blue : FLAT.metal,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.12),
    }),
    circle(PROPELLER_X, CENTRE_Y, u(1.1), { fill: FLAT.metalDark }),

    // Terminal polarity marks.
    silkLabel(u(2.2), terminalY(0) - u(1.8), '+', {
      size: u(1.6),
      fill: FLAT.plastic,
      weight: 700,
      detail: 'normal',
    }),
    silkLabel(u(2.2), terminalY(1) + u(3.2), '−', {
      size: u(1.6),
      fill: FLAT.plastic,
      weight: 700,
      detail: 'normal',
    }),
  ];
}

/**
 * Turns the shaft from the voltage across the tabs. Polarity sets the direction,
 * magnitude the speed; floating or under-voltage tabs leave it still, as does
 * the stall lock.
 */
function createBehavior(): DeviceBehavior {
  let angle = 0;

  return {
    update(context) {
      // Both tabs have to reach the same supply; a split pair has no return path.
      const volts = supplyVolts(context, 'M+', 'M−');
      const rated = ratedVolts(context.properties);
      const spinning = motorSpins(volts, propertyBoolean(context, 'stalled', false), rated);

      if (spinning) {
        // Speed follows the fraction of its rating the motor is given.
        const step = (volts / rated) * DEGREES_PER_SECOND_AT_RATING * (context.deltaMs / 1000);
        angle = (((angle + step) % 360) + 360) % 360;
      }

      context.emit('volts', Math.round(volts * 100) / 100);
      context.emit('spinning', spinning);
      // How hard it is working, as a fraction of its rating. The canvas uses
      // this to pitch the motor's sound; a 3 V can at 3 V should sound like it
      // is flat out, which the raw voltage alone cannot say.
      context.emit('effort', spinning ? Math.min(Math.abs(volts) / rated, 1) : 0);
      context.emit('direction', spinning ? Math.sign(volts) : 0);
      context.emit('angle', Math.round(angle));
    },
    reset() {
      angle = 0;
    },
  };
}

export const DC_MOTOR: VirtualDevice = {
  id: 'dc-motor',
  name: 'DC motor',
  model: 'RF-300 · 3 / 5 / 12 V brushed',
  description: 'Two-wire brushed motor for continuous bidirectional rotation.',
  x: 690,
  y: 330,
  ...BODY,
  initiallyVisible: false,
  operatingVoltage: { min: 2.5, max: 6, recommended: 5 },
  operatingVoltageFor: ratedOperatingVoltage,
  interfaces: ['passive', 'power'],
  properties: [
    RATED_VOLTAGE_PROPERTY,
    {
      id: 'stalled',
      label: 'ล็อกเพลา',
      kind: 'boolean',
      defaultValue: false,
      group: 'simulation',
      description: 'Holds the shaft. A stalled motor draws far more current than a spinning one.',
    },
  ],
  pins: TERMINALS.map(([name, type, detail], index) =>
    pin(name, TERMINAL_X, terminalY(index), type, {
      side: 'left',
      description: detail,
    }),
  ),
  readings: [{ id: 'volts', label: 'Voltage across the motor', unit: 'V' }],
  simulation: createBehavior,
  render: { draw },
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['brushed motor', 'toy motor', 'DC motor 3V', 'DC motor 5V', 'DC motor 12V'],
    tags: ['motor', 'DC', 'brushed', 'actuator', 'output', '3V', '5V', '12V'],
    interfaceLabel: 'DC แบบ 2 สาย',
    typicalUsage: 'Wheels, fans, pumps, and other continuous-motion mechanisms.',
  },
};

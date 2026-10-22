import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  stringState,
  type DeviceDrawContext,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { FLAT, LED_COLORS, PART, SILK, WOKWI } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, rect, type Shape } from '../core/device-shape';
import { supplyVolts, type DeviceBehavior } from '../core/device-simulation';
import {
  RATED_VOLTAGE_PROPERTY,
  ratedOperatingVoltage,
  ratedVolts,
  startVolts,
} from './motor-rating';

/**
 * Mini submersible water pump, the 3–6 V one in every plant-watering kit.
 *
 * Drawn from the side: the black motor housing with the cable gland at the back,
 * the larger white pump head in front of it, the intake grille on its end face,
 * and the outlet barb standing up off the top where the hose goes. Water enters
 * at the front and leaves upward, which is what the drawing is laid out to say.
 *
 * Unlike the catalog's DC motor this part reads the voltage across its leads, so
 * it only runs when something actually powers it — a relay contact, a
 * transistor, a battery. It draws 100–200 mA, far more than a GPIO can source,
 * which is why the descriptions keep saying "through a relay or transistor".
 */

const BODY = bodyFromMm({ widthMm: 46, heightMm: 26 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PLUS_Y = u(12.5);
const MINUS_Y = u(17.5);

/** Cable gland at the back, where the two leads leave the housing. */
const GLAND_X = u(8);
const MOTOR_X = u(10.5);
const MOTOR_END = u(31.5);
const MOTOR_TOP = u(8);
const MOTOR_BOTTOM = u(23);
const HEAD_END = u(41.5);
const OUTLET_X = u(34.5);

/** Below half its rating the motor stalls instead of turning. */
export function pumpRunning(volts: number, rated = 5): boolean {
  return volts >= startVolts(rated);
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const pumping = context.running && booleanState(context, 'pumping', false);
  const motorMiddle = (MOTOR_X + MOTOR_END) / 2;

  return [
    // Leads: insulated wire into the gland, tinned tip where the wire lands.
    ...[
      { y: PLUS_Y, color: PART.wireRed },
      { y: MINUS_Y, color: PART.wireBlack },
    ].flatMap((lead) => [
      line(u(2.2), lead.y, GLAND_X + u(0.5), lead.y, {
        stroke: lead.color,
        strokeWidth: u(0.9),
        strokeLinecap: 'round',
      }),
      line(0, lead.y, u(2.4), lead.y, {
        stroke: FLAT.metal,
        strokeWidth: u(0.55),
        strokeLinecap: 'round',
      }),
    ]),
    silkLabel(u(5), PLUS_Y - u(1.4), '+', {
      size: u(1.4),
      fill: FLAT.plastic,
      weight: 700,
      detail: 'normal',
    }),
    silkLabel(u(5), MINUS_Y + u(2.9), '−', {
      size: u(1.4),
      fill: FLAT.plastic,
      weight: 700,
      detail: 'normal',
    }),

    rect(GLAND_X, u(10), u(3.5), u(10), {
      rx: u(0.8),
      fill: '#2a2f37',
      stroke: '#0b0d10',
      strokeWidth: u(0.15),
    }),

    // Sealed motor housing, with its suction feet underneath.
    ...[u(13.5), u(25)].map((x) =>
      rect(x, MOTOR_BOTTOM - u(0.5), u(3), u(2.5), {
        rx: u(0.6),
        fill: '#2a2f37',
        stroke: '#0b0d10',
        strokeWidth: u(0.12),
      }),
    ),
    rect(MOTOR_X, MOTOR_TOP, MOTOR_END - MOTOR_X, MOTOR_BOTTOM - MOTOR_TOP, {
      rx: u(2),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.2),
    }),
    silkLabel(motorMiddle, u(14.6), `DC ${stringState(context, 'ratedVoltage', '5')}V`, {
      size: u(1.6),
      fill: SILK.white,
      weight: 700,
      detail: 'normal',
    }),
    ...(pumping
      ? [
          silkLabel(motorMiddle, u(18.6), 'PUMPING', {
            size: u(1),
            fill: LED_COLORS.blue.on,
            weight: 700,
            detail: 'normal',
          }),
        ]
      : []),

    // Outlet barb rising off the pump head; its bore shows water while running.
    rect(OUTLET_X, 0, u(4), u(6.5), {
      rx: u(0.6),
      fill: WOKWI.module,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.18),
    }),
    rect(OUTLET_X + u(1.3), u(0.5), u(1.4), u(5.5), {
      rx: u(0.7),
      fill: pumping ? FLAT.blue : FLAT.metal,
      detail: 'normal',
    }),
    // Water rising up the outlet while the pump runs: three drops, each a third
    // of a cycle behind the last, climbing as the behaviour advances `phase`.
    ...(pumping
      ? [0, 1, 2].map((index) => {
          const progress = (numberState(context, 'phase', 0) + index / 3) % 1;
          return circle(OUTLET_X + u(2), u(5.4) - progress * u(4.6), u(0.42), {
            fill: '#dbeafe',
            detail: 'normal',
          });
        })
      : []),

    // Pump head: wider than the motor, white, with the impeller chamber inside.
    rect(MOTOR_END - u(0.5), u(5), HEAD_END - MOTOR_END + u(0.5), u(20), {
      rx: u(3),
      fill: WOKWI.module,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.2),
    }),
    line(MOTOR_END + u(1.5), u(6.5), MOTOR_END + u(1.5), u(23.5), {
      stroke: FLAT.metal,
      strokeWidth: u(0.25),
      detail: 'normal',
    }),

    // Intake grille on the front face.
    rect(HEAD_END - u(0.5), u(8.5), u(3.5), u(13), {
      rx: u(0.8),
      fill: WOKWI.module,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.18),
    }),
    ...[u(11), u(14.5), u(18)].map((y) =>
      rect(HEAD_END + u(0.3), y, u(1.9), u(0.9), {
        rx: u(0.45),
        fill: FLAT.metalDark,
        detail: 'normal',
      }),
    ),
  ];
}

function createBehavior(): DeviceBehavior {
  /** 0–1 position of the water animation; only advances while pumping. */
  let phase = 0;

  return {
    update(context) {
      // Both leads have to reach the same supply; a split pair has no return path.
      const volts = supplyVolts(context, '+', '-');
      const rated = ratedVolts(context.properties);
      const pumping = pumpRunning(volts, rated);
      if (pumping) phase = (phase + context.deltaMs / 600) % 1;
      context.emit('volts', Math.round(volts * 100) / 100);
      context.emit('pumping', pumping);
      // Fraction of its rating, which is what the canvas pitches the running
      // sound from — see the same emit on the DC motor.
      context.emit('effort', pumping ? Math.min(volts / rated, 1) : 0);
      context.emit('phase', Math.round(phase * 100) / 100);
    },
    reset() {
      phase = 0;
    },
  };
}

export const WATER_PUMP: VirtualDevice = {
  id: 'water-pump',
  name: 'Mini water pump',
  model: 'Submersible pump 3 / 5 / 12 V',
  description: 'Small submersible DC pump that runs only when its leads are powered.',
  x: 700,
  y: 420,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  operatingVoltage: { min: 2.5, max: 6, recommended: 5 },
  operatingVoltageFor: ratedOperatingVoltage,
  interfaces: ['passive', 'power'],
  properties: [RATED_VOLTAGE_PROPERTY],
  // Supply-typed leads, with no voltage of their own: that is what lets the
  // wiring check see a 12 V rail landing on a 3–6 V pump, while the pump still
  // never counts as a supply itself.
  pins: [
    pin('+', 0, PLUS_Y, 'vcc', {
      side: 'left',
      description: 'Red lead · positive supply, switched through a relay or transistor',
    }),
    pin('-', 0, MINUS_Y, 'gnd', {
      side: 'left',
      description: 'Black lead · return to ground',
    }),
  ],
  readings: [{ id: 'volts', label: 'Voltage across the pump', unit: 'V' }],
  simulation: createBehavior,
  render: { draw, bleed: { left: u(0.5) } },
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['water pump', 'mini pump', 'submersible pump', 'ปั๊มน้ำ', 'ปั๊มน้ำ 5V'],
    tags: ['pump', 'water', 'motor', 'actuator', 'irrigation', '5V', 'garden', 'smart farm'],
    interfaceLabel: 'DC แบบ 2 สาย',
    typicalUsage: 'Automatic plant watering, aquarium top-up, and small fountains.',
  },
};

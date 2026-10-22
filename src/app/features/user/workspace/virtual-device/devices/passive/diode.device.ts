import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { bodyFromMm, u } from '../core/device-metrics';
import { pin } from '../core/device-pin';
import { line, rect, text, type Shape } from '../core/device-shape';
import { type DeviceBehavior } from '../core/device-simulation';

/** DO-41 glass body: 5.2 mm long, 2.7 mm across, on axial leads. */
const LEAD = u(3);
const BODY_W = u(5.2);
const BODY = bodyFromMm({ widthMm: 11.2, heightMm: 3.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const MID_Y = HEIGHT / 2;
const BODY_X = LEAD;
const BODY_HALF = u(1.35);

function draw(_context: DeviceDrawContext): readonly Shape[] {
  return [
    line(0, MID_Y, BODY_X, MID_Y, {
      stroke: PART.metal,
      strokeWidth: u(0.5),
      strokeLinecap: 'round',
    }),
    line(WIDTH, MID_Y, BODY_X + BODY_W, MID_Y, {
      stroke: PART.metal,
      strokeWidth: u(0.5),
      strokeLinecap: 'round',
    }),
    // Black glass body.
    rect(BODY_X, MID_Y - BODY_HALF, BODY_W, BODY_HALF * 2, {
      rx: u(0.4),
      fill: PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    // Cathode band, on the right — current flows toward it. This stripe is the
    // only thing on a real diode that says which way round it goes.
    rect(BODY_X + BODY_W - u(1.2), MID_Y - BODY_HALF, u(0.6), BODY_HALF * 2, {
      fill: '#d6d9de',
    }),
    text(BODY_X + BODY_W / 2 - u(0.4), MID_Y + u(0.35), '1N4007', {
      size: u(0.9),
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/** Silicon forward drop. */
const FORWARD_DROP = 0.7;

/**
 * Ideal-diode conduction, modelled as a one-way voltage follower.
 *
 * A conditional bond cannot work here: bonds are structural and fixed before
 * any voltage exists, but the diode's direction depends on the resolved
 * voltages. So instead — like the potentiometer — it reads the previous
 * iteration and, when forward-biased, drives its cathode to follow the anode
 * less a diode drop. Reverse-bias it and it drives nothing, leaving the far
 * side dark, which is exactly the mistake a beginner needs to see fail.
 */
function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const anode = context.readNode('A');
      if (anode.floating) return;
      const cathode = context.readNode('K');
      const cathodeVolts = cathode.floating ? 0 : cathode.voltage;
      if (anode.voltage - cathodeVolts >= FORWARD_DROP) {
        context.drive('K', anode.voltage - FORWARD_DROP, 'strong');
      }
    },
    update(context) {
      const anode = context.readNode('A');
      const cathode = context.readNode('K');
      const conducting =
        !anode.floating &&
        !cathode.floating &&
        anode.voltage - cathode.voltage >= FORWARD_DROP - 0.05;
      context.emit('conducting', conducting);
    },
  };
}

/** 1N4007 general-purpose rectifier diode. */
export const DIODE_1N4007: VirtualDevice = {
  id: 'diode-1n4007',
  name: 'Diode',
  model: '1N4007',
  description: 'Lets current pass one way only. The banded end is the cathode.',
  x: 300,
  y: 740,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  interfaces: ['passive'],
  pins: [
    pin('A', 0, MID_Y, 'passive', { side: 'left', description: 'Anode — current enters here' }),
    pin('K', WIDTH, MID_Y, 'passive', {
      side: 'right',
      description: 'Cathode — the banded end, current leaves here',
    }),
  ],
  render: { draw },
  simulation: createBehavior,
  catalog: {
    categoryId: 'passive-components',
    category: 'Passive Components',
    aliases: ['diode', 'rectifier', 'ไดโอด', '1n4007'],
    tags: ['diode', 'rectifier', 'passive', 'polarised', 'protection', 'flyback'],
    interfaceLabel: 'พาสซีฟมีขั้ว · 2 ขา',
    typicalUsage: 'Rectification, reverse-polarity protection, and flyback clamping.',
  },
};

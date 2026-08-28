import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { line, path, rect, text, type Shape } from '../core/device-shape';
import { type DeviceBehavior } from '../core/device-simulation';

const LEAD = 30;
const BODY_W = 84;
const WIDTH = BODY_W + LEAD * 2;
const HEIGHT = 44;
const MID_Y = HEIGHT / 2;
const BODY_X = LEAD;

function draw(_context: DeviceDrawContext): readonly Shape[] {
  return [
    line(0, MID_Y, BODY_X, MID_Y, { stroke: PART.metal, strokeWidth: 4, strokeLinecap: 'round' }),
    line(WIDTH, MID_Y, BODY_X + BODY_W, MID_Y, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    // Black glass body.
    rect(BODY_X, MID_Y - 13, BODY_W, 26, {
      rx: 4,
      fill: PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    // Cathode band, on the right — current flows toward it.
    rect(BODY_X + BODY_W - 16, MID_Y - 13, 6, 26, { fill: '#d6d9de' }),
    text(BODY_X + BODY_W / 2 - 4, MID_Y + 4, '1N4007', {
      size: 9,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
    // Schematic triangle-and-bar hint above the body.
    path(`M ${BODY_X + 22} ${MID_Y - 22} l 14 6 l -14 6 z`, {
      fill: '#94a3b8',
      opacity: 0.7,
      detail: 'high',
    }),
    line(BODY_X + 40, MID_Y - 22, BODY_X + 40, MID_Y - 10, {
      stroke: '#94a3b8',
      strokeWidth: 1.5,
      opacity: 0.7,
      detail: 'high',
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
        !anode.floating && !cathode.floating && anode.voltage - cathode.voltage >= FORWARD_DROP - 0.05;
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
  width: WIDTH,
  height: HEIGHT,
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

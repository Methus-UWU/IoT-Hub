import type { VirtualDevice } from '../../models/virtual-device.model';

/** Small brushed DC motor suitable for 3–6 V hobby projects. */
export const DC_MOTOR: VirtualDevice = {
  id: 'dc-motor',
  name: 'DC motor',
  model: '3–6 V brushed motor',
  description: 'Two-wire brushed motor for continuous bidirectional rotation.',
  x: 690,
  y: 330,
  width: 230,
  height: 130,
  initiallyVisible: false,
  pins: [
    { name: 'M+', x: 0, y: 45, kind: 'power' },
    { name: 'M−', x: 0, y: 85, kind: 'ground' },
  ],
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['brushed motor', 'toy motor', 'DC motor 3V', 'DC motor 6V'],
    tags: ['motor', 'DC', 'brushed', 'actuator', 'output', '3V', '6V'],
    interfaceLabel: 'DC แบบ 2 สาย',
    typicalUsage: 'Wheels, fans, pumps, and other continuous-motion mechanisms.',
  },
};

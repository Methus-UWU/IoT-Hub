import type { VirtualDevice } from '../../models/virtual-device.model';

/** TowerPro SG90 micro servo. */
export const SG90_SERVO: VirtualDevice = {
  id: 'servo',
  name: 'Servo motor',
  model: 'TowerPro SG90',
  description: 'PWM-controlled actuator with a shared ground.',
  x: 704,
  y: 484,
  width: 250,
  height: 150,
  pins: [
    { name: 'GND', x: 0, y: 48, kind: 'ground' },
    { name: 'VCC', x: 0, y: 72, kind: 'power' },
    { name: 'PWM', x: 0, y: 96, kind: 'signal' },
  ],
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['micro servo', 'RC servo', '9 gram servo'],
    tags: ['servo', 'motor', 'actuator', 'PWM', 'SG90', 'output'],
    interfaceLabel: 'PWM · 3 ขา',
    typicalUsage: 'Small mechanisms, gauges, locks, and positional control.',
  },
};

import type { VirtualDevice } from '../../models/virtual-device.model';

/** HC-SR04 ultrasonic ranging module. */
export const HC_SR04: VirtualDevice = {
  id: 'ultrasonic',
  name: 'Distance sensor',
  model: 'HC-SR04',
  description: 'Measures distance using trigger and echo signals.',
  x: 692,
  y: 58,
  width: 250,
  height: 111,
  // Measured module: 45 mm wide PCB, 20 mm tall, header along the bottom edge.
  physicalSize: { widthMm: 45, heightMm: 20 },
  // The module prints VCC/TRIG/ECHO/GND above its header, so hide the overlay.
  printsOwnPinLabels: true,
  pins: [
    { name: 'VCC', x: 104, y: 111, kind: 'power', side: 'bottom' },
    { name: 'TRIG', x: 118, y: 111, kind: 'signal', side: 'bottom' },
    { name: 'ECHO', x: 132, y: 111, kind: 'signal', side: 'bottom' },
    { name: 'GND', x: 146, y: 111, kind: 'ground', side: 'bottom' },
  ],
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['sonar', 'distance sensor', 'range finder'],
    tags: ['ultrasonic', 'distance', 'proximity', 'echo', 'HC-SR04', 'sensor', 'digital'],
    interfaceLabel: 'ทริกเกอร์ / เอคโค · 4 ขา',
    typicalUsage: 'Obstacle detection, tank level sensing, and distance measurement.',
  },
};

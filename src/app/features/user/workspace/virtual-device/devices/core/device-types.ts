/**
 * Electrical vocabulary shared by every device definition.
 *
 * `ConnectionKind` (power / ground / signal) already existed and drives wire
 * compatibility on the canvas. `PinType` sits *below* it as a finer
 * classification used for pin colouring, tooltips, and wiring warnings, so the
 * two never contradict each other — see `connectionKindForPinType`.
 */

import type { ConnectionKind } from '../../models/virtual-device.model';

export type PinType =
  | 'vcc'
  | 'gnd'
  | 'digital'
  | 'analog'
  | 'pwm'
  | 'i2c-sda'
  | 'i2c-scl'
  | 'spi-mosi'
  | 'spi-miso'
  | 'spi-sck'
  | 'spi-cs'
  | 'uart-tx'
  | 'uart-rx'
  | 'reset'
  /**
   * A bare two-terminal contact: resistor leads, switch poles, photocell legs.
   * Unlike every other type these carry no intent about what belongs on them,
   * so the wiring rules let them join power, ground, and signal alike.
   */
  | 'passive'
  | 'nc';

export type PinDirection = 'input' | 'output' | 'bidirectional' | 'power' | 'passive';

export type DeviceInterface =
  'digital' | 'analog' | 'pwm' | 'i2c' | 'spi' | 'uart' | 'onewire' | 'power' | 'passive';

/**
 * Pin colour per type. Colour is only ever a *secondary* cue — every pin also
 * carries a label and a tooltip, so the diagram stays readable for users who
 * cannot distinguish these hues.
 */
export const PIN_TYPE_COLORS: Readonly<Record<PinType, string>> = {
  vcc: '#ef4444',
  gnd: '#374151',
  digital: '#2563eb',
  analog: '#a855f7',
  pwm: '#f97316',
  'i2c-sda': '#38bdf8',
  'i2c-scl': '#eab308',
  'spi-mosi': '#ec4899',
  'spi-miso': '#8b5cf6',
  'spi-sck': '#06b6d4',
  'spi-cs': '#f59e0b',
  'uart-tx': '#22c55e',
  'uart-rx': '#14b8a6',
  reset: '#f43f5e',
  passive: '#94a3b8',
  nc: '#9ca3af',
};

/** Human-readable pin type, shown in tooltips and the pinout view. */
export const PIN_TYPE_LABELS: Readonly<Record<PinType, string>> = {
  vcc: 'Power',
  gnd: 'Ground',
  digital: 'Digital I/O',
  analog: 'Analog input',
  pwm: 'PWM capable',
  'i2c-sda': 'I2C data',
  'i2c-scl': 'I2C clock',
  'spi-mosi': 'SPI MOSI',
  'spi-miso': 'SPI MISO',
  'spi-sck': 'SPI clock',
  'spi-cs': 'SPI chip select',
  'uart-tx': 'UART transmit',
  'uart-rx': 'UART receive',
  reset: 'Reset',
  passive: 'Passive terminal',
  nc: 'Not connected',
};

/**
 * Collapses a fine-grained pin type down to the three-way kind the wiring
 * engine understands. Every new pin type must map here, otherwise wires to it
 * would silently become incompatible with everything.
 */
export function connectionKindForPinType(type: PinType): ConnectionKind {
  if (type === 'vcc') return 'power';
  if (type === 'gnd') return 'ground';
  return 'signal';
}

/**
 * True for pins that carry no expectation about what belongs on them.
 *
 * The wiring engine otherwise requires both ends of a wire to share a
 * `ConnectionKind`, which is right for a VCC pin but wrong for a resistor lead:
 * a resistor is equally happy in a power, ground, or signal path. Without this
 * escape hatch a two-terminal part could not legally reach ground at all.
 */
export function isPassivePinType(type: PinType | undefined): boolean {
  return type === 'passive' || type === 'nc';
}

/** Interfaces implied by a set of pin types, used for library badges. */
export function interfacesForPinTypes(types: readonly PinType[]): readonly DeviceInterface[] {
  const found = new Set<DeviceInterface>();
  for (const type of types) {
    if (type === 'i2c-sda' || type === 'i2c-scl') found.add('i2c');
    else if (type.startsWith('spi-')) found.add('spi');
    else if (type.startsWith('uart-')) found.add('uart');
    else if (type === 'analog') found.add('analog');
    else if (type === 'pwm') found.add('pwm');
    else if (type === 'digital') found.add('digital');
  }
  return [...found];
}

export const INTERFACE_LABELS: Readonly<Record<DeviceInterface, string>> = {
  digital: 'Digital',
  analog: 'Analog',
  pwm: 'PWM',
  i2c: 'I2C',
  spi: 'SPI',
  uart: 'UART',
  onewire: '1-Wire',
  power: 'Power',
  passive: 'Passive',
};

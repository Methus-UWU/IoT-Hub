/**
 * Pin construction helpers.
 *
 * Authoring a pin by hand means repeating the `kind`/`type` pairing on every
 * line and risking the two drifting apart. These builders derive `kind` from
 * `type` so the wiring engine and the pin colouring can never disagree.
 */

import type { DevicePin, PinSide, VirtualDevice } from '../../models/virtual-device.model';
import {
  connectionKindForPinType,
  PIN_TYPE_COLORS,
  PIN_TYPE_LABELS,
  type PinDirection,
  type PinType,
} from './device-types';

interface PinOptions {
  readonly side?: PinSide;
  readonly direction?: PinDirection;
  readonly description?: string;
  readonly aliases?: readonly string[];
  readonly voltage?: number;
  readonly multipleConnections?: boolean;
}

const DEFAULT_DIRECTION: Readonly<Record<PinType, PinDirection>> = {
  vcc: 'power',
  gnd: 'power',
  digital: 'bidirectional',
  analog: 'input',
  pwm: 'output',
  'i2c-sda': 'bidirectional',
  'i2c-scl': 'bidirectional',
  'spi-mosi': 'output',
  'spi-miso': 'input',
  'spi-sck': 'output',
  'spi-cs': 'output',
  'uart-tx': 'output',
  'uart-rx': 'input',
  reset: 'input',
  passive: 'passive',
  nc: 'passive',
};

/** Builds one pin, deriving the coarse wiring `kind` from the fine `type`. */
export function pin(
  name: string,
  x: number,
  y: number,
  type: PinType,
  options: PinOptions = {},
): DevicePin {
  return {
    name,
    x,
    y,
    type,
    kind: connectionKindForPinType(type),
    direction: options.direction ?? DEFAULT_DIRECTION[type],
    ...(options.side ? { side: options.side } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(options.voltage !== undefined ? { voltage: options.voltage } : {}),
    ...(options.multipleConnections !== undefined
      ? { multipleConnections: options.multipleConnections }
      : {}),
  };
}

/**
 * Lays a row of pins out along one axis at a fixed pitch — the shape almost
 * every module's header takes.
 */
export function pinRow(
  specs: readonly (readonly [name: string, type: PinType, description?: string])[],
  origin: { x: number; y: number },
  step: { x?: number; y?: number },
  side: PinSide,
): readonly DevicePin[] {
  return specs.map(([name, type, description], index) =>
    pin(name, origin.x + index * (step.x ?? 0), origin.y + index * (step.y ?? 0), type, {
      side,
      description,
    }),
  );
}

export function pinColor(devicePin: DevicePin): string {
  if (devicePin.type) return PIN_TYPE_COLORS[devicePin.type];
  // Legacy parts without a `type` still get sensible colouring from `kind`.
  if (devicePin.kind === 'power') return PIN_TYPE_COLORS.vcc;
  if (devicePin.kind === 'ground') return PIN_TYPE_COLORS.gnd;
  return PIN_TYPE_COLORS.digital;
}

/** Tooltip text: name, classification, direction, and any authored detail. */
export function pinTooltip(devicePin: DevicePin): string {
  const parts = [devicePin.name];
  if (devicePin.type) parts.push(PIN_TYPE_LABELS[devicePin.type]);
  if (devicePin.voltage !== undefined) parts.push(`${devicePin.voltage} V`);
  if (devicePin.description) parts.push(devicePin.description);
  return parts.join(' · ');
}

/** True when this pin may host more than one wire. Defaults to permissive. */
export function pinAcceptsMultipleWires(devicePin: DevicePin): boolean {
  return devicePin.multipleConnections ?? true;
}

/**
 * Rotates a pin's body-local position into device space.
 *
 * Rotation happens about the body centre, matching the `rotate(...)` transform
 * the canvas applies to the artwork — keeping these two in step is what stops
 * pins drifting away from the drawing when a part is turned.
 */
export function rotatedPinOffset(
  device: Pick<VirtualDevice, 'width' | 'height'>,
  devicePin: { x: number; y: number },
  rotationDegrees: number,
): { x: number; y: number } {
  const centerX = device.width / 2;
  const centerY = device.height / 2;
  const radians = (rotationDegrees * Math.PI) / 180;
  const dx = devicePin.x - centerX;
  const dy = devicePin.y - centerY;
  return {
    x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

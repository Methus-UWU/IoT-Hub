import type { DeviceOperatingVoltage, DevicePropertyDefinition } from '../core/device-definition';

/**
 * Voltage ratings small DC motors and pumps are sold in.
 *
 * The same can is wound for 3 V, 5 V or 12 V, and the winding decides both what
 * it needs to start and what it tolerates, so the rating is a property of the
 * placed part rather than three catalog entries.
 */
export const MOTOR_RATINGS = ['3', '5', '12'] as const;
const DEFAULT_RATING = '5';

export const RATED_VOLTAGE_PROPERTY: DevicePropertyDefinition = {
  id: 'ratedVoltage',
  label: 'แรงดันใช้งาน',
  kind: 'select',
  defaultValue: DEFAULT_RATING,
  group: 'electrical',
  options: MOTOR_RATINGS.map((volts) => ({ value: volts, label: `${volts}V` })),
  description: 'จ่ายไฟต่ำกว่าครึ่งหนึ่งของค่านี้จะไม่หมุน และจ่ายเกินจะมีคำเตือนแรงดันเกิน',
};

/** The rating of a placed part, falling back to 5 V for anything unrecognised. */
export function ratedVolts(properties: Readonly<Record<string, unknown>>): number {
  const value = String(properties['ratedVoltage'] ?? DEFAULT_RATING);
  return Number((MOTOR_RATINGS as readonly string[]).includes(value) ? value : DEFAULT_RATING);
}

/** Below half its rating the winding cannot overcome friction. */
export function startVolts(rated: number): number {
  return rated * 0.5;
}

/** A winding survives about a fifth over its rating before it overheats. */
export function ratedOperatingVoltage(
  properties: Readonly<Record<string, unknown>>,
): DeviceOperatingVoltage {
  const rated = ratedVolts(properties);
  return { min: startVolts(rated), max: rated * 1.2, recommended: rated };
}

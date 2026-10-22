import { COMBINED_EXAMPLE } from './examples/combined';
import { BUTTON_EXAMPLE, POTENTIOMETER_EXAMPLE } from './examples/inputs';
import { LED_EXAMPLE, OLED_EXAMPLE, RELAY_EXAMPLE, SERVO_EXAMPLE } from './examples/outputs';
import { DHT22_EXAMPLE, IR_OBSTACLE_EXAMPLE, LDR_EXAMPLE, PIR_EXAMPLE } from './examples/sensors';
import { buildWiringExample } from './wiring-diagram';

/** Picker order: the combined circuit first, then simple outputs, inputs, sensors, actuators. */
export const WIRING_EXAMPLES = [
  COMBINED_EXAMPLE,
  LED_EXAMPLE,
  BUTTON_EXAMPLE,
  POTENTIOMETER_EXAMPLE,
  LDR_EXAMPLE,
  IR_OBSTACLE_EXAMPLE,
  PIR_EXAMPLE,
  DHT22_EXAMPLE,
  SERVO_EXAMPLE,
  RELAY_EXAMPLE,
  OLED_EXAMPLE,
].map(buildWiringExample);

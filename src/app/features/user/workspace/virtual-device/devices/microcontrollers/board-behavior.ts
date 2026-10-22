import type { OnboardLed } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import {
  isLogicHigh,
  type DeviceBehavior,
  type DeviceSimulationContext,
} from '../core/device-simulation';
import { firmwareFor } from '../../simulation/firmware/firmware-bus';
import type {
  FirmwareBusOutput,
  FirmwarePinOutput,
} from '../../simulation/firmware/firmware-machine';

/**
 * Makes a board's GPIO pins follow the sketch running on it.
 *
 * Until this existed the solver deliberately left every signal pin floating,
 * because nothing could say what a GPIO was doing. Now something can, and this
 * is the only place that claim is made: a pin is driven if and only if the
 * sketch configured it as an output or a pull-up.
 *
 * The sketch runs in `update`, not in `drive`. `drive` is called several times
 * per tick by the relaxation loop, and running the sketch more than once per
 * tick would make `millis()` and every counter in it advance at a rate that
 * depends on how hard the solver had to work. So the sketch executes once per
 * tick against the nodes the previous pass resolved, and the levels it produced
 * are replayed on each drive pass. Pin changes therefore land one tick — 50 ms
 * of simulated time — after the sketch writes them, which no sketch can detect.
 */
export interface BoardRuntimeSpec {
  /** Rail the GPIO pins swing to. 3.3 V on ESP32, 5 V on the AVR boards. */
  readonly logicVoltage: number;
  /** Full-scale ADC count: 4095 for the ESP32's 12-bit converter, 1023 for AVR. */
  readonly adcMax: number;
}

/** Runtime value the behaviour emits for the board artwork: the onboard LED's brightness, 0–1. */
const ONBOARD_LED_STATE = 'onboardLed';

/**
 * How bright a board's onboard LED is drawn: what its GPIO is doing while the
 * sketch runs, and dark otherwise. The artwork never lights it on its own.
 */
export function onboardLedLevel(context: DeviceDrawContext): number {
  const level = context.state[ONBOARD_LED_STATE];
  return context.running && typeof level === 'number' ? Math.min(1, Math.max(0, level)) : 0;
}

/** Picks the lit or unlit colour; a PWM-dimmed LED reads as lit from half duty. */
export function onboardLedColor(context: DeviceDrawContext, on: string, off: string): string {
  return onboardLedLevel(context) >= 0.5 ? on : off;
}

export function createBoardBehavior(
  instanceId: string,
  spec: BoardRuntimeSpec,
  onboardLed?: OnboardLed,
): DeviceBehavior {
  let outputs: ReadonlyMap<string, FirmwarePinOutput> = new Map();
  let pullups: readonly string[] = [];
  let bus: readonly FirmwareBusOutput[] = [];

  return {
    drive(context: DeviceSimulationContext) {
      for (const [pinName, output] of outputs) {
        // The average level for anything that measures the pin, plus the duty so
        // a part that responds to the pulse — an LED — can dim in proportion.
        context.drive(pinName, spec.logicVoltage * output.duty, 'strong', output.duty);
      }
      // A pull-up loses to anything that actually drives the node, which is what
      // lets a button to ground read LOW while the pin still reads HIGH when the
      // button is open.
      for (const pinName of pullups) {
        context.drive(pinName, spec.logicVoltage, 'weak');
      }
      // What library calls sent — a display frame, a servo angle — stays on the
      // wire every pass, as a display keeps its last frame.
      for (const output of bus) context.publish(output.pinName, output.protocol, output.data);
    },

    update(context: DeviceSimulationContext) {
      const machine = firmwareFor(instanceId);
      if (!machine) {
        outputs = new Map();
        pullups = [];
        bus = [];
        if (onboardLed) context.emit(ONBOARD_LED_STATE, 0);
        return;
      }

      // A zero delta is a re-solve the canvas asked for after an edit — a
      // property changed, a wire moved — not a slice of simulated time. The
      // netlist has to settle again, but the sketch must not: `advance` would
      // burn a whole step budget out of schedule, so changing a sensor value
      // could jump the program past the very comparison being tuned.
      if (context.deltaMs > 0) {
        machine.advance(context.deltaMs, {
          readDigital: (pinName) => isLogicHigh(context.readNode(pinName), spec.logicVoltage),
          readAnalog: (pinName) => {
            const node = context.readNode(pinName);
            if (node.floating) return 0;
            const ratio = node.voltage / spec.logicVoltage;
            return Math.min(spec.adcMax, Math.max(0, ratio * spec.adcMax));
          },
          readMessages: (pinName) => context.readNode(pinName).messages ?? [],
        });
      }

      outputs = machine.outputs();
      pullups = machine.pullupPins();
      bus = machine.busOutputs();

      if (onboardLed) {
        // An unconfigured pin leaves the LED dark whichever way it is wired.
        const output = outputs.get(onboardLed.pin);
        const duty = output ? output.duty : onboardLed.activeLow ? 1 : 0;
        context.emit(ONBOARD_LED_STATE, onboardLed.activeLow ? 1 - duty : duty);
      }
      context.emit('firmware', machine.status);
      context.emit('uptime', Math.floor(machine.uptimeMs));
    },

    reset() {
      outputs = new Map();
      pullups = [];
      bus = [];
    },
  };
}

/** ESP32 boards: 3.3 V logic, 12-bit ADC. */
export const ESP32_RUNTIME: BoardRuntimeSpec = { logicVoltage: 3.3, adcMax: 4095 };

/** AVR boards: 5 V logic, 10-bit ADC. */
export const AVR_RUNTIME: BoardRuntimeSpec = { logicVoltage: 5, adcMax: 1023 };

import { numeric } from '../firmware-values';
import { libraryObject, requirePin, type LibraryDefinition } from './library-support';

/** Pulse widths the Arduino Servo library maps to 0° and 180° by default. */
const DEFAULT_MIN_US = 544;
const DEFAULT_MAX_US = 2400;

/**
 * Servo (and ESP32Servo, which keeps the same class and API).
 *
 * `write(angle)` sends the angle to whatever servo is on the attached pin, so its
 * horn turns on the canvas. As in the real library, a value of 544 or more is a
 * pulse width in microseconds rather than an angle.
 */
export const SERVO_LIBRARY: LibraryDefinition = {
  classes: {
    Servo: (_args, host) => {
      let pinName: string | null = null;
      let minUs = DEFAULT_MIN_US;
      let maxUs = DEFAULT_MAX_US;
      let angle = 90;

      const send = () => {
        if (pinName) host.publish(pinName, 'servo', 'servo', { angle });
        return 0;
      };
      const fromMicros = (us: number) =>
        Math.min(180, Math.max(0, ((us - minUs) / (maxUs - minUs)) * 180));

      return libraryObject('Servo', {
        attach: (args, line) => {
          pinName = requirePin(host, args[0], 'Servo', line);
          if (args.length >= 3) {
            minUs = numeric(args[1], line);
            maxUs = numeric(args[2], line);
          }
          return 1;
        },
        detach: () => {
          pinName = null;
          return 0;
        },
        attached: () => (pinName ? 1 : 0),
        write: (args, line) => {
          const value = numeric(args[0], line);
          angle = value >= DEFAULT_MIN_US ? fromMicros(value) : Math.min(180, Math.max(0, value));
          return send();
        },
        writeMicroseconds: (args, line) => {
          angle = fromMicros(numeric(args[0], line));
          return send();
        },
        read: () => Math.round(angle),
        readMicroseconds: () => Math.round(minUs + (angle / 180) * (maxUs - minUs)),
        setPeriodHertz: () => 0,
      });
    },
  },
};

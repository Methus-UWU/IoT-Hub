import type { BusMessage, DeviceBehavior, DeviceSimulationContext } from './device-simulation';

/**
 * Behaviours for parts a sketch talks to through a library rather than a level.
 *
 * Each one is the part's half of a `BusMessage` exchange; the library emulations
 * under `simulation/firmware/libraries/` are the sketch's half. Keeping both
 * halves on the wire means the wiring decides who can talk: a DHT22 on the wrong
 * pin, or an OLED off the I2C bus, is not found — as on the bench.
 */

/** A sensor that answers with its inspector values, e.g. a DHT22's temperature. */
export function readingPublisher(
  dataPin: string,
  protocol: string,
  keys: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): () => DeviceBehavior {
  return () => ({
    drive(context: DeviceSimulationContext) {
      const data: Record<string, string | number | boolean> = { ...extra };
      for (const key of keys) {
        const value = context.properties[key];
        if (value !== undefined) data[key] = value;
      }
      context.publish(dataPin, protocol, data);
    },
  });
}

/**
 * An I2C text display: announces itself on SDA so `begin()` can find it, and
 * shows the last frame a sketch sent to its address as `line1`…`lineN`.
 *
 * `address` is a fixed address, or a property id holding one; `any` accepts
 * every address, for a backpack whose jumpers the canvas does not model.
 */
export function i2cTextDisplay(options: {
  readonly sdaPin: string;
  readonly chip: string;
  readonly protocol: string;
  readonly rows: number;
  readonly address: { readonly property: string; readonly fallback: string } | 'any';
}): () => DeviceBehavior {
  return () => {
    let frame: BusMessage | null = null;
    const addressOf = (context: DeviceSimulationContext): string => {
      if (options.address === 'any') return 'any';
      const value = context.properties[options.address.property];
      return typeof value === 'string'
        ? value.toUpperCase().replace('0X', '0x')
        : options.address.fallback;
    };

    return {
      drive(context) {
        context.publish(options.sdaPin, 'i2c-device', {
          chip: options.chip,
          address: addressOf(context),
        });
      },
      update(context) {
        const address = addressOf(context);
        const incoming = (context.readNode(options.sdaPin).messages ?? []).find(
          (message) =>
            message.protocol === options.protocol &&
            (address === 'any' || message.data['address'] === address),
        );
        if (incoming) frame = incoming;
        if (!frame) return;

        // A pixel display sends positioned text runs; a character LCD sends rows.
        const runs = frame.data['runs'];
        if (Array.isArray(runs)) {
          context.emit('frame', JSON.stringify(runs));
        } else {
          const lines = frame.data['lines'];
          for (let row = 0; row < options.rows; row++) {
            context.emit(`line${row + 1}`, Array.isArray(lines) ? (lines[row] ?? '') : '');
          }
        }
        const backlight = frame.data['backlight'];
        if (typeof backlight === 'boolean') context.emit('backlight', backlight);
      },
      reset() {
        frame = null;
      },
    };
  };
}

/** A hobby servo: turns its horn to the angle a sketch's `Servo.write` sent. */
export function servoFollower(signalPin: string): () => DeviceBehavior {
  return () => ({
    update(context) {
      const command = (context.readNode(signalPin).messages ?? []).find(
        (message) => message.protocol === 'servo',
      );
      const angle = command?.data['angle'];
      if (typeof angle === 'number') context.emit('angle', angle);
    },
  });
}

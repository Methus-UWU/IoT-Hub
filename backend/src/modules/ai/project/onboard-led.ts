import { findDevice } from '../../projects/catalog/device-catalog';

/**
 * The board's own LED, as the assistant is told about it.
 *
 * Without this the only trace of the LED is a pin description ("onboard LED —
 * strapping pin"), and a request to blink "the LED" became a new LED, a resistor,
 * and three wires the user never asked for. The pin comes from the catalog, so the
 * model still never invents a number: this is a pin the platform gives it.
 *
 * The number to write is spelled out because `LED_BUILTIN` is not defined by
 * every ESP32 board package; a literal pin compiles everywhere.
 */
export function describeOnboardLed(definitionId: string): string | null {
  const led = findDevice(definitionId)?.onboardLed;
  if (!led) return null;

  const pinNumber = led.pin.match(/(\d+)$/)?.[1];
  const level = led.activeLow ? 'LOW' : 'HIGH';
  return [
    `Onboard LED: pin ${led.pin} (printed "${led.label}" on the board), lit when the pin is ${level}.`,
    'It is part of the board: blinking or switching "the LED" uses it with no add_device and no wire.',
    pinNumber
      ? `In code: const int LED_PIN = ${pinNumber}; pinMode(LED_PIN, OUTPUT);`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

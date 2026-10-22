import { describeOnboardLed } from './onboard-led';

describe('describeOnboardLed', () => {
  it('gives an ESP32 DevKit its GPIO2 LED and the number to write', () => {
    const text = describeOnboardLed('esp32-devkit-v1');

    expect(text).toContain('pin GPIO2');
    expect(text).toContain('lit when the pin is HIGH');
    expect(text).toContain('const int LED_PIN = 2;');
  });

  it('gives an Uno its L LED on pin 13', () => {
    expect(describeOnboardLed('arduino-uno-r3')).toContain(
      'const int LED_PIN = 13;',
    );
  });

  it('says nothing for a board without one or a part that is not a board', () => {
    expect(describeOnboardLed('esp32-wroom-32')).toBeNull();
    expect(describeOnboardLed('led')).toBeNull();
    expect(describeOnboardLed('no-such-part')).toBeNull();
  });
});

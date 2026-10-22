import arduino from './device/arduino.md';
import battery from './device/battery.md';
import breadboard from './device/breadboard.md';
import button from './device/button.md';
import buzzer from './device/buzzer.md';
import capacitiveSoilMoisture from './device/capacitive-soil-moisture.md';
import capacitor from './device/capacitor.md';
import comparatorModule from './device/comparator-module.md';
import dcMotor from './device/dc-motor.md';
import dht from './device/dht.md';
import diode from './device/diode-1n4007.md';
import ds18b20 from './device/ds18b20.md';
import esp32Cam from './device/esp32-cam.md';
import esp32Devkit from './device/esp32-devkit.md';
import esp32Wroom from './device/esp32-wroom-32.md';
import hc05 from './device/hc05-bluetooth.md';
import irObstacle from './device/ir-obstacle.md';
import joystick from './device/joystick.md';
import lcdCharacter from './device/lcd-character.md';
import led from './device/led.md';
import lm35 from './device/lm35.md';
import mqSeries from './device/mq-series.md';
import mq2 from './device/mq2-gas.md';
import ne555 from './device/ne555.md';
import oled from './device/oled-096-i2c.md';
import pir from './device/pir-hc-sr501.md';
import potentiometer from './device/potentiometer.md';
import powerSupply from './device/power-supply.md';
import relay from './device/relay.md';
import resistor from './device/resistor.md';
import rgbLed from './device/rgb-led.md';
import servo from './device/servo.md';
import shiftRegister from './device/74hc595.md';
import soilMoisture from './device/soil-moisture.md';
import switchModule from './device/switch.md';
import touchSensor from './device/touch-sensor.md';
import transistor from './device/transistor.md';
import ultrasonic from './device/ultrasonic.md';
import waterLevel from './device/water-level.md';
import waterPump from './device/water-pump.md';
import serialLedDisplays from './device/serial-led-displays.md';
import rtcDs1307 from './device/rtc-ds1307.md';
import rfidRc522 from './device/rfid-rc522.md';
import tftTouch from './device/tft-touch.md';
import bme280 from './device/bme280.md';

/**
 * Long-form Thai datasheets, keyed by device id.
 *
 * This is the half of a part's documentation that cannot be derived: wiring
 * diagrams, worked calculations, code, and the failure modes that only show up on
 * a bench. The derived half — pins, voltage window, interfaces — comes from the
 * catalog via [device-reference.ts] and must not be restated here, or the two will
 * disagree the first time the catalog changes.
 *
 * Several ids share one file where the parts differ only by count or size: a relay
 * board is the same part four times over, and four near-identical files would drift
 * apart one edit at a time. Each shared file covers the differences in a table.
 * `comparator-module.md` is the same idea applied to a circuit rather than a part —
 * six sensors ship on the identical LM393 breakout, so the wiring advice is one
 * document.
 *
 * A device with no datasheet still renders — the reader shows the derived specs and
 * the short note from [device-notes.th.ts], then says the full document is pending.
 */
export const DEVICE_DATASHEETS: Readonly<Record<string, string>> = {
  'max7219-matrix': serialLedDisplays,
  'tm1637-display': serialLedDisplays,
  'rtc-ds1307': rtcDs1307,
  'rfid-rc522': rfidRc522,
  'tft-ili9341-touch': tftTouch,
  bme280,
  // Boards
  'arduino-uno-r3': arduino,
  'arduino-nano': arduino,
  'arduino-mega-2560': arduino,
  'esp32-devkit-v1': esp32Devkit,
  'esp32-devkit-38': esp32Devkit,
  'esp32-cam': esp32Cam,
  'esp32-wroom-32': esp32Wroom,

  // Displays
  lcd1602parallel: lcdCharacter,
  lcd: lcdCharacter,
  lcd2004parallel: lcdCharacter,
  lcd2004i2c: lcdCharacter,
  'oled-096-i2c': oled,

  // Light
  led,
  'rgb-led-common-cathode': rgbLed,
  'rgb-led-common-anode': rgbLed,

  // Sensors
  ultrasonic,
  dht22: dht,
  dht11: dht,
  ldr: comparatorModule,
  'flame-sensor': comparatorModule,
  'rain-sensor': comparatorModule,
  'sound-sensor': comparatorModule,
  'pir-hc-sr501': pir,
  'soil-moisture': soilMoisture,
  'soil-moisture-capacitive': capacitiveSoilMoisture,
  'water-level': waterLevel,
  'mq2-gas': mq2,
  'mq135-air': mqSeries,
  'mq7-co': mqSeries,
  'mq3-alcohol': mqSeries,
  'ir-obstacle': irObstacle,
  lm35,
  ds18b20,

  // Relays
  relay,
  relay2: relay,
  relay4: relay,
  relay8: relay,

  // Input
  button,
  potentiometer,
  joystick,
  'touch-sensor': touchSensor,
  'slide-switch': switchModule,
  'dip-switch-2': switchModule,
  'dip-switch-4': switchModule,
  'dip-switch-8': switchModule,

  // Motion and sound
  servo,
  'dc-motor': dcMotor,
  'water-pump': waterPump,
  'buzzer-active': buzzer,
  'buzzer-passive': buzzer,

  // Communication and power
  'hc05-bluetooth': hc05,
  'battery-aa-2': battery,
  'battery-aa-4': battery,
  'battery-18650': battery,
  'vcc-3v3': powerSupply,
  'vcc-5v': powerSupply,
  'vcc-12v': powerSupply,
  gnd: powerSupply,
  'power-module-mb102': powerSupply,
  'dc-adapter-5v': powerSupply,
  'dc-adapter-12v': powerSupply,

  // Logic and analog
  '74hc595': shiftRegister,
  ne555,
  'transistor-npn': transistor,
  'transistor-pnp': transistor,

  // Passive and prototyping
  resistor,
  'capacitor-ceramic': capacitor,
  'capacitor-electrolytic': capacitor,
  'diode-1n4007': diode,
  'breadboard-half': breadboard,
  'breadboard-full': breadboard,
  'breadboard-mini': breadboard,
};

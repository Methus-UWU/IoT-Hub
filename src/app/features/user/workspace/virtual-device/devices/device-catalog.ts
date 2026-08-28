import type { DeviceKind, DeviceLibraryItem } from '../device-library.models';
import type { VirtualDevice } from '../models/virtual-device.model';
import {
  allDevices,
  getDevice,
  isRegisteredDevice,
  libraryItems,
  registerDevices,
} from './core/device-registry';

import { BUZZER_ACTIVE, BUZZER_PASSIVE } from './basic/buzzer.device';
import { LED_5MM } from './basic/led.device';
import { RGB_LED_COMMON_ANODE, RGB_LED_COMMON_CATHODE } from './basic/rgb-led.device';
import { HC05_BLUETOOTH } from './communication/hc05-bluetooth.device';
import { SCREW_TERMINAL_2, SCREW_TERMINAL_3 } from './connectors/screw-terminal.device';
import {
  LCD_1602_I2C,
  LCD_1602_PARALLEL,
  LCD_2004_I2C,
  LCD_2004_PARALLEL,
} from './display/lcd.device';
import { OLED_096_I2C } from './display/oled-096.device';
import { DIP_SWITCH_2, DIP_SWITCH_4, DIP_SWITCH_8 } from './input/dip-switch.device';
import { POTENTIOMETER } from './input/potentiometer.device';
import { PUSH_BUTTON } from './input/push-button.device';
import { SLIDE_SWITCH } from './input/slide-switch.device';
import { NE555, SN74HC595 } from './logic/dip-ic.device';
import { ARDUINO_UNO_R3 } from './microcontrollers/arduino-uno.device';
import { ESP32_DEVKIT_V1 } from './microcontrollers/esp32-devkit-v1.device';
import { DC_MOTOR } from './motor/dc-motor.device';
import { SG90_SERVO } from './motor/sg90-servo.device';
import { CAPACITOR_CERAMIC, CAPACITOR_ELECTROLYTIC } from './passive/capacitor.device';
import { DIODE_1N4007 } from './passive/diode.device';
import { RESISTOR } from './passive/resistor.device';
import {
  BATTERY_18650,
  BATTERY_AA_2,
  BATTERY_AA_4,
} from './power/battery-holder.device';
import {
  BREADBOARD_FULL,
  BREADBOARD_HALF,
  BREADBOARD_MINI,
} from './prototyping/breadboard.device';
import { RELAY_1CH, RELAY_2CH, RELAY_4CH, RELAY_8CH } from './relay/relay-module.device';
import { TRANSISTOR_NPN, TRANSISTOR_PNP } from './semiconductor/transistor.device';
import { DHT11, DHT22 } from './sensors/dht.device';
import { HC_SR04 } from './sensors/hc-sr04.device';
import { LDR } from './sensors/ldr.device';
import { PIR_HC_SR501 } from './sensors/pir-hc-sr501.device';

/**
 * The catalog manifest.
 *
 * This list is the *only* place a new part has to be mentioned. Everything
 * downstream — search, categories, thumbnails, favourites, the canvas — reads
 * through the registry, so adding a device never means touching core files.
 */
registerDevices([
  // Microcontrollers
  ARDUINO_UNO_R3,
  ESP32_DEVKIT_V1,
  // Displays
  LCD_1602_PARALLEL,
  LCD_1602_I2C,
  LCD_2004_PARALLEL,
  LCD_2004_I2C,
  OLED_096_I2C,
  // LEDs and lighting
  LED_5MM,
  RGB_LED_COMMON_CATHODE,
  RGB_LED_COMMON_ANODE,
  // Sensors
  HC_SR04,
  DHT22,
  DHT11,
  LDR,
  PIR_HC_SR501,
  // Relays
  RELAY_1CH,
  RELAY_2CH,
  RELAY_4CH,
  RELAY_8CH,
  // Input devices
  PUSH_BUTTON,
  POTENTIOMETER,
  // Switches
  SLIDE_SWITCH,
  DIP_SWITCH_2,
  DIP_SWITCH_4,
  DIP_SWITCH_8,
  // Motors and actuators
  SG90_SERVO,
  DC_MOTOR,
  // Audio
  BUZZER_ACTIVE,
  BUZZER_PASSIVE,
  // Communication
  HC05_BLUETOOTH,
  // Power
  BATTERY_AA_2,
  BATTERY_AA_4,
  BATTERY_18650,
  // Logic ICs
  SN74HC595,
  // Analog / semiconductor
  NE555,
  TRANSISTOR_NPN,
  TRANSISTOR_PNP,
  // Passive components
  RESISTOR,
  CAPACITOR_CERAMIC,
  CAPACITOR_ELECTROLYTIC,
  DIODE_1N4007,
  // Connectors
  SCREW_TERMINAL_2,
  SCREW_TERMINAL_3,
  // Prototyping
  BREADBOARD_HALF,
  BREADBOARD_FULL,
  BREADBOARD_MINI,
]);

/** Every part the virtual workspace can place, in library display order. */
export const DEVICES: readonly VirtualDevice[] = allDevices();

export function deviceById(id: DeviceKind): VirtualDevice | undefined {
  return getDevice(id);
}

export function isDeviceKind(value: unknown): value is DeviceKind {
  return isRegisteredDevice(value);
}

/** Catalog projection consumed by the Add Device modal. */
export const DEVICE_LIBRARY_ITEMS: readonly DeviceLibraryItem[] = libraryItems();

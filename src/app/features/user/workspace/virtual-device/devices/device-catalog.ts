import type { DeviceKind, DeviceLibraryItem } from '../device-library.models';
import type { VirtualDevice } from '../models/virtual-device.model';
import { resolveDeviceId } from './core/device-aliases';
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
import {
  LCD_1602_I2C,
  LCD_1602_PARALLEL,
  LCD_2004_I2C,
  LCD_2004_PARALLEL,
} from './display/lcd.device';
import { OLED_096_I2C } from './display/oled-096.device';
import { MAX7219_MATRIX, TM1637_DISPLAY } from './display/serial-led-displays.device';
import { TFT_TOUCH } from './display/tft-touch.device';
import { DS1307 } from './communication/ds1307.device';
import { RFID_RC522 } from './communication/rfid-rc522.device';
import { BME280 } from './sensors/bme280.device';
import { DIP_SWITCH_2, DIP_SWITCH_4, DIP_SWITCH_8 } from './input/dip-switch.device';
import { JOYSTICK } from './input/joystick.device';
import { POTENTIOMETER } from './input/potentiometer.device';
import { PUSH_BUTTON } from './input/push-button.device';
import { SLIDE_SWITCH } from './input/slide-switch.device';
import { TOUCH_SENSOR } from './input/touch-sensor.device';
import { NE555, SN74HC595 } from './logic/dip-ic.device';
import { ARDUINO_MEGA_2560 } from './microcontrollers/arduino-mega.device';
import { ARDUINO_NANO } from './microcontrollers/arduino-nano.device';
import { ARDUINO_UNO_R3 } from './microcontrollers/arduino-uno.device';
import { ESP32_CAM } from './microcontrollers/esp32-cam.device';
import { ESP32_WROOM_32 } from './microcontrollers/esp32-wroom-32.device';
import { ESP32_DEVKIT_38 } from './microcontrollers/esp32-devkit-38.device';
import { ESP32_DEVKIT_V1 } from './microcontrollers/esp32-devkit-v1.device';
import { DC_MOTOR } from './motor/dc-motor.device';
import { SG90_SERVO } from './motor/sg90-servo.device';
import { WATER_PUMP } from './motor/water-pump.device';
import { CAPACITOR_CERAMIC, CAPACITOR_ELECTROLYTIC } from './passive/capacitor.device';
import { DIODE_1N4007 } from './passive/diode.device';
import { RESISTOR } from './passive/resistor.device';
import { BATTERY_18650, BATTERY_AA_2, BATTERY_AA_4 } from './power/battery-holder.device';
import { DC_ADAPTER_12V, DC_ADAPTER_5V, POWER_MODULE_MB102 } from './power/power-supply.device';
import { GROUND_SYMBOL, VCC_12V, VCC_3V3, VCC_5V } from './power/power-symbols.device';
import { BREADBOARD_FULL, BREADBOARD_HALF, BREADBOARD_MINI } from './prototyping/breadboard.device';
import { RELAY_1CH, RELAY_2CH, RELAY_4CH, RELAY_8CH } from './relay/relay-module.device';
import { TRANSISTOR_NPN, TRANSISTOR_PNP } from './semiconductor/transistor.device';
import { CAPACITIVE_SOIL_MOISTURE } from './sensors/capacitive-soil-moisture.device';
import { DHT11, DHT22 } from './sensors/dht.device';
import { DS18B20 } from './sensors/ds18b20.device';
import { FLAME_SENSOR } from './sensors/flame.device';
import { IR_OBSTACLE } from './sensors/ir-obstacle.device';
import { MQ135_AIR, MQ3_ALCOHOL, MQ7_CO } from './sensors/mq-series.device';
import { MQ2_GAS } from './sensors/mq2-gas.device';
import { RAIN_SENSOR } from './sensors/rain.device';
import { SOIL_MOISTURE } from './sensors/soil-moisture.device';
import { SOUND_SENSOR } from './sensors/sound.device';
import { WATER_LEVEL } from './sensors/water-level.device';
import { HC_SR04 } from './sensors/hc-sr04.device';
import { LDR } from './sensors/ldr.device';
import { LM35 } from './sensors/lm35.device';
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
  ARDUINO_NANO,
  ARDUINO_MEGA_2560,
  ESP32_DEVKIT_V1,
  ESP32_DEVKIT_38,
  ESP32_CAM,
  ESP32_WROOM_32,
  // Displays
  LCD_1602_PARALLEL,
  LCD_1602_I2C,
  LCD_2004_PARALLEL,
  LCD_2004_I2C,
  OLED_096_I2C,
  MAX7219_MATRIX,
  TM1637_DISPLAY,
  TFT_TOUCH,
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
  SOIL_MOISTURE,
  CAPACITIVE_SOIL_MOISTURE,
  WATER_LEVEL,
  MQ2_GAS,
  MQ135_AIR,
  MQ7_CO,
  MQ3_ALCOHOL,
  FLAME_SENSOR,
  RAIN_SENSOR,
  SOUND_SENSOR,
  IR_OBSTACLE,
  LM35,
  DS18B20,
  BME280,
  // Relays
  RELAY_1CH,
  RELAY_2CH,
  RELAY_4CH,
  RELAY_8CH,
  // Input devices
  PUSH_BUTTON,
  POTENTIOMETER,
  JOYSTICK,
  TOUCH_SENSOR,
  // Switches
  SLIDE_SWITCH,
  DIP_SWITCH_2,
  DIP_SWITCH_4,
  DIP_SWITCH_8,
  // Motors and actuators
  SG90_SERVO,
  DC_MOTOR,
  WATER_PUMP,
  // Audio
  BUZZER_ACTIVE,
  BUZZER_PASSIVE,
  // Communication
  HC05_BLUETOOTH,
  DS1307,
  RFID_RC522,
  // Power
  VCC_3V3,
  VCC_5V,
  VCC_12V,
  GROUND_SYMBOL,
  BATTERY_AA_2,
  BATTERY_AA_4,
  BATTERY_18650,
  POWER_MODULE_MB102,
  DC_ADAPTER_5V,
  DC_ADAPTER_12V,
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
  // Prototyping
  BREADBOARD_HALF,
  BREADBOARD_FULL,
  BREADBOARD_MINI,
]);

/** Every part the virtual workspace can place, in library display order. */
export const DEVICES: readonly VirtualDevice[] = allDevices();

/**
 * Looks a part up by id, falling through the legacy alias table.
 *
 * Every read path — the canvas, the picker, a restored project — goes through
 * here, so an id retired years ago still resolves without any caller knowing
 * the alias table exists.
 */
export function deviceById(id: DeviceKind): VirtualDevice | undefined {
  return getDevice(id) ?? getDevice(resolveDeviceId(id));
}

export function isDeviceKind(value: unknown): value is DeviceKind {
  return isRegisteredDevice(value) || isRegisteredDevice(resolveDeviceId(String(value)));
}

/** Catalog projection consumed by the Add Device modal. */
export const DEVICE_LIBRARY_ITEMS: readonly DeviceLibraryItem[] = libraryItems();

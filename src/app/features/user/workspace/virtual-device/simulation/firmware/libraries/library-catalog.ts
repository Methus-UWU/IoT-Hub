/**
 * Which Arduino library drives which catalog part, and how.
 *
 * The one place this is written. The simulator emulates exactly these (see
 * `index.ts`), and `scripts/export-device-catalog.ts` hands the same table to the
 * API, where the assistant reads it with each part — so the sketch it writes uses
 * the library the canvas can run, with the constructor and methods shown here.
 */
export interface LibraryReference {
  /** Name in the Arduino Library Manager. */
  readonly name: string;
  /** PlatformIO `lib_deps` entry. Absent for libraries that ship with the core. */
  readonly platformio?: string;
  readonly includes: readonly string[];
  /** Catalog device ids this library drives. */
  readonly devices: readonly string[];
  /** A minimal correct use: declaration, setup, and the calls that matter. */
  readonly usage: string;
  /** Anything the simulator does not reproduce, stated so no one relies on it. */
  readonly limits?: string;
}

export const LIBRARY_CATALOG: readonly LibraryReference[] = [
  {
    name: 'WiFi + HTTPClient — ESP32 core',
    includes: ['WiFi.h', 'HTTPClient.h', 'WiFiClient.h', 'WiFiClientSecure.h'],
    devices: [],
    usage: 'WiFi.begin(ssid, password); if (WiFi.status() == WL_CONNECTED) { HTTPClient http; http.begin(url); int code = http.GET(); http.end(); }',
    limits: 'Browser sandbox only: WiFi reports a virtual local connection. HTTP methods return -1 and never open a socket or transmit credentials.',
  },
  {
    name: 'TM1637', platformio: 'smougenot/TM1637', includes: ['TM1637Display.h'], devices: ['tm1637-display'],
    usage: 'TM1637Display display(CLK_PIN, DIO_PIN); setup: display.setBrightness(7); loop: display.showNumberDec(count); display.showNumberDecEx(hhmm, 0x40, true);',
    limits: 'Four digits, setSegments/encodeDigit/clear and decimal numbers. CLK/DIO are GPIO, not I2C. No protocol timing.',
  },
  {
    name: 'LedControl', platformio: 'wayoda/LedControl', includes: ['LedControl.h'], devices: ['max7219-matrix'],
    usage: 'LedControl matrix(DIN_PIN, CLK_PIN, CS_PIN, 1); setup: matrix.shutdown(0, false); matrix.setIntensity(0, 8); matrix.clearDisplay(0); loop: matrix.setLed(0, row, col, true); matrix.setRow(0, row, 0xFF); Power from 5 V.',
    limits: 'One 8x8 module per pin set; no daisy chain. DIN/CLK/CS use GPIO (software serial).',
  },
  {
    name: 'RTClib', platformio: 'adafruit/RTClib', includes: ['Wire.h', 'RTClib.h'], devices: ['rtc-ds1307'],
    usage: 'RTC_DS1307 rtc; setup: Wire.begin(); if (!rtc.begin()) { /* check power and SDA/SCL */ } DateTime initial(2026, 9, 26, 12, 0, 0); rtc.adjust(initial); loop: DateTime now = rtc.now(); int hh = now.hour(); int mm = now.minute(); Power VCC from 5 V; I2C address 0x68.',
    limits: 'Virtual UTC clock while powered. No battery persistence, SQW, NVRAM or raw registers. DateTime supports numeric constructors and calendar getters. begin/now need both SDA and SCL.',
  },
  {
    name: 'MFRC522', platformio: 'miguelbalboa/MFRC522', includes: ['SPI.h', 'MFRC522.h'], devices: ['rfid-rc522'],
    usage: 'MFRC522 reader(SS_PIN, RST_PIN); setup: SPI.begin(); reader.PCD_Init(); loop: if (reader.PICC_IsNewCardPresent() && reader.PICC_ReadCardSerial()) { for (int i = 0; i < reader.uid.size; i++) Serial.println(reader.uid.uidByte[i], HEX); reader.PICC_HaltA(); reader.PCD_StopCrypto1(); } VCC is 3.3 V only; the pin labelled SDA is SPI CS, not I2C.',
    limits: 'Card presence and four-byte UID via inspector. SPI and RST must be wired. No authentication, encrypted sectors, card writes, anticollision or RF physics. UID is not an access-control credential.',
  },
  {
    name: 'Adafruit ILI9341', platformio: 'adafruit/Adafruit ILI9341', includes: ['SPI.h', 'Adafruit_GFX.h', 'Adafruit_ILI9341.h'], devices: ['tft-ili9341-touch'],
    usage: 'Adafruit_ILI9341 tft(CS_PIN, DC_PIN, -1); setup: SPI.begin(); tft.begin(); tft.fillScreen(ILI9341_BLACK); tft.setTextSize(1); tft.setTextColor(ILI9341_WHITE); loop: tft.setCursor(0, 0); tft.print("Hello"); Wire VCC and LED to 3.3 V, GND to ground, RST high; MOSI/SCK/CS/DC must match the code.',
    limits: 'Text preview only, portrait rotation 0, text size 1; foreground color is frame-wide. No graphics, bitmaps, SD card, reset timing or other constructors. Unsupported methods fail explicitly.',
  },
  {
    name: 'XPT2046_Touchscreen', platformio: 'paulstoffregen/XPT2046_Touchscreen', includes: ['SPI.h', 'XPT2046_Touchscreen.h'], devices: ['tft-ili9341-touch'],
    usage: 'XPT2046_Touchscreen touch(TOUCH_CS_PIN); setup: SPI.begin(); touch.begin(); loop: if (touch.touched()) { TS_Point p = touch.getPoint(); Serial.println(p.x); Serial.println(p.y); } Wire T_CLK/T_DIN/T_DO to SPI SCK/MOSI/MISO; T_CS is separate from TFT CS. T_IRQ is optional.',
    limits: 'Raw 0..4095 coordinates and touch state come from inspector controls. No pressure calibration or interrupt timing.',
  },
  {
    name: 'Adafruit BME280 Library', platformio: 'adafruit/Adafruit BME280 Library', includes: ['Wire.h', 'Adafruit_BME280.h'], devices: ['bme280'],
    usage: 'Adafruit_BME280 sensor; setup: Wire.begin(); if (!sensor.begin(0x76)) { /* check address/power */ } loop: float t = sensor.readTemperature(); float h = sensor.readHumidity(); float hpa = sensor.readPressure() / 100.0; Power from 3.3 V; address must match the part setting.',
    limits: 'I2C only. Inspector values, no calibration registers, filtering or sampling timing. Both SDA/SCL required; disconnected readings are NAN.',
  },
  {
    name: 'DHT sensor library',
    platformio: 'adafruit/DHT sensor library@^1.4.6',
    includes: ['DHT.h'],
    devices: ['dht11', 'dht22'],
    usage: [
      'DHT dht(DHT_PIN, DHT22);   // DHT11 for the blue sensor',
      'setup: dht.begin();',
      'float t = dht.readTemperature();   // °C, NAN when the sensor does not answer',
      'float h = dht.readHumidity();',
      'if (isnan(t) || isnan(h)) { /* skip this reading */ }',
      'Read at most every 2 s.',
    ].join('\n'),
  },
  {
    name: 'Adafruit SSD1306',
    platformio: 'adafruit/Adafruit SSD1306@^2.5.9',
    includes: ['Wire.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h'],
    devices: ['oled-096-i2c'],
    usage: [
      'Adafruit_SSD1306 display(128, 64, &Wire, -1);',
      'setup: if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { /* not found */ }',
      'display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);',
      'display.setCursor(0, 0); display.print("Temp: "); display.print(t, 1);',
      'display.setCursor(0, 16); display.print(...);   // y in pixels; a size-1 line is 8 px tall',
      'The panel is 128×64: 21 characters per line at size 1, 10 at size 2. Keep each line within that; text past the edge is cut off.',
      'display.display();   // nothing shows until this is called',
    ].join('\n'),
    limits:
      'Text is drawn on the real 128×64 grid; lines, shapes and bitmaps are accepted but not drawn.',
  },
  {
    name: 'LiquidCrystal I2C',
    platformio: 'marcoschwartz/LiquidCrystal_I2C@^1.1.4',
    includes: ['Wire.h', 'LiquidCrystal_I2C.h'],
    devices: ['lcd', 'lcd2004i2c'],
    usage: [
      'LiquidCrystal_I2C lcd(0x27, 16, 2);   // (0x27, 20, 4) for the 20x4',
      'Two displays share SDA/SCL but need different addresses: add the second with settings {"address": "0x3F"} and declare LiquidCrystal_I2C lcd2(0x3F, 20, 4). The address in code must equal the part setting.',
      'setup: lcd.init(); lcd.backlight();',
      'lcd.setCursor(col, row); lcd.print("text");',
      'lcd.clear();',
      'The module needs 5 V (VIN on an ESP32).',
    ].join('\n'),
  },
  {
    name: 'tone() — Arduino core, no library',
    includes: [],
    devices: ['buzzer-passive'],
    usage: [
      'tone(BUZZER_PIN, 523);         // play C5 until noTone()',
      'tone(BUZZER_PIN, 523, 200);    // or for 200 ms',
      'noTone(BUZZER_PIN);',
      'For a melody, keep arrays of frequencies and durations and advance by millis(), not delay(), so the rest of the sketch keeps running.',
      'On an ESP32 core 2.x, ledcSetup/ledcAttachPin/ledcWriteTone(channel, hz) also work.',
    ].join('\n'),
  },
  {
    name: 'LEDC PWM — ESP32 core, no library',
    includes: [],
    devices: ['rgb-led-common-cathode', 'rgb-led-common-anode'],
    usage: [
      'Core 2.x: ledcSetup(channel, 5000, 8); ledcAttachPin(pin, channel); ledcWrite(channel, 0–255);',
      'Core 3.x: ledcAttach(pin, 5000, 8); ledcWrite(pin, 0–255);',
      'One channel per colour. On a common-anode LED the duty is inverted: 255 is off.',
      'On an Arduino Uno use analogWrite(pin, 0–255) on the ~ pins.',
    ].join('\n'),
  },
  {
    name: 'ESP32Servo (ESP32) / Servo (AVR)',
    platformio: 'madhephaestus/ESP32Servo@^3.0.5',
    includes: ['ESP32Servo.h'],
    devices: ['servo'],
    usage: [
      'Servo arm;   // #include <Servo.h> on an Arduino Uno/Nano/Mega instead',
      'setup: arm.attach(SERVO_PIN);',
      'arm.write(angle);   // 0–180',
      'Power the servo from 5 V, not 3V3, with a common ground.',
    ].join('\n'),
  },
  {
    name: 'DallasTemperature + OneWire',
    platformio: 'milesburton/DallasTemperature@^3.11.0',
    includes: ['OneWire.h', 'DallasTemperature.h'],
    devices: ['ds18b20'],
    usage: [
      'OneWire oneWire(ONE_WIRE_PIN);',
      'DallasTemperature sensors(&oneWire);',
      'setup: sensors.begin();',
      'sensors.requestTemperatures(); float t = sensors.getTempCByIndex(0);',
      'if (t == DEVICE_DISCONNECTED_C) { /* probe not found */ }',
    ].join('\n'),
  },
];

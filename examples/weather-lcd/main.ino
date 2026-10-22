#include <Wire.h>
#include <Adafruit_BME280.h>
#include <LiquidCrystal_I2C.h>
Adafruit_BME280 sensor;
LiquidCrystal_I2C lcd(0x27, 16, 2);
bool ready = false;
void setup() {
  Wire.begin();
  ready = sensor.begin(0x76);
  lcd.init();
  lcd.backlight();
}
void loop() {
  lcd.clear();
  if (ready) {
    lcd.setCursor(0, 0);
    lcd.print("T:"); lcd.print(sensor.readTemperature(), 1);
    lcd.print(" H:"); lcd.print(sensor.readHumidity(), 1);
    lcd.setCursor(0, 1);
    lcd.print(sensor.readPressure() / 100.0, 1); lcd.print(" hPa");
  } else {
    lcd.print("Sensor offline");
  }
  delay(1000);
}

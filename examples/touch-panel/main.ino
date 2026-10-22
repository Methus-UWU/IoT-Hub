#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <XPT2046_Touchscreen.h>
Adafruit_ILI9341 tft(5, 27, -1);
XPT2046_Touchscreen touch(26);
void setup() {
  SPI.begin();
  tft.begin();
  touch.begin();
  touch.setRotation(1);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_WHITE);
}
void loop() {
  tft.fillScreen(ILI9341_BLACK);
  tft.setCursor(0, 0);
  if (touch.touched()) {
    TS_Point point = touch.getPoint();
    tft.print("Touch "); tft.print(point.x); tft.print(","); tft.print(point.y);
  } else {
    tft.print("Ready");
  }
  delay(200);
}

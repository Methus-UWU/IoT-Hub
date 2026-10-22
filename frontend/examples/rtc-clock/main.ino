#include <Wire.h>
#include <RTClib.h>
#include <TM1637Display.h>
RTC_DS1307 rtc;
TM1637Display display(18, 19);
bool ready = false;
void setup() {
  Serial.begin(115200);
  Wire.begin();
  ready = rtc.begin();
  display.setBrightness(7);
  if (ready) {
    DateTime initial(2026, 9, 26, 12, 34, 56);
    rtc.adjust(initial);
  }
}
void loop() {
  if (ready) {
    DateTime now = rtc.now();
    display.showNumberDecEx(now.hour() * 100 + now.minute(), 0x40, true);
    Serial.println(now.second());
  }
  delay(250);
}

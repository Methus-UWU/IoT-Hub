#include <TM1637Display.h>
TM1637Display display(18, 19);
int count = 0;
bool previous = false;
void setup() {
  pinMode(27, INPUT);
  display.setBrightness(7);
}
void loop() {
  bool detected = digitalRead(27) == LOW;
  if (detected && !previous) count++;
  previous = detected;
  display.showNumberDec(count);
  delay(100);
}

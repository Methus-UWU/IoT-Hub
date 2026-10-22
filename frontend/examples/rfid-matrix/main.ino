#include <SPI.h>
#include <MFRC522.h>
#include <LedControl.h>
MFRC522 reader(5, 27);
LedControl matrix(25, 26, 32, 1);
void setup() {
  Serial.begin(115200);
  SPI.begin();
  reader.PCD_Init();
  matrix.shutdown(0, false);
  matrix.setIntensity(0, 8);
  matrix.clearDisplay(0);
}
void loop() {
  if (reader.PICC_IsNewCardPresent() && reader.PICC_ReadCardSerial()) {
    matrix.setRow(0, 0, 255);
    for (int i = 0; i < reader.uid.size; i++) {
      Serial.print(reader.uid.uidByte[i], HEX); Serial.print(" ");
    }
    Serial.println();
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
  }
  delay(100);
}

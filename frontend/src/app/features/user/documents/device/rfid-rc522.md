# RFID RC522

โมดูลอ่านบัตร 13.56 MHz ใช้ไฟและ logic 3.3 V ต่อ MOSI/MISO/SCK เข้าบัส SPI
**ขา SDA บนโมดูลนี้เป็น CS ของ SPI ไม่ใช่ SDA ของ I2C**
ต่อ RST เข้าขาที่ส่งให้ constructor ส่วน IRQ ไม่จำเป็นในตัวอย่าง polling

ESP32 DevKit V1 ใช้ MOSI GPIO23, MISO GPIO19, SCK GPIO18 ตามค่าเริ่มต้น
ตัวอย่าง `frontend/examples/rfid-matrix` ใช้ CS GPIO5 และ RST GPIO27
พร้อม MAX7219 แสดงว่าพบบัตร และพิมพ์ UID ผ่าน Serial

```cpp
#include <SPI.h>
#include <MFRC522.h>
MFRC522 reader(5, 27);
void setup() {
  Serial.begin(115200);
  SPI.begin();
  reader.PCD_Init();
}
void loop() {
  if (reader.PICC_IsNewCardPresent() && reader.PICC_ReadCardSerial()) {
    for (int i = 0; i < reader.uid.size; i++) {
      Serial.println(reader.uid.uidByte[i], HEX);
    }
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
  }
  delay(100);
}
```

เริ่ม simulator แล้วเปิด “แตะบัตร” ใน inspector UID รับ hex สี่ byte
เช่น `DE AD BE EF` หลัง HaltA ให้ปิดและเปิด “แตะบัตร” เพื่อสแกนใหม่
ถ้าไม่มีไฟ กราวด์ SPI หรือ RST จะไม่พบบัตร
ตัวจำลองยังไม่รองรับ authentication, เขียนบัตร, anticollision และ encrypted sectors
UID เป็นตัวระบุที่คัดลอกได้ ไม่ใช่หลักฐานยืนยันสิทธิ์สำหรับระบบประตูจริง

อ้างอิง API: [MFRC522](https://github.com/miguelbalboa/rfid)

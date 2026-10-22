# DS1307 RTC

ใช้ทำโปรเจกต์นาฬิกาและบันทึกเวลา ต่อ VCC ที่ 5 V และกราวด์ร่วมกับบอร์ด
ต่อ SDA/SCL เข้าบัส I2C บน ESP32 DevKit V1 ใช้ GPIO21/GPIO22 เป็นค่าเริ่มต้น
ที่อยู่ของ DS1307 คือ 0x68 ขา SQW ไม่จำเป็นสำหรับการอ่านเวลา

```cpp
#include <Wire.h>
#include <RTClib.h>
RTC_DS1307 rtc;
bool ready = false;
void setup() {
  Serial.begin(115200);
  Wire.begin();
  ready = rtc.begin();
  if (ready) {
    DateTime initial(2026, 9, 26, 12, 0, 0);
    rtc.adjust(initial);
  }
}
void loop() {
  if (ready) {
    DateTime now = rtc.now();
    Serial.println(now.hour());
  }
  delay(1000);
}
```

ตัวอย่างนาฬิกาพร้อมจออยู่ใน `frontend/examples/rtc-clock`
ตัวจำลองเดินเวลาตาม virtual clock โดยเริ่มจากค่า Unix UTC ใน inspector
หรือค่าที่ sketch ส่งผ่าน adjust รองรับ DateTime แบบตัวเลขเท่านั้น
ยังไม่มี battery persistence, SQW, NVRAM หรือการอ่าน register ดิบ
การ Stop/Start เริ่มเวลาใหม่ตามค่าเริ่มต้น และ `now()` จะแจ้งข้อผิดพลาดเมื่อ RTC ไม่ตอบ

บนฮาร์ดแวร์จริงให้ตั้งเวลาด้วย adjust เฉพาะตอนต้องการตั้งเวลาใหม่
ตรวจแรงดัน pull-up SDA/SCL ของ breakout; ใช้ตัวแปลงระดับ I2C เมื่อ pull-up เป็น 5 V
ก่อนต่อกับ ESP32 และตรวจชนิดแบตเตอรี่ให้ตรงกับวงจรชาร์จของโมดูล

อ้างอิง API: [Adafruit RTClib](https://github.com/adafruit/RTClib)

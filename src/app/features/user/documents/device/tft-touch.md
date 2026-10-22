# จอ ILI9341 พร้อม XPT2046 touchscreen

จอและ touch controller ใช้ SPI ร่วมกัน แต่มี CS แยกกัน
ต่อ MOSI/SCK ของจอและ T_DIN/T_CLK ของ touch ไปยังบัสเดียวกัน
ต่อ T_DO ไปยัง MISO และใช้ T_CS คนละ GPIO กับ CS ของจอ
DC เป็นขาควบคุมของจอ ต้องตรงกับ constructor
ใช้ไฟ 3.3 V กับโมดูลที่จำลองนี้ ต่อ LED สำหรับ backlight และ RST ค้าง HIGH
ไม่ใช้ขา T_IRQ ในตัวอย่าง polling

ตัวอย่างที่มีรายการสายครบอยู่ใน `frontend/examples/touch-panel`
บน ESP32 DevKit V1 ใช้ MOSI 23, MISO 19, SCK 18, TFT CS 5, DC 27 และ touch CS 26

```cpp
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <XPT2046_Touchscreen.h>
Adafruit_ILI9341 tft(5, 27, -1);
XPT2046_Touchscreen touch(26);
void setup() {
  SPI.begin(); tft.begin(); touch.begin();
  tft.setTextSize(1); tft.setTextColor(ILI9341_WHITE);
}
void loop() {
  tft.fillScreen(ILI9341_BLACK); tft.setCursor(0, 0);
  if (touch.touched()) {
    TS_Point point = touch.getPoint();
    tft.print(point.x); tft.print(","); tft.print(point.y);
  } else { tft.print("Ready"); }
  delay(200);
}
```

ใน simulator ใช้ “สัมผัสหน้าจอ” และ touchX/touchY ใน inspector
เป็นพิกัดดิบ 0–4095 ยังไม่ได้ปรับเทียบให้เป็น pixel ของจอ
ภาพ TFT เป็น text preview รองรับ portrait rotation 0, text size 1 และสีข้อความเดียวต่อ frame
ไม่รองรับ graphics, bitmap, SD card, reset timing และการลากนิ้วบนภาพ canvas
คำสั่งที่ไม่รองรับจะแจ้งข้อผิดพลาด ไม่แสดงผลสำเร็จหลอก

อ้างอิง: [Adafruit ILI9341](https://github.com/adafruit/Adafruit_ILI9341),
[XPT2046 Touchscreen](https://github.com/PaulStoffregen/XPT2046_Touchscreen)

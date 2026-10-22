# จอ LED matrix และ seven-segment

## เลือกจอ

| โมดูล | ใช้ทำอะไร | ไลบรารี |
| --- | --- | --- |
| MAX7219 8×8 | แสดงจุด สัญลักษณ์ และสถานะ | LedControl |
| TM1637 4 หลัก | ตัวนับและนาฬิกา | TM1637Display |

ต่อ VCC และ GND ให้ครบ และใช้กราวด์ร่วมกับบอร์ด ขา DIN/CLK/CS ของ MAX7219
เป็น software serial ที่เลือก GPIO ได้ ส่วน CLK/DIO ของ TM1637 **ไม่ใช่ I2C**
จึงไม่ต้องต่อร่วมกับ SDA/SCL ของเซนเซอร์

```cpp
#include <LedControl.h>
LedControl matrix(25, 26, 32, 1); // DIN, CLK, CS, module count
void setup() {
  matrix.shutdown(0, false);
  matrix.setIntensity(0, 8);
  matrix.clearDisplay(0);
}
void loop() {
  matrix.setRow(0, 0, 0xFF);
  delay(100);
}
```

```cpp
#include <TM1637Display.h>
TM1637Display display(18, 19); // CLK, DIO
void setup() { display.setBrightness(7); }
void loop() {
  display.showNumberDecEx(1234, 0x40, true);
  delay(1000);
}
```

ตัวอย่างที่ทดสอบกับ simulator อยู่ใน `frontend/examples/ir-counter`,
`rtc-clock` และ `rfid-matrix` แต่ละโฟลเดอร์มี `main.ino` และรายการสาย `circuit.json`
สำหรับวางวงจรตามใน workspace

## ขอบเขตตัวจำลอง

MAX7219 รองรับหนึ่งโมดูลต่อชุดขา, setLed, setRow, setColumn, clearDisplay,
shutdown และ setIntensity ยังไม่รองรับ daisy chain หรือจอเลข MAX7219
TM1637 รองรับเลขฐานสิบ, segment mask, clear และจุด/colon mask
ภาพจำลองแสดง bit จุดเป็นจุดข้างหลัก ความสว่าง TM1637 ยังไม่ได้จำลองระดับแสงจริง
การถอด clock, data, CS หรือไฟเลี้ยงทำให้จอไม่ได้รับ frame

สำหรับฮาร์ดแวร์จริง MAX7219 ที่เลี้ยง 5 V ควรใช้ตัวแปลงระดับ logic จาก ESP32
และตรวจ pull-up ของ TM1637 ก่อนต่อเข้าขา 3.3 V

อ้างอิง API: [LedControl](https://github.com/wayoda/LedControl),
[TM1637](https://github.com/avishorp/TM1637)

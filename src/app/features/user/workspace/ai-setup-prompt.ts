/**
 * The request sent when a project is created from a description.
 *
 * One place, so the setup page and the IDE's "generate from description" ask for the
 * same thing: every part the description implies, wired, configured, and coded.
 */
export function aiSetupPrompt(description: string): string {
  return `${description.trim()}

เลือกอุปกรณ์จากคลังและสร้างแผนอุปกรณ์ สายไฟ และการแก้ไฟล์ให้ครบตามคำอธิบายนี้ อ่าน datasheet ของทุกอุปกรณ์ที่จะเพิ่มก่อนต่อสายและก่อนเขียนโค้ด แล้วทำตามข้อกำหนดในนั้น เช่น ตัวต้านทานพูลอัปหรือขาที่ทำงานที่ลอจิกต่ำ ตั้งค่าอุปกรณ์ให้ตรงกับคำอธิบาย เช่น สีของ LED ต่อโหลดที่ใช้ไฟแยกผ่านรีเลย์พร้อมแหล่งจ่ายของมัน อ่านไฟล์ก่อนแก้ แล้วแทนที่พฤติกรรมของโค้ดเริ่มต้นที่ไม่ตรงกับงาน เช่น เซนเซอร์หรือการรอ Wi-Fi ที่งานนี้ไม่ได้ใช้ ก่อนจบให้ตรวจว่าทุกอย่างในคำอธิบายมีครบแล้ว เสนอแผนให้ยอมรับ ไม่ใช่เพียงตัวอย่างโค้ดในแชต`;
}

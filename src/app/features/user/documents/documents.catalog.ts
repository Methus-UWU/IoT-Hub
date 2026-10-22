import deployServer from './guides/deploy-server.md';
import devicePins from './guides/device-pins.md';
import firstEsp32 from './guides/first-esp32.md';
import ota from './guides/ota.md';
import webApi from './guides/web-api.md';
import wifiReconnect from './guides/wifi-reconnect.md';
import platformOverview from './guides/platform-overview.md';
import projectManagement from './guides/project-management.md';
import ideFiles from './guides/ide-files.md';
import virtualCircuit from './guides/virtual-circuit.md';
import simulationWorkflow from './guides/simulation-workflow.md';
import projectAi from './guides/project-ai.md';
import dashboardBuilder from './guides/dashboard-builder.md';
import documentLibrary from './guides/document-library.md';
import community from './guides/community.md';
import troubleshooting from './guides/troubleshooting.md';
import basicWiring from './guides/basic-wiring.md';

export type DocumentCategory =
  | 'all'
  | 'getting-started'
  | 'workspace'
  | 'devices'
  | 'connectivity'
  | 'deployment'
  | 'community'
  | 'troubleshooting';

export type ArticleCategory = Exclude<DocumentCategory, 'all'>;

export interface KnowledgeArticle {
  id: string;
  title: string;
  description: string;
  category: ArticleCategory;
  readTime: string;
  level: 'ระดับเริ่มต้น' | 'ระดับกลาง';
  /** Raw Markdown body, loaded from the sibling `guides/` file at build time. */
  body: string;
  wiringExample?: 'esp32-basics';
  illustration?: {
    src: string;
    alt: string;
    width: number;
    height: number;
    caption: string;
  };
}

export const CATEGORY_LABELS: Readonly<Record<DocumentCategory, string>> = {
  all: 'คู่มือทั้งหมด',
  'getting-started': 'เริ่มต้นใช้งาน',
  workspace: 'พื้นที่ทำงานและ AI',
  devices: 'อุปกรณ์และบอร์ด',
  connectivity: 'การเชื่อมต่อ',
  deployment: 'การนำขึ้นใช้งาน',
  community: 'ชุมชนและการแบ่งปัน',
  troubleshooting: 'การแก้ปัญหา',
};

/**
 * Guide prose lives in `guides/*.md` so it can be written and reviewed as text;
 * only the metadata the browser needs for filtering stays here. Adding a guide
 * means adding both the file and its entry.
 */
export const ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: 'basic-wiring',
    title: 'ภาพตัวอย่างการต่ออุปกรณ์พื้นฐาน',
    description:
      'ดูวงจรตัวอย่าง ESP32 วงจรรวมและอีก 10 อุปกรณ์ เช่น LED ปุ่มกด เซนเซอร์ DHT22 PIR เซอร์โว รีเลย์ และจอ OLED เลือกดูสายแต่ละเส้น พร้อมตารางขาและข้อควรระวัง',
    category: 'devices',
    readTime: '12 นาที',
    level: 'ระดับเริ่มต้น',
    body: basicWiring,
    wiringExample: 'esp32-basics',
    illustration: {
      src: '/images/guides/basic-wiring.svg',
      alt: 'แผนผัง 3 วงจร: ESP32 ต่อ LED ผ่านตัวต้านทาน 220 โอห์มที่ GPIO 23, ปุ่มกดที่ GPIO 18 และเซนเซอร์เสียงที่ GPIO 19 โดยมีตารางอธิบายการต่อสายใต้ภาพ',
      width: 960,
      height: 1140,
      caption:
        'แผนผังแสดงการเชื่อมต่อ ไม่ใช่ตำแหน่งขาจริงบนบอร์ด ให้ตรวจชื่อขาที่พิมพ์บนอุปกรณ์ก่อนต่อสาย',
    },
  },
  {
    id: 'platform-overview',
    title: 'เริ่มใช้งาน IoT Hub ทีละขั้น',
    description: 'รู้จักแต่ละหน้า เตรียมงาน และเลือกเส้นทางจากโปรเจกต์แรกไปสู่การจำลองและทดสอบ',
    category: 'getting-started',
    readTime: '7 นาที',
    level: 'ระดับเริ่มต้น',
    body: platformOverview,
  },
  {
    id: 'project-management',
    title: 'สร้างและจัดการโปรเจกต์',
    description: 'เลือกบอร์ด เฟรมเวิร์ก อุปกรณ์ และโหมด AI ค้นหา เปิดงานเดิม และลบโปรเจกต์',
    category: 'getting-started',
    readTime: '9 นาที',
    level: 'ระดับเริ่มต้น',
    body: projectManagement,
  },
  {
    id: 'first-esp32',
    title: 'สร้างโปรเจกต์ ESP32 ตัวแรก',
    description: 'สร้างโปรเจกต์ บันทึกโค้ด และดูข้อความ Serial ในการจำลองโดยยังไม่ต้องมีบอร์ดจริง',
    category: 'getting-started',
    readTime: '8 นาที',
    level: 'ระดับเริ่มต้น',
    body: firstEsp32,
  },
  {
    id: 'ide-files',
    title: 'ใช้ IDE และจัดการไฟล์โค้ด',
    description:
      'เปิดไฟล์หลัก บันทึกอัตโนมัติและ Save เพิ่มหรือลบไฟล์ อ่าน Compile output และสำรองงาน',
    category: 'workspace',
    readTime: '9 นาที',
    level: 'ระดับเริ่มต้น',
    body: ideFiles,
  },
  {
    id: 'virtual-circuit',
    title: 'ต่อวงจรใน Virtual Device',
    description: 'เพิ่มอุปกรณ์ ต่อขา แก้สาย จัดวาง หมุน ซูม และตรวจวงจรก่อนเริ่มจำลอง',
    category: 'devices',
    readTime: '9 นาที',
    level: 'ระดับเริ่มต้น',
    body: virtualCircuit,
  },
  {
    id: 'simulation-workflow',
    title: 'จำลองโค้ดและอ่าน Serial monitor',
    description: 'ใช้ Start และ Stop ทดลองอินพุต ตรวจข้อความและข้อผิดพลาด พร้อมขอบเขตของ Simulator',
    category: 'workspace',
    readTime: '8 นาที',
    level: 'ระดับเริ่มต้น',
    body: simulationWorkflow,
  },
  {
    id: 'project-ai',
    title: 'ใช้ผู้ช่วย AI กับโปรเจกต์',
    description: 'เขียนคำขอ ตรวจแผนอุปกรณ์ สาย และไฟล์ ยอมรับข้อเสนอ แล้วทดสอบผลที่ได้',
    category: 'workspace',
    readTime: '8 นาที',
    level: 'ระดับเริ่มต้น',
    body: projectAi,
  },
  {
    id: 'dashboard-builder',
    title: 'ออกแบบหน้าจอด้วย Dashboard Builder',
    description:
      'เพิ่มวิดเจ็ต ตั้งค่า จัดเลย์เอาต์หลายขนาด ใช้ Preview และ Save พร้อมข้อจำกัดของ Publish',
    category: 'workspace',
    readTime: '8 นาที',
    level: 'ระดับเริ่มต้น',
    body: dashboardBuilder,
  },
  {
    id: 'document-library',
    title: 'ค้นคู่มือและเปรียบเทียบอุปกรณ์',
    description: 'ค้นหาเอกสาร อ่านตารางขาและข้อมูลรุ่น เปรียบเทียบอุปกรณ์ 2–4 ชิ้น และใช้ตัวกรอง',
    category: 'getting-started',
    readTime: '6 นาที',
    level: 'ระดับเริ่มต้น',
    body: documentLibrary,
  },
  {
    id: 'device-pins',
    title: 'ขาและโปรไฟล์บอร์ด',
    description: 'เข้าใจหมายเลขขาและข้อจำกัดของบอร์ดก่อนนำไปต่อวงจรและเขียนโค้ด',
    category: 'devices',
    readTime: '6 นาที',
    level: 'ระดับเริ่มต้น',
    body: devicePins,
  },
  {
    id: 'wifi-reconnect',
    title: 'รูปแบบการต่อ Wi-Fi ใหม่ที่เชื่อถือได้',
    description: 'ทำให้บอร์ดที่อยู่ไกลกลับมาออนไลน์ได้เองโดยไม่หยุดลูปอ่านเซนเซอร์',
    category: 'connectivity',
    readTime: '10 นาที',
    level: 'ระดับกลาง',
    body: wifiReconnect,
  },
  {
    id: 'web-api',
    title: 'เปิดข้อมูลผ่าน Web API',
    description: 'ส่งค่าเซนเซอร์เป็น JSON จากปลายทางบน ESP32 ให้แดชบอร์ดเรียกใช้',
    category: 'connectivity',
    readTime: '12 นาที',
    level: 'ระดับกลาง',
    body: webApi,
  },
  {
    id: 'deploy-server',
    title: 'Compile อัปโหลด และตรวจบอร์ดจริง',
    description:
      'คอมไพล์บนเซิร์ฟเวอร์ เลือกพอร์ต USB ผ่านเบราว์เซอร์ Upload ลงบอร์ด และอ่าน Serial',
    category: 'deployment',
    readTime: '7 นาที',
    level: 'ระดับเริ่มต้น',
    body: deployServer,
  },
  {
    id: 'ota',
    title: 'ตั้งค่าการอัปเดตผ่าน OTA',
    description:
      'แนวทางเตรียมเฟิร์มแวร์สำหรับอัปเดตผ่าน Wi-Fi บนบอร์ดจริง โดยต้องตั้งค่าเครื่องมือ OTA แยก',
    category: 'deployment',
    readTime: '14 นาที',
    level: 'ระดับกลาง',
    body: ota,
  },
  {
    id: 'community',
    title: 'ใช้งานชุมชน ถาม ตอบ และโหวต',
    description: 'ค้นกระทู้ ตั้งคำถามด้วย Markdown เลือกหัวข้อ ตอบกลับ แก้ข้อความ และยอมรับคำตอบ',
    category: 'community',
    readTime: '10 นาที',
    level: 'ระดับเริ่มต้น',
    body: community,
  },
  {
    id: 'troubleshooting',
    title: 'แก้ปัญหาการใช้งานทีละขั้น',
    description:
      'ตรวจปัญหาโหลด บันทึก จำลอง AI พอร์ต USB และแดชบอร์ด พร้อมข้อมูลที่ใช้ขอความช่วยเหลือ',
    category: 'troubleshooting',
    readTime: '7 นาที',
    level: 'ระดับเริ่มต้น',
    body: troubleshooting,
  },
];

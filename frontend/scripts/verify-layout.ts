/**
 * Checks the auto-layout used after the assistant adds parts.
 *
 * Builds the relay + status LED circuit the assistant produces — relay IN on a
 * GPIO, GPIO → resistor → LED → GND — with every new part stacked at the spawn
 * origin, lays it out, and asserts on where the parts landed.
 *
 * Run it from `frontend/`:
 *
 *   npx tsx scripts/verify-layout.ts
 */

import { deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { drawingScaleFor } from '../src/app/features/user/workspace/virtual-device/devices/core/device-metrics';
import {
  layoutNewParts,
  type LayoutPart,
  type LayoutWire,
} from '../src/app/features/user/workspace/virtual-device/layout/auto-layout';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

function part(id: string, definitionId: string, x: number, y: number): LayoutPart {
  const definition = deviceById(definitionId);
  if (!definition) throw new Error(`ไม่พบอุปกรณ์ ${definitionId} ใน catalog`);
  return { id, definition, x, y, rotation: 0 };
}

function wire(from: [string, string], to: [string, string]): LayoutWire {
  return {
    from: { componentId: from[0], pinId: from[1] },
    to: { componentId: to[0], pinId: to[1] },
  };
}

function box(p: LayoutPart, at = { x: p.x, y: p.y }) {
  const scale = drawingScaleFor(p.definition);
  return { x: at.x, y: at.y, width: p.definition.width * scale, height: p.definition.height * scale };
}

const board = part('board', 'esp32-devkit-v1', 0, 0);
const sensor = part('sensor', 'dht22', -400, 0);
const relay = part('relay', 'relay', 160, 160);
const resistor = part('res', 'resistor', 160, 160);
const led = part('led', 'led', 160, 160);
const parts = [board, sensor, relay, resistor, led];
const wires = [
  wire(['relay', 'IN'], ['board', 'GPIO32']),
  wire(['relay', 'VCC'], ['board', 'VIN']),
  wire(['relay', 'GND'], ['board', 'GND-L']),
  wire(['res', '1'], ['board', 'GPIO25']),
  wire(['res', '2'], ['led', 'A']),
  wire(['led', 'K'], ['board', 'GND-L']),
];

console.log('\nจัดตำแหน่งอุปกรณ์ใหม่ข้างบอร์ด');
const placed = layoutNewParts(parts, wires, ['relay', 'res', 'led']);

check('จัดครบทั้งสามชิ้น', placed.size === 3, `ได้ ${placed.size}`);
check('ไม่ย้ายอุปกรณ์เดิม', !placed.has('board') && !placed.has('sensor'));

const boardBox = box(board);
const boxes = [...placed].map(([id, at]) => ({ id, ...box(parts.find((p) => p.id === id)!, at) }));
const clear = (a: typeof boardBox, b: typeof boardBox) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

for (const item of boxes) {
  check(`${item.id} ไม่ทับบอร์ด`, clear(item, boardBox));
  check(`${item.id} ไม่ทับเซนเซอร์เดิม`, clear(item, box(sensor)));
}
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    check(`${boxes[i].id} กับ ${boxes[j].id} ไม่ทับกัน`, clear(boxes[i], boxes[j]));
  }
}

// GPIO25 and GPIO32 sit on the left header of a DevKit V1.
const res = boxes.find((item) => item.id === 'res')!;
const ledBox = boxes.find((item) => item.id === 'led')!;
check('ตัวต้านทานอยู่ฝั่งซ้ายของบอร์ด ข้างขา GPIO25', res.x + res.width <= boardBox.x);
check('LED อยู่ถัดตัวต้านทานออกไป', ledBox.x + ledBox.width <= res.x);

console.log(`\n${checks - failures}/${checks} ผ่าน`);
if (failures) process.exit(1);

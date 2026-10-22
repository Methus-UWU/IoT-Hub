# 06 · อุปกรณ์ (Device) และการต่อสาย

## 1. นิยามอุปกรณ์ — แหล่งความจริงเดียว

อุปกรณ์ทุกตัวเขียนเป็น TypeScript ไว้ที่ฝั่ง frontend:
[`frontend/src/app/features/user/workspace/virtual-device/devices/`](../frontend/src/app/features/user/workspace/virtual-device/devices/)
แยกโฟลเดอร์ตามหมวด เช่น `basic/`, `sensors/`, `microcontrollers/`, `display/`, `motor/`

ตัวอย่าง LED: [`basic/led.device.ts:271–294`](../frontend/src/app/features/user/workspace/virtual-device/devices/basic/led.device.ts#L271)

```ts
{
  id: 'led',
  pins: [
    pin('A', ANODE_X, HEIGHT, 'passive', {...}),
    pin('K', CATHODE_X, CATHODE_LENGTH, 'passive', {...}),
  ],
  properties: PROPERTIES,
  render: { draw, ... },
  simulation: createBehavior,
}
```

- `id` ใช้อ้างอิงอุปกรณ์ทุกที่ ฐานข้อมูลเก็บค่านี้ในคอลัมน์ `definition_id`
- `pins` แต่ละขามีชื่อ ตำแหน่ง x/y และชนิดขา
- `properties` คือค่าที่ผู้ใช้ตั้งได้ใน inspector เช่นสีของ LED
- `render` วาดรูปอุปกรณ์เป็นรายการ shape (SVG)
- `simulation` กำหนดพฤติกรรมตอนจำลอง

| โค้ด | หน้าที่ |
| --- | --- |
| [`core/device-pin.ts:50`](../frontend/src/app/features/user/workspace/virtual-device/devices/core/device-pin.ts#L50) | `pin(name, x, y, type, options)` สร้างขา |
| [`models/virtual-device.model.ts:74`](../frontend/src/app/features/user/workspace/virtual-device/models/virtual-device.model.ts#L74) | `interface VirtualDevice` โครงสร้างของอุปกรณ์ |
| [`devices/device-catalog.ts:174`](../frontend/src/app/features/user/workspace/virtual-device/devices/device-catalog.ts#L174) | `DEVICES` รายการอุปกรณ์ทั้งหมด |
| [`devices/device-catalog.ts:183`](../frontend/src/app/features/user/workspace/virtual-device/devices/device-catalog.ts#L183) | `deviceById(id)` หาอุปกรณ์จาก id (รองรับ id เก่าผ่าน alias) |
| [`device-art/device-art.ts`](../frontend/src/app/features/user/workspace/virtual-device/device-art/device-art.ts) | วาดอุปกรณ์ ใช้ทั้งบน canvas ในหน้าเลือกอุปกรณ์ และในคู่มือ |

### เพิ่มอุปกรณ์ใหม่
1. สร้างไฟล์ `xxx.device.ts` ในหมวดที่เหมาะสม แล้วลงทะเบียนใน `device-catalog.ts`
2. รันสคริปต์ export เพื่อให้ backend รู้จักอุปกรณ์ (ข้อ 4)
3. ถ้ามี datasheet ให้เพิ่มไฟล์ `.md` ใน `features/user/documents/device/` (AI ต้องอ่านก่อนใช้อุปกรณ์)

## 2. วางอุปกรณ์บน canvas

หน้า: [`virtual-device.page.ts`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts) (route `/user/projects/:id/virtual-device`)

```
Add Device modal ── (devicesAdded) ──► startPlacements(ids)        1506
                                         └─ startNextPlacement()    1513   ตัวอย่างอุปกรณ์ลอยตามเมาส์
คลิกบน canvas ──► dropPlacement(event)                             1548
                    └─ createDeviceInstance(kind, origin)           2361   ใส่ลง canvas ทันที
                         └─ persistNewComponent(...)                2550   บันทึกเบื้องหลัง
                              └─ canvasPersistence.add(...)         2559
                                   └─ POST .../projects/:p/components
```

- ตอนเปิดหน้า `restorePersistedComponents()` (870) โหลดอุปกรณ์และสายจาก API (`load` + `loadConnections` บรรทัด 876–877)
- `ProjectCanvasService` ([`services/project-canvas.service.ts`](../frontend/src/app/features/user/workspace/virtual-device/services/project-canvas.service.ts)) เป็นตัวกลางกับ API:
  `load` (98), `add` (112), `queueState` (149, หน่วงก่อนบันทึกค่า property), `arrangeNew` (195, จัดอุปกรณ์ที่ AI เพิ่ม), `addConnection` (243), `removeConnection` (286), `remove` (313)

## 3. ต่อสาย

```
คลิกขาแรก ──► selectDevicePin(event, deviceId, pinId)       1574
                └─ selectWireEndpoint(...)                   2677   จำขาแรกไว้เป็น pendingPin
คลิกขาที่สอง ──► finishPendingWire(endpoint)                2734
                ├─ เลือกสีจากชนิด: ground=ดำ, power=แดง, signal=เขียว   (2739)
                ├─ แทนที่เฉพาะสายที่ซ้ำเป๊ะ (ขาเดียวแตกหลายสายได้)        (2749–2760)
                ├─ recordChange() เก็บ undo/redo
                └─ persistNewConnection(connection)          2460
                     └─ canvasPersistence.addConnection(...) 2472
                          └─ POST .../projects/:p/connections
```

สายเก็บเป็น "ขา → ขา" ไม่ได้เก็บพิกัด ย้ายอุปกรณ์แล้วสายจึงตามไปเอง เก็บเฉพาะจุดหักที่ผู้ใช้ลากเอง (`waypoints`)

ตัวช่วยของสาย:

| โค้ด | หน้าที่ |
| --- | --- |
| [`simulation/wire-router.ts:192`](../frontend/src/app/features/user/workspace/virtual-device/simulation/wire-router.ts#L192) | `routeWire()` คำนวณเส้นทางสายอัตโนมัติ |
| [`simulation/wire-validation.ts:53`](../frontend/src/app/features/user/workspace/virtual-device/simulation/wire-validation.ts#L53) | `validateCircuit()` หาปัญหา เช่น 5V เข้า GPIO หรือ LED ไม่มีตัวต้านทาน (หน้า canvas เรียกที่บรรทัด 551) |
| [`layout/auto-layout.ts:70`](../frontend/src/app/features/user/workspace/virtual-device/layout/auto-layout.ts#L70) | `layoutNewParts()` จัดวางอุปกรณ์ใหม่ไม่ให้ทับกัน |
| [`simulation/circuit-simulator.ts:129`](../frontend/src/app/features/user/workspace/virtual-device/simulation/circuit-simulator.ts#L129) | `simulateTick()` จำลองวงจรทีละรอบ |

## 4. ฝั่ง Backend

### Endpoint
[`projects.controller.ts`](../backend/src/modules/projects/projects.controller.ts):
`GET/POST components` (196, 211), `PATCH/DELETE components/:id` (228, 245),
`GET/POST connections` (264, 279), `PATCH connections/:id` (296, เปลี่ยน waypoints), `DELETE connections/:id` (317)

### เพิ่มอุปกรณ์
[`project-components.service.ts:58`](../backend/src/modules/projects/project-components.service.ts#L58) `add()`
1. `assertWithinComponentLimit` (129) ตรวจโควตาจำนวนอุปกรณ์ตามแพ็กเกจ
2. `assertWithinBoardLimit` (214) จำกัดจำนวนบอร์ดต่อโปรเจกต์
3. ไม่ได้ส่งตำแหน่งมา → `nextFreePosition` (242)
4. บันทึกผ่าน repository

### เพิ่มสาย
[`project-connections.service.ts:34`](../backend/src/modules/projects/project-connections.service.ts#L34) `add()`
1. ปฏิเสธการต่อขาเข้าหาตัวเอง (`CONNECTION_SELF_LOOP`)
2. `endpointsBelongToProject` ตรวจว่าอุปกรณ์ทั้งสองฝั่งอยู่ในโปรเจกต์นี้จริง กันการอ้าง id ของโปรเจกต์คนอื่น
3. `assertWithinConnectionLimit` (103) ตรวจโควตาจำนวนสาย
4. `normaliseWaypoints` แล้วบันทึก

### Backend รู้จักขาของอุปกรณ์ได้อย่างไร
backend ไม่มีรูปอุปกรณ์ มีแต่ข้อมูลไฟฟ้าที่ export มาจาก frontend:

- สคริปต์ [`frontend/scripts/export-device-catalog.ts`](../frontend/scripts/export-device-catalog.ts) สร้างไฟล์
  [`backend/src/modules/projects/catalog/device-catalog.generated.ts`](../backend/src/modules/projects/catalog/device-catalog.generated.ts)
- สิ่งที่ส่งข้ามมา: id, ชื่อ, ขา, ชนิดขา, แรงดัน, interface, ค่าที่ตั้งได้
- สิ่งที่ไม่ส่ง: พิกัด รูปวาด และพฤติกรรมจำลอง
- วิธีรันอยู่ในคอมเมนต์ต้นไฟล์ (บรรทัด 24–30) ต้องรันใหม่ทุกครั้งที่เพิ่มหรือแก้อุปกรณ์

AI ใช้ข้อมูลชุดนี้ตอนค้นหาอุปกรณ์ (`search_device_catalog`) อ่าน pinout และตรวจว่าการต่อสายถูกกติกาไหม (ดู [04-ai-flow.md](04-ai-flow.md))

## 5. AI ต่อสายต่างจากผู้ใช้อย่างไร

| | ผู้ใช้ | AI |
| --- | --- | --- |
| เพิ่มอุปกรณ์ | `POST components` ทันทีที่วาง | `add_device` แก้ใน draft ก่อน |
| ต่อสาย | `POST connections` ทันทีที่คลิกขาที่สอง | `wire_to_board` / `connect_pins` แก้ใน draft |
| ลงฐานข้อมูล | ทุกครั้งที่ทำ | ตอนผู้ใช้ยอมรับแผน (`POST ai/apply`) ครั้งเดียว |
| service ที่เขียนจริง | `ProjectComponentsService` / `ProjectConnectionsService` | ตัวเดียวกัน (ผ่าน `AiPlanApplyService`) |

เพราะใช้ service ตัวเดียวกัน โควตาและการตรวจสิทธิ์จึงเหมือนกันทั้งสองทาง

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### นิยามอุปกรณ์: LED

[`led.device.ts:270–303`](../frontend/src/app/features/user/workspace/virtual-device/devices/basic/led.device.ts#L270)

```ts
export const LED_5MM: VirtualDevice = {
  id: 'led',
  name: 'LED',
  model: '5 mm through-hole',
  description: 'Lights when forward voltage is applied. Always pair with a series resistor.',
  x: 240,
  y: 288,
  ...BODY,
  operatingVoltage: { min: 1.8, max: 3.4, recommended: 3.3 },
  interfaces: ['digital', 'pwm'],
  pins: [
    pin('A', ANODE_X, HEIGHT, 'passive', {
      side: 'bottom',
      description: 'Anode — the longer leg, wire toward the positive supply',
    }),
    pin('K', CATHODE_X, CATHODE_LENGTH, 'passive', {
      side: 'bottom',
      description: 'Cathode — flat side of the flange, wire toward ground',
    }),
  ],
  properties: PROPERTIES,
  render: { draw, bleed: { left: u(3), right: u(3), top: u(3) } },
  requiresSeriesResistor: true,
  simulation: createBehavior,
  catalog: {
    categoryId: 'leds',
    category: 'LEDs',
    aliases: ['indicator light', 'light emitting diode', 'ไฟ LED', 'diode'],
    tags: ['led', 'output', 'indicator', 'diode', 'light', 'digital', 'pwm'],
    interfaceLabel: 'เอาต์พุตดิจิทัล · 2 ขา',
    typicalUsage: 'Power, connectivity, alarm, and application status indication.',
  },
};
```

### ฟังก์ชันสร้างขา

[`device-pin.ts:50–77`](../frontend/src/app/features/user/workspace/virtual-device/devices/core/device-pin.ts#L50)

```ts
export function pin(
  name: string,
  x: number,
  y: number,
  type: PinType,
  options: PinOptions = {},
): DevicePin {
  return {
    name,
    x,
    y,
    type,
    kind: connectionKindForPinType(type),
    direction: options.direction ?? DEFAULT_DIRECTION[type],
    ...(options.side ? { side: options.side } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(options.voltage !== undefined ? { voltage: options.voltage } : {}),
    ...(options.maxInputVoltage !== undefined
      ? { maxInputVoltage: options.maxInputVoltage }
      : {}),
    ...(options.maxCurrentMa !== undefined ? { maxCurrentMa: options.maxCurrentMa } : {}),
    ...(options.requiresBias ? { requiresBias: options.requiresBias } : {}),
    ...(options.multipleConnections !== undefined
      ? { multipleConnections: options.multipleConnections }
      : {}),
  };
}
```

### Catalog และการหาอุปกรณ์

[`device-catalog.ts:174–189`](../frontend/src/app/features/user/workspace/virtual-device/devices/device-catalog.ts#L174)

```ts
export const DEVICES: readonly VirtualDevice[] = allDevices();

export function deviceById(id: DeviceKind): VirtualDevice | undefined {
  return getDevice(id) ?? getDevice(resolveDeviceId(id));
}

export function isDeviceKind(value: unknown): value is DeviceKind {
  return isRegisteredDevice(value) || isRegisteredDevice(resolveDeviceId(String(value)));
}
```

### วางอุปกรณ์บน canvas

[`virtual-device.page.ts:1506–1511`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L1506)

```ts
  protected startPlacements(ids: readonly DeviceKind[]): void {
    this.placementQueue = ids.filter((id) => Boolean(deviceById(id)));
    if (!this.placementQueue.length) return;
    this.closeParts();
    this.startNextPlacement();
  }
```

[`virtual-device.page.ts:1548–1563`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L1548)

```ts
  private dropPlacement(event: PointerEvent): void {
    const id = this.placingDeviceId();
    const device = this.placingDevice();
    if (!id || !device) return;
    event.preventDefault();
    const point = this.svgPoint(event);
    const origin =
      this.ghostPoint() ??
      (point
        ? this.snapPoint({ x: point.x - device.width / 2, y: point.y - device.height / 2 })
        : { x: device.x, y: device.y });
    const instanceId = this.createDeviceInstance(id, origin);
    this.clearCurrentPlacement();
    if (instanceId) this.selectDevice(instanceId);
    this.startNextPlacement();
  }
```

[`virtual-device.page.ts:2361–2410`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2361)

```ts
  private createDeviceInstance(kind: DeviceKind, origin: Point): string | null {
    const definition = deviceById(kind);
    if (
      definition &&
      isBoardCategory(definition.catalog.categoryId) &&
      this.placedBoardCount() >= MAX_BOARD_COUNT
    ) {
      this.componentLimitMessage.set(`A workspace can contain up to ${MAX_BOARD_COUNT} boards.`);
      return null;
    }

    const reusable = this.persistedProjectId
      ? undefined
      : this.deviceInstances().find(
          (device) => device.id === kind && !this.placements()[device.instanceId]?.visible,
        );
    let instance = reusable;

    if (!instance) {
      const device = definition;
      if (!device) return null;
      let instanceId = `${kind}-${++this.deviceSequence}`;
      while (this.placements()[instanceId]) instanceId = `${kind}-${++this.deviceSequence}`;
      instance = { ...device, instanceId };
      this.deviceInstances.update((devices) => [...devices, instance!]);
    }

    this.placements.update((placements) => ({
      ...placements,
      [instance.instanceId]: { ...origin, rotation: 0, visible: true },
    }));
    if (instance.properties?.length) {
      this.deviceStates.update((states) => ({
        ...states,
        [instance.instanceId]: defaultStateFor(instance.properties),
      }));
    }

    if (this.persistedProjectId && !reusable) {
      void this.persistNewComponent(instance.instanceId, kind, origin);
    }

    return instance.instanceId;
  }
```

### บันทึกอุปกรณ์ใหม่ไป API

[`virtual-device.page.ts:2550–2574`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2550)

```ts
  private async persistNewComponent(
    localId: string,
    definitionId: DeviceKind,
    origin: Point,
  ): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    try {
      const created = await this.canvasPersistence.add(projectId, definitionId, {
        x: origin.x,
        y: origin.y,
      });
      if (created) {
        this.adoptServerId(localId, created.id);
        void this.refreshUsage();
      }
    } catch (error) {
      const refusal = asComponentLimitRefusal(error) ?? asBoardLimitRefusal(error);
      this.componentLimitMessage.set(refusal ? refusal.message : 'Could not save this device');
      this.discardLocalComponent(localId);
    }
  }
```

### ต่อสาย: เลือกขาแรก → ขาที่สอง → บันทึก

[`virtual-device.page.ts:2677–2701`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2677)

```ts
  private selectWireEndpoint(event: Event, endpoint: WireEndpoint): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.simulationRunning() || this.placingDeviceId()) return;

    const pending = this.pendingPin();
    if (this.endpointsEqual(pending, endpoint)) {
      this.pendingPin.set(null);
      this.wirePointer.set(null);
      this.pendingWireWaypoints.set([]);
      return;
    }

    if (pending && this.endpointsCompatible(pending, endpoint)) {
      this.finishPendingWire(endpoint);
      return;
    }

    this.pendingPin.set(endpoint);
    this.wirePointer.set(this.endpointPoint(endpoint));
    this.pendingWireWaypoints.set([]);
    this.selectedWireId.set(null);
    this.selectedDeviceId.set(endpoint.type === 'device' ? endpoint.deviceId : null);
  }
```

[`virtual-device.page.ts:2734–2774`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2734)

```ts
  private finishPendingWire(endpoint: WireEndpoint): void {
    const historyBefore = this.snapshot();
    const pending = this.pendingPin();
    const kind = pending ? this.endpointKind(pending) : null;
    if (!pending || !kind) return;
    const color = kind === 'ground' ? '#111827' : kind === 'power' ? '#ef4444' : '#22c55e';
    const connection: WireConnection = {
      id: `wire-${++this.wireSequence}`,
      start: pending,
      end: endpoint,
      waypoints: [...this.pendingWireWaypoints()],
      color,
      kind,
    };
    const currentConnections = this.connections();
    const duplicateWireIds = new Set(
      currentConnections
        .filter(
          (wire) =>
            (this.endpointsEqual(wire.start, pending) && this.endpointsEqual(wire.end, endpoint)) ||
            (this.endpointsEqual(wire.start, endpoint) && this.endpointsEqual(wire.end, pending)),
        )
        .map((wire) => wire.id),
    );
    this.connections.set(
      this.removeWiresAndPruneJunctions([...currentConnections, connection], duplicateWireIds),
    );
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
    this.selectedWireId.set(connection.id);
    this.selectedDeviceId.set(null);
    this.inspectorOpen.set(true);

    this.recordChange(historyBefore);

    void this.persistNewConnection(connection);
  }
```

[`virtual-device.page.ts:2460–2495`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2460)

```ts
  private async persistNewConnection(connection: WireConnection): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;

    const from = this.storableEndpoint(connection.start);
    const to = this.storableEndpoint(connection.end);
    if (!from || !to) {
      this.componentLimitMessage.set('This wire is not saved: junction taps are not stored yet.');
      return;
    }

    try {
      const created = await this.canvasPersistence.addConnection(projectId, {
        from,
        to,
        color: connection.color,
        kind: connection.kind,
        waypoints: connection.waypoints
          .filter((waypoint) => !waypoint.junctionId)
          .map((waypoint) => ({ x: waypoint.x, y: waypoint.y })),
      } as Omit<CanvasConnection, 'id'>);

      if (created) {
        this.adoptConnectionId(connection.id, created.id);
        void this.refreshUsage();
      }
    } catch (error) {
      const refusal = asConnectionLimitRefusal(error);
      this.componentLimitMessage.set(refusal ? refusal.message : 'Could not save this connection');
      this.connections.update((connections) =>
        connections.filter((wire) => wire.id !== connection.id),
      );
      if (this.selectedWireId() === connection.id) this.selectedWireId.set(null);
    }
  }
```

### ProjectCanvasService: เรียก API ของ component และ connection

[`project-canvas.service.ts:112–127`](../frontend/src/app/features/user/workspace/virtual-device/services/project-canvas.service.ts#L112)

```ts
  async add(
    projectId: string,
    definitionId: string,
    placement?: { x: number; y: number; label?: string },
  ): Promise<CanvasComponent | null> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return null;

    const created = await firstValueFrom(
      this.api.addComponent(workspaceId, projectId, {
        definitionId,
        ...(placement ? { x: placement.x, y: placement.y, label: placement.label } : {}),
      }),
    );
    return toCanvasComponent(created);
  }
```

[`project-canvas.service.ts:243–259`](../frontend/src/app/features/user/workspace/virtual-device/services/project-canvas.service.ts#L243)

```ts
  async addConnection(
    projectId: string,
    input: Omit<CanvasConnection, 'id'>,
  ): Promise<CanvasConnection | null> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return null;

    const created = await firstValueFrom(this.api.addConnection(workspaceId, projectId, input));
    return {
      id: created.id,
      from: created.from,
      to: created.to,
      color: created.color,
      kind: created.kind,
      waypoints: created.waypoints,
    };
  }
```

### Backend: เพิ่มอุปกรณ์

[`project-components.service.ts:58–72`](../backend/src/modules/projects/project-components.service.ts#L58)

```ts
  async add(
    userId: string,
    projectId: string,
    input: AddComponentRequest,
  ): Promise<ProjectComponent> {
    await this.assertWithinComponentLimit(userId, projectId);
    await this.assertWithinBoardLimit(projectId, input.definitionId);

    const position =
      input.x !== undefined && input.y !== undefined
        ? { x: input.x, y: input.y }
        : await this.nextFreePosition(projectId);

    return this.components.create(projectId, { ...input, ...position });
  }
```

### Backend: เพิ่มสาย

[`project-connections.service.ts:34–68`](../backend/src/modules/projects/project-connections.service.ts#L34)

```ts
  async add(
    userId: string,
    projectId: string,
    input: CreateConnectionInput,
  ): Promise<ProjectConnection> {
    if (
      input.from.componentId === input.to.componentId &&
      input.from.pinId === input.to.pinId
    ) {
      throw new BadRequestException({
        code: 'CONNECTION_SELF_LOOP',
        message: 'A pin cannot be connected to itself',
      });
    }

    const belong = await this.connections.endpointsBelongToProject(projectId, [
      input.from.componentId,
      input.to.componentId,
    ]);
    if (!belong) {
      throw new NotFoundException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component not found in this project',
      });
    }

    await this.assertWithinConnectionLimit(userId, projectId);

    return this.connections.create(projectId, {
      ...input,
      waypoints: normaliseWaypoints(input.waypoints),
    });
  }
```

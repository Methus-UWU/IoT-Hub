# 07 · AI ทำงานทีละขั้น: ตั้งแต่ prompt จนวงจรวิ่งได้

ไฟล์นี้ไล่เหตุการณ์จริงโดยใช้ตัวอย่าง prompt ว่า **"วัดอุณหภูมิด้วย DHT22 แสดงบน OLED"**
แล้วตอบคำถาม 4 ข้อ: AI ทำอะไรก่อน, อ่าน datasheet แล้วเกิดอะไรขึ้น,
ขาเป็นข้อความแล้ววาดสายได้อย่างไร และรันโค้ดได้อย่างไร

## 1. ส่ง prompt แล้ว AI ทำอะไรก่อน

ก่อนส่งคำถามให้โมเดล backend เตรียมข้อมูลเอง 3 อย่าง:

1. **โหลด context ของโปรเจกต์** ด้วย [`ProjectContextService.build()`](../backend/src/modules/ai/project/project-context.service.ts#L55)
   อ่านบอร์ด อุปกรณ์ สาย และไฟล์ทุกไฟล์จาก DB แล้วต่อท้าย system prompt
2. **สร้าง `ProjectDraft`** ([`project-ai.service.ts:254`](../backend/src/modules/ai/project/project-ai.service.ts#L254))
   เป็นสำเนาวงจรในหน่วยความจำ AI แก้ได้เฉพาะสำเนานี้ ยังไม่แตะ DB
3. **รัน tool ให้ล่วงหน้า (prefetch)** ([`project-ai.service.ts:306`](../backend/src/modules/ai/project/project-ai.service.ts#L306))
   รัน `get_board_pinout` และ `read_source_file` ให้ก่อน แล้วใส่ผลลงในประวัติแชตเหมือนโมเดลเรียกเอง

จากนั้นเข้าลูป `for (round ≤ 40)` ([`project-ai.service.ts:352`](../backend/src/modules/ai/project/project-ai.service.ts#L352))
แต่ละรอบเรียก OpenRouter 1 ครั้ง ลำดับที่ system prompt ([บรรทัด 90](../backend/src/modules/ai/project/project-ai.service.ts#L90)) บังคับไว้:

| รอบ | โมเดลเรียก tool | ฟังก์ชันที่ทำงานจริง |
| --- | --- | --- |
| 1 | `search_device_catalog("dht")`, `search_device_catalog("oled")` | `searchCatalog` ([`ai-tool-executor.ts:215`](../backend/src/modules/ai/project/ai-tool-executor.ts#L215)) |
| 2 | `read_device_datasheet("dht22")`, `read_device_datasheet("oled-096-i2c")` | `readDatasheet` ([249](../backend/src/modules/ai/project/ai-tool-executor.ts#L249)) |
| 3 | `add_device("dht22", wirePins:["VCC","DATA","GND"])`, `add_device("oled-096-i2c", …)` | `addDevice` ([313](../backend/src/modules/ai/project/ai-tool-executor.ts#L313)) ซึ่งเรียก `wireToBoard` ต่อทีละขา |
| 4 | `connect_pins` สำหรับตัวต้านทาน pull-up | `connectPins` ([448](../backend/src/modules/ai/project/ai-tool-executor.ts#L448)) |
| 5 | `read_source_file` → `write_source_file("src/main.cpp", โค้ดทั้งไฟล์)` | `writeFile` ([508](../backend/src/modules/ai/project/ai-tool-executor.ts#L508)) |
| 6 | ไม่เรียก tool แล้ว ตอบเป็นข้อความสรุป | จบลูป ได้ `draft.actions()` เป็นแผน |

ผลที่ได้คือ **แผน** ที่ยังไม่ถูกบันทึก ผู้ใช้ต้องกดยอมรับก่อน แล้ว
[`AiPlanApplyService.apply()`](../backend/src/modules/ai/project/ai-plan-apply.service.ts#L58) จึงเขียนลง DB
(รายละเอียดอยู่ใน [04-ai-flow.md](04-ai-flow.md))

## 2. อ่าน datasheet แล้วเกิดอะไรขึ้น

ใน `readDatasheet`:

1. `datasheetOf(id)` ดึง Markdown ของอุปกรณ์ เป็นไฟล์เดียวกับที่ผู้ใช้เปิดอ่านในหน้า Documents
   (สร้างเป็น [`device-datasheets.generated.ts`](../backend/src/modules/projects/catalog/device-datasheets.ts))
2. `draft.markDatasheetReviewed(id)` จดว่าอุปกรณ์นี้อ่านเอกสารแล้วในรอบนี้
3. คืนข้อความ datasheet และ library ที่ต้องใช้ให้โมเดลอ่าน

สิ่งที่ตามมา:

- **บังคับด้วยโค้ด:** `add_device`, `wire_to_board`, `connect_pins` เรียก
  [`requireDatasheetReview`](../backend/src/modules/ai/project/ai-tool-executor.ts#L557) ก่อนทำงาน
  ถ้ายังไม่อ่านเอกสารจะปฏิเสธ แล้วโมเดลต้องกลับไปอ่านก่อน
- **โมเดลนำเนื้อหาไปใช้เอง:** เช่น datasheet บอกว่า DHT22 แบบ 4 ขาต้องมี pull-up 4.7 kΩ
  โมเดลจึง `add_device("resistor")` แล้ว `connect_pins` ส่วนนี้โค้ดไม่ได้ตรวจว่าทำตามเอกสารครบหรือไม่ ขึ้นกับโมเดล

## 3. ขาเป็นแค่ text แล้วเลือกขาและวาดเส้นได้อย่างไร

ทุกขาอ้างด้วยชื่อที่เป็นข้อความ เช่น `"DATA"`, `"GPIO23"` ตั้งแต่ AI จนถึงฐานข้อมูล

### 3.1 Backend เลือกขาบอร์ดให้อัตโนมัติ

AI ห้ามเลือกเลข GPIO เอง ระบบเป็นคนเลือกให้:

`wireToBoard` → [`draft.wireToBoard`](../backend/src/modules/ai/project/project-draft.ts#L381) →
[`assignBoardPin`](../backend/src/modules/projects/pin-assignment.ts#L463)

1. ขานี้ต่ออยู่แล้ว → ใช้ขาเดิม
2. มี `preferredBoardPin` และขานั้นใช้ได้ → ใช้ขานั้น
3. ไม่งั้นหาขาว่างที่ชนิดเข้ากัน: I2C ใช้ SDA/SCL เริ่มต้น (`preferProtocolDefaults`) ไฟเลี้ยงเลือกตามแรงดัน (`rankSupplyByVoltage`)
4. ขาแบบ passive (ขา LED, ตัวต้านทาน) → ปฏิเสธ ต้องใช้ `connect_pins` บอกปลายทั้งสองข้างเอง
5. `validateConnection` ตรวจแรงดันและ logic level ถ้าไม่ปลอดภัยจะตอบ `UNSAFE_CONNECTION`

tool ตอบโมเดลว่า `"Use 23 as the pin number in your code."` โมเดลนำเลขนี้ไปเขียนในโค้ด โค้ดกับสายจึงตรงกัน

### 3.2 ฐานข้อมูลเก็บเป็นข้อความ

ตาราง `project_connections` เก็บ `from_component_id` + `from_pin_id: "DATA"` และ
`to_component_id` + `to_pin_id: "GPIO23"` ไม่เก็บพิกัด

### 3.3 Frontend แปลงชื่อขาเป็นพิกัดแล้ววาด

ไฟล์ [`virtual-device.page.ts`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts):

1. `endpointPoint(endpoint)` (3029) ใช้ชื่อขาหาข้อมูลขาใน catalog: `device.pins.find(p => p.name === endpoint.pinId)`
   ได้ `pin.x, pin.y` ซึ่งเป็นพิกัดภายในรูปอุปกรณ์ที่ตั้งไว้ในไฟล์ `*.device.ts`
2. `devicePinPoint` → `deviceLocalToCanvas` (1763–1780) แปลงเป็นพิกัดบน canvas: หมุนรอบจุดกลาง → คูณ scale → บวกตำแหน่งที่วาง
   ใช้สูตรเดียวกับ `deviceTransform` (958) ที่วาดตัวอุปกรณ์ ปลายสายจึงตรงขาพอดี
3. `endpointOutwardVector` (3045) บอกว่าขาชี้ทิศไหน (ซ้าย/ขวา/บน/ล่าง) ให้สายออกจากขาในทิศที่ถูก
4. `wirePath(connection)` (1601) รวมจุดต้น + จุดหักที่ผู้ใช้ลาก + จุดปลาย แล้ว `curvedRoutePath` (2995) สร้างสตริง SVG path
5. Template ผูกค่า `<path [attr.d]="wirePath(connection)">` ([`virtual-device.page.html:470`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.html#L470))

### 3.4 กราฟิก

- อุปกรณ์แต่ละตัวมี `render.draw()` คืนรายการ shape (rect, circle, text ฯลฯ) แล้ว
  [`DeviceArt`](../frontend/src/app/features/user/workspace/virtual-device/device-art/device-art.ts) แปลงเป็น SVG ทั้งหมด ไม่ได้ใช้ไฟล์รูปภาพ
- อุปกรณ์ที่ AI เพิ่ม ตอน apply จะถูกจัดวางข้างบอร์ดด้วย
  [`arrangeNew`](../frontend/src/app/features/user/workspace/virtual-device/services/project-canvas.service.ts#L195) →
  [`layoutNewParts`](../frontend/src/app/features/user/workspace/virtual-device/layout/auto-layout.ts#L70)

## 4. รันโค้ดได้อย่างไร

มี 2 ทางแยกกัน

### 4a. จำลองใน browser (ปุ่ม Start)

ไม่มีการ compile จริง ใช้ interpreter ภาษา C++ แบบย่อที่เขียนด้วย TypeScript
(เหตุผลอยู่ใน [`ADR-005`](../docs/adr/ADR-005-firmware-simulation.md))

```
toggleSimulation()                          virtual-device.page.ts:1978
 ├─ loadFirmware()                          2001
 │    └─ FirmwareLoaderService.start()      services/firmware-loader.service.ts:53
 │         ├─ api.readFile(main.cpp)
 │         └─ FirmwareMachine.compile(board, source)    firmware-machine.ts:125
 │              tokenize()       tokenizer.ts:103     แตกโค้ดเป็น token
 │              parseFirmware()  parser.ts:92         สร้าง AST
 │              Interpreter      interpreter.ts:165   รันทีละ statement
 └─ startTicker()                           449   requestAnimationFrame ทุก tick
      └─ solveCircuit(elapsed)              398
           └─ simulateTick(...)             simulation/circuit-simulator.ts:129
                ├─ รวมขาที่มีสายต่อกันเป็น net เดียว (nets.union)
                ├─ บอร์ด: behavior เรียก machine.advance(deltaMs)    board-behavior.ts:97
                │     รัน setup() แล้ว loop() ต่อตามเวลาจำลอง
                │     digitalWrite(23, HIGH) → GPIO23 มีแรงดัน 3.3V
                └─ อุปกรณ์อื่นอ่านแรงดันใน net เช่น LED คำนวณความสว่าง
```

- ฟังก์ชัน Arduino `pinMode`, `digitalWrite`, `digitalRead`, `analogRead`, `delay`, `millis` อยู่ใน
  [`interpreter.ts`](../frontend/src/app/features/user/workspace/virtual-device/simulation/firmware/interpreter.ts#L760)
- library อย่าง DHT, SSD1306, Servo, LiquidCrystal_I2C จำลองไว้ใน
  [`simulation/firmware/libraries/`](../frontend/src/app/features/user/workspace/virtual-device/simulation/firmware/libraries/)
- system prompt จึงสั่ง AI ให้ใช้เฉพาะ library ที่ระบบรองรับ และห้ามใช้ class, pointer, template, lambda

### 4b. Build จริงแล้ว flash ลงบอร์ด

```
IDE กด Build → POST .../builds                        builds.controller.ts:44
  สร้าง build_job สถานะ queued
build-dispatcher (container แยก) → POST /api/internal/build-jobs/claim    build-worker.controller.ts:33
  dockerRunArgs(): สร้าง container builder ที่รัน PlatformIO แบบ --network=none
  ส่งผลกลับที่ POST /api/internal/build-jobs/:buildId/result
Browser ดาวน์โหลด artifact → GET .../builds/:id/artifacts/:name
Flash ผ่าน Web Serial: web-serial.ts requestPort()
  ESP32:   esp32-flasher.ts   esptool-js writeFlash()
  Arduino: stk500v1-flasher.ts
```

โค้ดของผู้ใช้ไม่เคยรันใน process ของ NestJS: การจำลองรันใน browser ส่วนการ build รันใน container แยกที่ไม่มีเน็ต

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### 1. Prefetch: รัน pinout และอ่านไฟล์ให้ก่อนรอบแรก

[`project-ai.service.ts:306–332`](../backend/src/modules/ai/project/project-ai.service.ts#L306)

```ts
    if (chosen.supportsTools) {
      const initialReads: AiToolCall[] = [
        {
          id: `prefetch-${randomUUID()}`,
          name: 'get_board_pinout',
          rawArguments: '{}',
        },
        ...(context.activeFile
          ? [
              {
                id: `prefetch-${randomUUID()}`,
                name: 'read_source_file',
                rawArguments: JSON.stringify({ path: context.activeFile }),
              },
            ]
          : []),
      ];
      turns.push({ role: 'assistant', content: '', toolCalls: initialReads });
      for (const call of initialReads) {
        turns.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: executeToolCall(draft, call).content,
        });
      }
    }
```

### 2. อ่าน datasheet

[`ai-tool-executor.ts:249–287`](../backend/src/modules/ai/project/ai-tool-executor.ts#L249)

```ts
function readDatasheet(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const definitionId = requireString(args, 'definitionId');
  const device = findDevice(definitionId);
  if (!device) {
    const suggestions = searchDevices(definitionId)
      .slice(0, 5)
      .map((match) => match.id);
    return refuse(
      `"${definitionId}" is not in the device catalog.${
        suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''
      }`,
    );
  }

  const markdown = datasheetOf(definitionId);
  draft.markDatasheetReviewed(definitionId);
  if (!markdown) {
    return ok(
      `No datasheet is written for ${device.name} (${definitionId}) yet. Work from its pinout and the general rules for its interfaces, and say in your answer that you did.`,
    );
  }

  const body =
    markdown.length > MAX_DATASHEET_CHARS
      ? `${markdown.slice(0, MAX_DATASHEET_CHARS)}\n\n[truncated at ${MAX_DATASHEET_CHARS} characters]`
      : markdown;
  return ok(
    [
      `Datasheet — ${device.name} (${device.model}, ${definitionId})\n\n${body}`,
      ...libraryLines(definitionId),
    ].join('\n\n'),
  );
}
```

### 2. ด่านบังคับให้อ่าน datasheet ก่อน

[`ai-tool-executor.ts:557–577`](../backend/src/modules/ai/project/ai-tool-executor.ts#L557)

```ts
function requireDatasheetReview(
  draft: ProjectDraft,
  definitionIds: readonly string[],
): ToolOutcome | null {
  const missing = [
    ...new Set(
      definitionIds.filter(
        (definitionId) =>
          hasDatasheet(definitionId) &&
          !draft.hasReviewedDatasheet(definitionId),
      ),
    ),
  ];
  if (!missing.length) return null;

  return refuse(
    `DATASHEET_REQUIRED: Before adding or wiring ${missing.join(', ')}, call read_device_datasheet for ${missing.join(
      ', ',
    )}. Follow its voltage, support-component, bus, polarity, and library requirements, then retry this call.`,
  );
}
```

### 3. add_device (เพิ่มอุปกรณ์แล้วต่อขาที่ระบุใน wirePins)

[`ai-tool-executor.ts:313–407`](../backend/src/modules/ai/project/ai-tool-executor.ts#L313)

```ts
function addDevice(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const definitionId = requireString(args, 'definitionId');
  const label = optionalString(args, 'label');
  const allowDuplicate = args['allowDuplicate'] === true;
  const wirePins = args['wirePins'];
  if (
    wirePins !== undefined &&
    (!Array.isArray(wirePins) ||
      wirePins.length < 1 ||
      wirePins.length > 16 ||
      wirePins.some((pin: unknown) => typeof pin !== 'string' || !pin.trim()) ||
      new Set(wirePins).size !== wirePins.length)
  ) {
    return refuse('wirePins must contain 1 to 16 unique, non-empty pin names.');
  }

  if (definitionId === 'led' && label && /\brgb\b/i.test(label)) {
    return refuse(
      'An RGB LED is one part, not three LEDs. Add rgb-led-common-cathode (or rgb-led-common-anode) once: its R, G and B legs each go to a PWM pin through their own resistor, and its common leg to GND (cathode) or 3V3 (anode).',
    );
  }

  if (!findDevice(definitionId)) {
    const suggestions = searchDevices(definitionId)
      .slice(0, 5)
      .map((device) => device.id);
    return refuse(
      `"${definitionId}" is not in the device catalog.${
        suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''
      }`,
    );
  }

  const datasheetGate = requireDatasheetReview(draft, [definitionId]);
  if (datasheetGate) return datasheetGate;

  const requested = resolveSettings(definitionId, args['settings']);
  if (!requested.ok) return refuse(requested.reason);
  const fromLabel = label ? settingsFromLabel(definitionId, label) : {};
  const settings = {
    ok: true as const,
    settings: { ...requested.settings, ...fromLabel },
  };

  const result = draft.addDevice(definitionId, {
    ...(label ? { label } : {}),
    allowDuplicate,
    settings: settings.settings,
  });
  if (!result.created && Object.keys(settings.settings).length) {
    draft.configure(result.component.id, settings.settings);
  }

  const summary = result.created
    ? `Staged adding ${result.component.label}. Its component id is ${result.component.id}; use that id to wire it.${settingsSummary(settings.settings)}`
    : `The draft already contains ${result.component.label} (component id ${result.component.id}). Reusing it — nothing was added. Use this id to wire remaining pins; another separate unit needs a distinct label and allowDuplicate: true.`;
  const wiring = ((wirePins ?? []) as string[]).map((devicePin) =>
    executeToolCall(draft, {
      id: 'add-device-wiring',
      name: 'wire_to_board',
      rawArguments: JSON.stringify({
        componentId: result.component.id,
        devicePin,
      }),
    }),
  );
  return {
    ok: true,
    device: {
      componentId: result.component.id,
      created: result.created,
      wiringIncomplete: wiring.some((outcome) => !outcome.ok),
    },
    content: [
      summary,
      ...wiring.map(
        (outcome, index) =>
          `${(wirePins as string[])[index]}: ${outcome.ok ? '' : 'REFUSED: '}${outcome.content}`,
      ),
      devicePinout(draft, { componentId: result.component.id }).content,
    ].join('\n'),
  };
}
```

### 3. wire_to_board (ให้ระบบเลือกขาบอร์ด แล้วบอกเลข GPIO กลับ)

[`ai-tool-executor.ts:409–446`](../backend/src/modules/ai/project/ai-tool-executor.ts#L409)

```ts
function wireToBoard(
  draft: ProjectDraft,
  args: Record<string, unknown>,
): ToolOutcome {
  const componentId = requireString(args, 'componentId');
  const devicePin = requireString(args, 'devicePin');
  const preferred = optionalString(args, 'preferredBoardPin');

  const component = resolveComponent(draft.state(), componentId);
  const datasheetGate = requireDatasheetReview(draft, [component.definitionId]);
  if (datasheetGate) return datasheetGate;

  const assignment = draft.wireToBoard(componentId, devicePin, preferred);
  const unsafe = unsafeWiringWarning(assignment.warnings);
  if (unsafe) {
    draft.disconnect(
      { componentId, pinId: assignment.peripheralPin },
      {
        componentId: draft.board()?.id ?? '',
        pinId: assignment.boardPin,
      },
    );
    return refuse(`UNSAFE_CONNECTION: ${unsafe.message}`);
  }
  const gpio = gpioNumberOf(assignment.boardPin);

  return ok(
    [
      assignment.reused
        ? `${draft.labelOf(componentId)}:${assignment.peripheralPin} is already wired to board pin ${assignment.boardPin}. Reusing it.`
        : `Staged: ${draft.labelOf(componentId)}:${assignment.peripheralPin} -> board ${assignment.boardPin}.`,
      gpio === null
        ? `Use board pin ${assignment.boardPin} in your code.`
        : `Use ${gpio} as the pin number in your code.`,
      ...assignment.warnings.map((warning) => `Warning: ${warning.message}`),
    ].join(' '),
  );
}
```

[`project-draft.ts:381–409`](../backend/src/modules/ai/project/project-draft.ts#L381)

```ts
  wireToBoard(
    peripheralId: string,
    peripheralPinId: string,
    preferredBoardPinId?: string,
  ): PinAssignment & { warnings: readonly WiringWarning[] } {
    const state = this.state();
    const board = findBoard(state);
    if (!board) {
      throw new WiringError(
        'NO_BOARD_IN_PROJECT',
        'This project has no development board to wire against',
      );
    }

    const peripheral = resolveComponent(state, peripheralId);
    const assignment = assignBoardPin(state, board, peripheral, {
      peripheralPinId,
      ...(preferredBoardPinId ? { preferredBoardPinId } : {}),
    });

    if (assignment.reused) return { ...assignment, warnings: [] };

    const result = this.connect(
      { componentId: peripheral.id, pinId: assignment.peripheralPin },
      { componentId: board.id, pinId: assignment.boardPin },
    );

    return { ...assignment, warnings: result.warnings };
  }
```

### 3. assignBoardPin: อัลกอริทึมเลือกขา

[`pin-assignment.ts:463–558`](../backend/src/modules/projects/pin-assignment.ts#L463)

```ts
export function assignBoardPin(
  state: CircuitState,
  board: CircuitComponent,
  peripheral: CircuitComponent,
  requirement: PinRequirement,
): PinAssignment {
  const boardDefinition = resolveDefinition(board);
  const peripheralDefinition = resolveDefinition(peripheral);
  const peripheralPin = resolvePin(
    peripheralDefinition,
    requirement.peripheralPinId,
  );

  if (peripheralPin.type === 'nc') {
    throw new WiringError(
      'PIN_NOT_CONNECTED_INTERNALLY',
      `${peripheralDefinition.name}:${peripheralPin.name} is not connected internally`,
    );
  }

  if (isPassivePinType(peripheralPin.type)) {
    throw new WiringError(
      'PIN_NEEDS_EXPLICIT_WIRING',
      `${peripheralDefinition.name}:${peripheralPin.name} is a passive lead, so the platform cannot choose a board pin for it. Wire it with connect_pins instead. ${passiveWiringHint(peripheralDefinition)} Do not call add_device or wire_to_board for this part again.`,
    );
  }

  const existing = existingBoardPin(state, board, peripheral, peripheralPin);
  if (existing) {
    return {
      peripheralPin: peripheralPin.name,
      boardPin: existing.name,
      kind: kindOf(peripheralPin, existing),
      reused: true,
    };
  }

  const required = requiredBoardPinType(peripheralPin);
  const candidates = rankSupplyByVoltage(
    candidatePins(boardDefinition, required),
    peripheralDefinition,
  );
  if (!candidates.length) {
    throw new WiringError(
      'NO_COMPATIBLE_PIN',
      `${boardDefinition.name} has no pin that can serve ${peripheralDefinition.name}:${peripheralPin.name}`,
    );
  }

  const chosen = requirement.preferredBoardPinId
    ? preferredOrRefuse(
        state,
        board,
        boardDefinition,
        candidates,
        requirement.preferredBoardPinId,
        peripheralPin,
      )
    : firstUsable(
        state,
        board,
        preferProtocolDefaults(
          preferSide(
            state,
            board,
            boardDefinition,
            peripheral,
            candidates,
            required,
          ),
          boardDefinition,
          required,
        ),
        peripheralPin,
      );

  if (!chosen) {
    throw new WiringError(
      'NO_FREE_PIN',
      `Every ${required} pin on ${boardDefinition.name} is already in use`,
    );
  }

  return {
    peripheralPin: peripheralPin.name,
    boardPin: chosen.name,
    kind: kindOf(peripheralPin, chosen),
    reused: false,
  };
}
```

### 3. ชื่อขา → พิกัดบน canvas

[`virtual-device.page.ts:3029–3034`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L3029)

```ts
  private endpointPoint(endpoint: WireEndpoint): Point | null {
    if (endpoint.type === 'junction') return this.wireJunctions()[endpoint.junctionId] ?? null;
    const device = this.deviceInstanceById(endpoint.deviceId);
    const pin = device?.pins.find((candidate) => candidate.name === endpoint.pinId);
    return device && pin ? this.devicePinPoint(device, pin) : null;
  }
```

[`virtual-device.page.ts:1763–1780`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L1763)

```ts
  protected devicePinPoint(device: DeviceInstance, pin: DevicePin): Point {
    return this.deviceLocalToCanvas(device, pin);
  }

  private deviceLocalToCanvas(device: DeviceInstance, local: Point): Point {
    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    const center = { x: device.width / 2, y: device.height / 2 };
    const radians = (placement.rotation * Math.PI) / 180;
    const dx = local.x - center.x;
    const dy = local.y - center.y;
    return {
      x: placement.x + scale * (center.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
      y: placement.y + scale * (center.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
    };
  }
```

[`virtual-device.page.ts:958–966`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L958)

```ts
  protected deviceTransform(device: DeviceInstance): string {
    const placement = this.placementFor(device.instanceId);
    const scale = this.renderScale(device);
    return `translate(${placement.x} ${placement.y}) scale(${scale}) rotate(${placement.rotation} ${
      device.width / 2
    } ${device.height / 2})`;
  }
```

### 3. ทิศที่สายออกจากขา

[`virtual-device.page.ts:3045–3064`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L3045)

```ts
  private endpointOutwardVector(endpoint: WireEndpoint): Point {
    if (endpoint.type === 'junction') return { x: 0, y: 0 };

    const device = this.deviceInstanceById(endpoint.deviceId);
    const pin = device?.pins.find((candidate) => candidate.name === endpoint.pinId);
    if (!device || !pin) return { x: 1, y: 0 };
    let vector: Point;
    if (pin.side === 'top') vector = { x: 0, y: -1 };
    else if (pin.side === 'bottom' || pin.y >= device.height) vector = { x: 0, y: 1 };
    else if (pin.x <= 0) vector = { x: -1, y: 0 };
    else if (pin.x >= device.width) vector = { x: 1, y: 0 };
    else if (pin.y <= 0) vector = { x: 0, y: -1 };
    else vector = { x: 1, y: 0 };

    const radians = (this.placementFor(endpoint.deviceId).rotation * Math.PI) / 180;
    return {
      x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
      y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
    };
  }
```

### 3. สร้าง SVG path ของสาย

[`virtual-device.page.ts:1601–1610`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L1601)

```ts
  protected wirePath(connection: WireConnection): string {
    const geometry = this.wireGeometry(connection);
    if (!geometry) return '';

    return this.curvedRoutePath(
      [geometry.source, ...this.resolvedWireWaypoints(connection), geometry.target],
      geometry.sourceControl,
      geometry.targetControl,
    );
  }
```

### 3. จัดวางอุปกรณ์ที่ AI เพิ่ม

[`project-canvas.service.ts:195–220`](../frontend/src/app/features/user/workspace/virtual-device/services/project-canvas.service.ts#L195)

```ts
  async arrangeNew(projectId: string, componentIds: readonly string[]): Promise<void> {
    if (!componentIds.length) return;
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return;

    const [components, connections] = await Promise.all([
      this.load(projectId),
      this.loadConnections(projectId),
    ]);
    const parts = components.flatMap((component) => {
      const definition = deviceById(component.definitionId);
      return definition ? [{ ...component, definition }] : [];
    });

    const positions = layoutNewParts(parts, connections, componentIds);
    await Promise.all(
      [...positions].map(([componentId, { x, y }]) =>
        firstValueFrom(
          this.api.updateComponent(workspaceId, projectId, componentId, {
            x: Math.round(x),
            y: Math.round(y),
          }),
        ),
      ),
    );
  }
```

### 4a. ปุ่ม Start → โหลดโค้ด → เริ่ม tick

[`virtual-device.page.ts:1978–1999`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L1978)

```ts
  protected toggleSimulation(): void {
    const next = !this.simulationRunning();
    this.simulationRunning.set(next);
    if (next) {
      this.shortTrip.set([]);
      void this.loadFirmware();
      this.audio.prime();
      this.startTicker();
    } else {
      this.stopTicker();
      this.firmware.stop();
      this.sketchBaud.set(0);
      this.releaseSimulationControls();
    }
    this.pendingPin.set(null);
    this.wirePointer.set(null);
    this.pendingWireWaypoints.set([]);
  }
```

[`virtual-device.page.ts:2001–2008`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L2001)

```ts
  private async loadFirmware(): Promise<void> {
    const projectId = this.persistedProjectId;
    if (!projectId) return;
    const boards = this.visibleDevices()
      .filter((device) => isBoardCategory(device.catalog.categoryId))
      .map((device) => ({ instanceId: device.instanceId, definition: device }));
    await this.firmware.start(projectId, boards);
  }
```

[`virtual-device.page.ts:449–463`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L449)

```ts
  private startTicker(): void {
    if (this.tickHandle) return;
    this.lastTickAt = performance.now();
    const step = () => {
      this.tickHandle = requestAnimationFrame(step);
      const now = performance.now();
      const elapsed = now - this.lastTickAt;
      if (elapsed < SIMULATION_TICK_MS) return;
      this.lastTickAt = now;
      this.solveCircuit(elapsed);
      this.firmware.pumpSerial();
      this.sketchBaud.set(this.firmware.sketchBaud());
    };
    this.tickHandle = requestAnimationFrame(step);
  }
```

[`virtual-device.page.ts:398–426`](../frontend/src/app/features/user/workspace/virtual-device/virtual-device.page.ts#L398)

```ts
  private solveCircuit(deltaMs: number): void {
    const states = this.deviceStates();
    const devices = this.visibleDevices().map((device) => ({
      instanceId: device.instanceId,
      definition: device,
      properties: states[device.instanceId] ?? EMPTY_STATE,
    }));

    this.syncBehaviors(devices);
    this.simulation.set(
      simulateTick(
        {
          devices,
          connections: this.visibleConnections(),
          deltaMs,
        },
        this.behaviors,
      ),
    );

    const shorts = this.shortIssues();
    if (shorts.length) {
      this.shortTrip.set(shorts);
      this.toggleSimulation();
    }
  }
```

### 4a. Compile sketch ด้วย interpreter

[`firmware-machine.ts:125–143`](../frontend/src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-machine.ts#L125)

```ts
  static compile(
    board: VirtualDevice,
    source: string,
  ): { machine: FirmwareMachine; fault: null } | { machine: null; fault: FirmwareFault } {
    try {
      const machine = new FirmwareMachine(board, source);
      machine.task = machine.interpreter.initGlobals();
      machine.status = 'running';
      return { machine, fault: null };
    } catch (error) {
      if (error instanceof FirmwareSyntaxError) {
        return {
          machine: null,
          fault: { message: error.message, line: error.line, phase: 'compile' },
        };
      }
      throw error;
    }
  }
```

### 4a. เดินเวลาให้ sketch ทุก tick

[`firmware-machine.ts:192–215`](../frontend/src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-machine.ts#L192)

```ts
  advance(deltaMs: number, sampler: PinSampler): void {
    if (this.status !== 'running') return;

    this.clockMs += Math.max(0, deltaMs);
    for (const [name, endsAt] of this.toneEnds) {
      if (this.clockMs >= endsAt) this.stopTone(name);
    }
    this.sampler = sampler;
    try {
      this.runInterrupts();
      if (this.clockMs < this.resumeAtMs) return;
      this.runBudget();
    } catch (error) {
      this.status = 'error';
      this.task = null;
      this.fault =
        error instanceof FirmwareRuntimeError
          ? { message: error.message, line: error.line, phase: 'run' }
          : { message: String(error), line: 0, phase: 'run' };
    } finally {
      this.sampler = null;
    }
  }
```

### 4a. ฟังก์ชัน Arduino ใน interpreter

[`interpreter.ts:760–778`](../frontend/src/app/features/user/workspace/virtual-device/simulation/firmware/interpreter.ts#L760)

```ts
    switch (name) {
      case 'pinMode':
        this.io.pinMode(number(0), pinModeFrom(args[1]));
        return 0;

      case 'digitalWrite':
        this.io.digitalWrite(number(0), truthy(args[1]));
        return 0;

      case 'digitalRead':
        return this.io.digitalRead(number(0)) ? 1 : 0;

      case 'analogRead':
        return this.io.analogRead(number(0));

      case 'analogWrite':
        this.io.analogWrite(number(0), number(1));
        return 0;
```

### 4a. บอร์ดรัน firmware ใน simulateTick

[`board-behavior.ts:81–121`](../frontend/src/app/features/user/workspace/virtual-device/devices/microcontrollers/board-behavior.ts#L81)

```ts
    update(context: DeviceSimulationContext) {
      const machine = firmwareFor(instanceId);
      if (!machine) {
        outputs = new Map();
        pullups = [];
        bus = [];
        if (onboardLed) context.emit(ONBOARD_LED_STATE, 0);
        return;
      }

      if (context.deltaMs > 0) {
        machine.advance(context.deltaMs, {
          readDigital: (pinName) => isLogicHigh(context.readNode(pinName), spec.logicVoltage),
          readAnalog: (pinName) => {
            const node = context.readNode(pinName);
            if (node.floating) return 0;
            const ratio = node.voltage / spec.logicVoltage;
            return Math.min(spec.adcMax, Math.max(0, ratio * spec.adcMax));
          },
          readMessages: (pinName) => context.readNode(pinName).messages ?? [],
        });
      }

      outputs = machine.outputs();
      pullups = machine.pullupPins();
      bus = machine.busOutputs();

      if (onboardLed) {
        const output = outputs.get(onboardLed.pin);
        const duty = output ? output.duty : onboardLed.activeLow ? 1 : 0;
        context.emit(ONBOARD_LED_STATE, onboardLed.activeLow ? 1 - duty : duty);
      }
      context.emit('firmware', machine.status);
      context.emit('uptime', Math.floor(machine.uptimeMs));
    },
```

### 4a. Solver ของวงจร

[`circuit-simulator.ts:129–272`](../frontend/src/app/features/user/workspace/virtual-device/simulation/circuit-simulator.ts#L129)

```ts
export function simulateTick(
  input: SimulationInput,
  behaviors: ReadonlyMap<string, DeviceBehavior>,
): SimulationResult {
  if (!input.devices.length) return EMPTY_RESULT;

  const nets = new NetBuilder();
  const runtime: Record<string, Record<string, string | number | boolean>> = {};
  const drivers = new Map<string, Driver[]>();
  const messages = new Map<string, BusMessage[]>();

  for (const device of input.devices) {
    for (const devicePin of device.definition.pins) {
      nets.find(devicePinKey(device.instanceId, devicePin.name));
    }
  }

  for (const wire of input.connections) {
    nets.union(endpointKey(wire.start), endpointKey(wire.end));
    for (const waypoint of wire.waypoints) {
      if (waypoint.junctionId) {
        nets.union(endpointKey(wire.start), junctionKey(waypoint.junctionId));
      }
    }
  }

  for (const device of input.devices) {
    const behavior = behaviors.get(device.instanceId);
    if (!behavior?.connect) continue;
    behavior.connect(
      makeContext(device, input.deltaMs, nets, drivers, runtime,  false),
    );
  }

  let nodeStates = new Map<string, NodeState>();
  let shorts: string[] = [];

  for (let iteration = 0; iteration < RELAXATION_PASSES; iteration++) {
    drivers.clear();
    messages.clear();

    for (const device of input.devices) {
      const source = supplyIdOf(device);
      if (!source) continue;
      for (const devicePin of device.definition.pins) {
        const key = nets.find(devicePinKey(device.instanceId, devicePin.name));
        if (devicePin.type === 'gnd' || devicePin.kind === 'ground') {
          addDriver(drivers, key, 0, 'strong', undefined, source);
        } else if (devicePin.type === 'vcc' && devicePin.voltage !== undefined) {
          addDriver(drivers, key, devicePin.voltage, 'strong', undefined, source);
        }
      }
    }

    const previous = nodeStates;
    for (const device of input.devices) {
      const behavior = behaviors.get(device.instanceId);
      if (!behavior?.drive) continue;
      behavior.drive(
        makeContext(device, input.deltaMs, nets, drivers, runtime, true, previous, messages),
      );
    }

    const resolved = new Map<string, NodeState>();
    shorts = [];
    for (const [root, nodeDrivers] of drivers) {
      const strong = nodeDrivers.filter((driver) => driver.strength === 'strong');
      const effective = strong.length ? strong : nodeDrivers;
      const highest = Math.max(...effective.map((driver) => driver.voltage));
      const lowest = Math.min(...effective.map((driver) => driver.voltage));
      const weightOf = (driver: Driver) => driver.weight ?? DEFAULT_WEAK_WEIGHT;
      const level = strong.length
        ? highest
        : effective.reduce((sum, driver) => sum + driver.voltage * weightOf(driver), 0) /
          effective.reduce((sum, driver) => sum + weightOf(driver), 0);
      const conflict = strong.length > 1 && highest - lowest > 0.7;
      if (conflict) shorts.push(root);
      const winner = strong.length
        ? effective.find((driver) => driver.voltage === highest)
        : effective.reduce((best, driver) => (weightOf(driver) > weightOf(best) ? driver : best));
      const duty =
        winner?.duty !== undefined && winner.duty > 0 && winner.duty < 1 ? winner.duty : undefined;
      const sources = [
        ...new Set(effective.flatMap((driver) => (driver.source ? [driver.source] : []))),
      ];
      resolved.set(root, {
        voltage: level,
        floating: false,
        conflict,
        ...(duty !== undefined ? { duty } : {}),
        ...(sources.length ? { sources } : {}),
        ...(messages.has(root) ? { messages: messages.get(root) } : {}),
      });
    }
    for (const [root, published] of messages) {
      if (!resolved.has(root)) resolved.set(root, { ...FLOATING_NODE, messages: published });
    }
    nodeStates = resolved;
  }

  for (const device of input.devices) {
    const behavior = behaviors.get(device.instanceId);
    if (!behavior?.update) continue;
    behavior.update(makeContext(device, input.deltaMs, nets, drivers, runtime, true, nodeStates));
  }

  const pinStates = new Map<string, NodeState>();
  for (const device of input.devices) {
    for (const devicePin of device.definition.pins) {
      const key = devicePinKey(device.instanceId, devicePin.name);
      pinStates.set(key, nodeStates.get(nets.find(key)) ?? FLOATING_NODE);
    }
  }
  return { runtime, pinStates, shorts };
}
```

### 4b. ขอ build

[`builds.controller.ts:43–58`](../backend/src/modules/build/builds.controller.ts#L43)

```ts
  @Throttle(THROTTLE_OVERRIDES.build)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const project = await this.authorize(
      request,
      workspaceId,
      projectId,
      'editor',
    );
    return this.builds.request(request.user.id, project);
  }
```

### 4b. Worker รับงาน

[`build-worker.controller.ts:33–41`](../backend/src/modules/build/build-worker.controller.ts#L33)

```ts
  @Post('claim')
  async claim(@Res({ passthrough: true }) response: Response) {
    const job = await this.worker.claim();
    if (!job) {
      response.status(HttpStatus.NO_CONTENT);
      return;
    }
    return job;
  }
```

### 4b. คำสั่ง docker run ของ builder (ไม่มีเน็ต)

[`builder-container.ts:36–62`](../build-worker/dispatcher/src/builder-container.ts#L36)

```ts
export function dockerRunArgs(
  config: DispatcherConfig,
  jobId: string,
): string[] {
  return [
    'run',
    '--rm',
    '--interactive',
    '--name',
    containerName(jobId),
    '--network=none',
    '--read-only',
    '--user=1000:1000',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--memory=${config.memory}`,
    `--memory-swap=${config.memory}`,
    `--cpus=${config.cpus}`,
    `--pids-limit=${config.pidsLimit}`,
    '--ulimit=nofile=1024:1024',
    `--tmpfs=/workspace:rw,nosuid,nodev,size=${config.workspaceSize},uid=1000,gid=1000,mode=0700`,
    `--tmpfs=/tmp:rw,nosuid,nodev,size=${config.tmpSize},uid=1000,gid=1000,mode=0700`,
    '--log-driver=none',
    '--label=iot-hub.build=true',
    config.builderImage,
  ];
}
```

### 4b. Flash ESP32 จาก browser

[`esp32-flasher.ts:18–76`](../frontend/src/app/features/user/workspace/firmware/esp32-flasher.ts#L18)

```ts
export async function flashEsp32(
  port: SerialPort,
  images: readonly FlashImage[],
  baudRate: number,
  reporter: FlashReporter,
): Promise<void> {
  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: baudRate,
    romBaudrate: ROM_BAUD,
    terminal: {
      clean: () => undefined,
      write: () => undefined,
      writeLine: (line: string) => {
        if (line.trim()) reporter.log(line.trim());
      },
    },
  });

  try {
    reporter.log('Connecting to the ESP32 bootloader…');
    await loader.main('default_reset');

    const chip = loader.chip.CHIP_NAME;
    if (chip !== 'ESP32') {
      throw new Esp32FlashError(
        `This board is an ${chip}, but the project is built for a classic ESP32. Nothing was written.`,
      );
    }

    const total = images.reduce((sum, image) => sum + image.data.length, 0);
    const before = images.map((_, index) =>
      images.slice(0, index).reduce((sum, image) => sum + image.data.length, 0),
    );
    await loader.writeFlash({
      fileArray: images.map((image) => ({ address: image.address, data: image.data })),
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, fileTotal) => {
        const done = before[fileIndex] + (written / fileTotal) * images[fileIndex].data.length;
        reporter.progress(Math.round((done / total) * 100));
      },
    });

    reporter.log('Restarting the board…');
    await loader.after('hard_reset');
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}
```

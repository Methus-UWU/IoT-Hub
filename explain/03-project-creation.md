# 03 · การสร้างโปรเจกต์ (Manual และ AI)

ทั้งสองโหมดใช้ endpoint เดียวกันคือ `POST /api/workspaces/:workspaceId/projects`
ต่างกันตรงที่หลังสร้างเสร็จจะพาผู้ใช้ไปหน้าไหน และโหมด AI จะสั่ง AI สร้างวงจรกับโค้ดต่อทันที

## ขั้นที่ 1 · กรอกฟอร์ม (เหมือนกันทั้งสองโหมด)

| โค้ด | ทำอะไร |
| --- | --- |
| [`create-project-dialog.ts:191`](../frontend/src/app/features/user/projects/create-project-dialog.ts#L191) | `createProject()` ตรวจฟอร์มแล้ว emit ค่า `{ name, description, boardId, framework, setupMode, devices }` |
| [`projects.page.ts:136`](../frontend/src/app/features/user/projects/projects.page.ts#L136) | `addProject()` เรียก store แล้วเลือกหน้าปลายทาง (บรรทัด 146–151) |
| [`project.store.ts:146`](../frontend/src/app/features/user/projects/project.store.ts#L146) | `create()` เรียก API โหมด manual ส่ง `deviceIds` ที่เลือกไว้ ส่วนโหมด AI ส่งเป็น `[]` (บรรทัด 159) |
| [`projects-api.service.ts:232`](../frontend/src/app/core/services/projects-api.service.ts#L232) | `createProject()` → `POST .../projects` |

หน้าปลายทาง (`projects.page.ts:147–151`):

- **manual** → `/user/projects/:id/virtual-device` (หน้า canvas ต่อวงจร)
- **ai + มีคำอธิบาย** → `/user/projects/:id/setup` (หน้า AI สร้างให้)
- **ai แต่ไม่มีคำอธิบาย** → `/user/projects/:id/ide`

## ขั้นที่ 2 · Backend สร้างโปรเจกต์

[`projects.controller.ts:73`](../backend/src/modules/projects/projects.controller.ts#L73) → [`projects.service.ts:69`](../backend/src/modules/projects/projects.service.ts#L69) `create()`

```
create(userId, workspaceId, body)
 1. entitlements.assertCanCreateProject(userId)        ตรวจโควตาตามแพ็กเกจ (throw ถ้าเกิน)
 2. findBoard(body.boardId)                             บอร์ดต้องอยู่ใน catalog
 3. ตรวจ name และ framework ว่าบอร์ดรองรับ
 4. componentsService.initialDevicePlacements(...)      จัดตำแหน่งอุปกรณ์ที่เลือก (manual)
 5. uniqueSlug(workspaceId, name)                       สร้าง slug ไม่ซ้ำใน workspace
 6. components.createProjectWithBoard(                  เขียนลง DB ใน transaction เดียว:
        project, board placement, devices,                - แถว projects
        starterFilesFor(board, framework, deviceIds))     - บอร์ดบน canvas + อุปกรณ์
                                                          - ไฟล์เริ่มต้น
```

- `createProjectWithBoard` อยู่ที่ [`prisma-project-component.repository.ts:158`](../backend/src/modules/projects/prisma-project-component.repository.ts#L158) ถ้าขั้นไหนพังจะไม่มีโปรเจกต์ครึ่ง ๆ กลาง ๆ ค้างอยู่
- ไฟล์เริ่มต้นมาจาก [`project-starter-files.ts:46`](../backend/src/modules/projects/project-starter-files.ts#L46) `starterFilesFor()`
  - PlatformIO: `platformio.ini` + `src/main.cpp`
  - Arduino: `main.ino`

## ขั้นที่ 3a · Manual

ผู้ใช้วางอุปกรณ์และต่อสายเองบน canvas (ดู [06-devices-and-wiring.md](06-devices-and-wiring.md)) แล้วเขียนโค้ดเองใน IDE

## ขั้นที่ 3b · AI สร้างให้

[`project-setup.page.ts:173`](../frontend/src/app/features/user/workspace/project-setup/project-setup.page.ts#L173) `generate()`

```
generate()
 1. ensureMainFile(project.id)                        หาไฟล์หลัก (main.cpp / main.ino)
 2. ai.chatStream(project.id, {                         POST .../ai/chat/stream
        profile: 'balanced',
        messages: [{ role: 'user', content: aiSetupPrompt(description) }],
        activeFile: mainFile })
      └─ onProgress(event) แสดงความคืบหน้าทีละขั้นบนหน้าจอ
 3. ถ้าได้ plan.actions → ai.apply(project.id, actions)   POST .../ai/apply
 4. canvas.arrangeNew(...)                             จัดอุปกรณ์ใหม่ข้างบอร์ด
 5. ล้าง cache แล้วโหลดไฟล์ใหม่
```

- prompt ที่ส่งมาจาก [`ai-setup-prompt.ts:7`](../frontend/src/app/features/user/workspace/ai-setup-prompt.ts#L7) `aiSetupPrompt()`: คำอธิบายของผู้ใช้ตามด้วยคำสั่งให้เลือกอุปกรณ์ อ่าน datasheet ต่อสาย และแก้โค้ดให้ครบ
- หน้า setup apply แผนอัตโนมัติเพราะผู้ใช้สั่งสร้างทั้งโปรเจกต์อยู่แล้ว ส่วนในแชตของ IDE ผู้ใช้ต้องกดยอมรับเองทุกครั้ง
- รายละเอียดว่า AI คิดและสร้างแผนอย่างไรอยู่ใน [04-ai-flow.md](04-ai-flow.md)

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### ฟอร์มส่งค่าออกมา

[`create-project-dialog.ts:191–196`](../frontend/src/app/features/user/projects/create-project-dialog.ts#L191)

```ts
  protected createProject(): void {
    this.submitAttempted.set(true);
    if (!this.canCreate()) return;

    this.created.emit({ ...this.model(), devices: [...this.model().devices] });
  }
```

### หน้า Projects: สร้างแล้วเลือกหน้าปลายทาง

[`projects.page.ts:136–164`](../frontend/src/app/features/user/projects/projects.page.ts#L136)

```ts
  protected async addProject(value: NewProjectValue): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const project = await this.projectStore.create(value);
      this.createDialogOpen.set(false);
      const aiBuild = value.setupMode === 'ai' && value.description.trim().length > 0;
      void this.router.navigate([
        '/user/projects',
        project.id,
        aiBuild ? 'setup' : value.setupMode === 'ai' ? 'ide' : 'virtual-device',
      ]);
    } catch (error) {
      const limit = isPlanLimitError(error);
      this.createError.set(
        limit
          ? limit.message || 'จำนวนโปรเจกต์หรืออุปกรณ์เกินโควตาของแผนปัจจุบัน'
          : 'ไม่สามารถสร้างโปรเจกต์ได้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      this.creating.set(false);
    }
  }
```

### Store: เรียก API (manual ส่ง deviceIds, AI ส่ง [])

[`project.store.ts:146–175`](../frontend/src/app/features/user/projects/project.store.ts#L146)

```ts
  async create(value: NewProjectValue): Promise<IoTProject> {
    const generation = this.loadGeneration;
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace available');
    if (generation !== this.loadGeneration) throw new Error('Workspace changed');

    const created = await firstValueFrom(
      this.api.createProject(workspace.id, {
        name: value.name.trim(),
        description: value.description.trim(),
        boardId: value.boardId,
        framework: value.framework,
        deviceIds: value.setupMode === 'manual' ? value.devices : [],
      }),
    );

    if (
      generation !== this.loadGeneration ||
      this.workspaces.activeWorkspaceId() !== workspace.id
    ) {
      throw new Error('Workspace changed');
    }
    const project = toProject(created, value);
    project.devices = created.components.map((component) => component.definitionId);
    if (value.setupMode === 'ai' && value.description.trim()) {
      this.pendingAiSetups.add(project.id);
    }
    this.projectState.update((projects) => [project, ...projects]);
    return project;
  }
```

### Backend: ProjectsService.create()

[`projects.service.ts:69–118`](../backend/src/modules/projects/projects.service.ts#L69)

```ts
  async create(
    userId: string,
    workspaceId: string,
    body: CreateProjectDto,
  ): Promise<Project & { components: ProjectComponent[] }> {
    await this.entitlements.assertCanCreateProject(userId);

    const board = findBoard(body.boardId);
    if (!board || !findDevice(board.id)?.isBoard) {
      throw new NotFoundException({
        code: 'BOARD_NOT_FOUND',
        message: 'Unknown board definition',
      });
    }

    const name = body.name.trim();
    const framework = body.framework?.trim() || board.defaultFramework;
    if (!name || !board.frameworks.includes(framework)) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_SETUP',
        message:
          'Enter a project name and choose a framework the board supports',
      });
    }
    const deviceIds = body.deviceIds ?? [];
    const devices = await this.componentsService.initialDevicePlacements(
      userId,
      deviceIds,
    );
    const slug = await this.uniqueSlug(workspaceId, name);

    const created = await this.components.createProjectWithBoard(
      {
        workspaceId,
        name,
        slug,
        description: body.description?.trim(),
        board: board.name,
        framework,
      },
      this.componentsService.boardPlacement(board.id, board.name),
      devices,
      starterFilesFor(board, framework, deviceIds),
    );

    return { ...created.project, components: created.components };
  }
```

### ไฟล์เริ่มต้นของโปรเจกต์

[`project-starter-files.ts:46–70`](../backend/src/modules/projects/project-starter-files.ts#L46)

```ts
export function starterFilesFor(
  board: BoardDefinition,
  framework: string,
  deviceIds: readonly string[],
): CreateFileInput[] {
  if (framework === PLATFORMIO && board.platformio) {
    return [
      toFileInput(
        PLATFORMIO_CONFIG_PATH,
        platformioConfig(board, board.platformio, deviceIds),
      ),
      toFileInput(
        PLATFORMIO_MAIN_PATH,
        `#include <Arduino.h>\n\n${SETUP_LOOP}`,
      ),
    ];
  }

  if (framework === ARDUINO_CPP) {
    return [toFileInput(ARDUINO_SKETCH_PATH, SETUP_LOOP)];
  }

  return [];
}
```

### Prompt ที่ใช้สร้างด้วย AI

[`ai-setup-prompt.ts:7–11`](../frontend/src/app/features/user/workspace/ai-setup-prompt.ts#L7)

```ts
export function aiSetupPrompt(description: string): string {
  return `${description.trim()}

เลือกอุปกรณ์จากคลังและสร้างแผนอุปกรณ์ สายไฟ และการแก้ไฟล์ให้ครบตามคำอธิบายนี้ อ่าน datasheet ของทุกอุปกรณ์ที่จะเพิ่มก่อนต่อสายและก่อนเขียนโค้ด แล้วทำตามข้อกำหนดในนั้น เช่น ตัวต้านทานพูลอัปหรือขาที่ทำงานที่ลอจิกต่ำ ตั้งค่าอุปกรณ์ให้ตรงกับคำอธิบาย เช่น สีของ LED ต่อโหลดที่ใช้ไฟแยกผ่านรีเลย์พร้อมแหล่งจ่ายของมัน อ่านไฟล์ก่อนแก้ แล้วแทนที่พฤติกรรมของโค้ดเริ่มต้นที่ไม่ตรงกับงาน เช่น เซนเซอร์หรือการรอ Wi-Fi ที่งานนี้ไม่ได้ใช้ ก่อนจบให้ตรวจว่าทุกอย่างในคำอธิบายมีครบแล้ว เสนอแผนให้ยอมรับ ไม่ใช่เพียงตัวอย่างโค้ดในแชต`;
}
```

### หน้า Setup: สั่ง AI สร้างแล้ว apply อัตโนมัติ

[`project-setup.page.ts:173–228`](../frontend/src/app/features/user/workspace/project-setup/project-setup.page.ts#L173)

```ts
  protected async generate(): Promise<void> {
    if (this.phase() === 'generating' || this.phase() === 'applying' || this.phase() === 'done')
      return;
    const project = this.project();
    const description = project?.description.trim();
    if (!project || !description) {
      this.fail('โปรเจกต์นี้ไม่มีคำอธิบายให้ AI สร้าง');
      return;
    }

    this.phase.set('generating');
    this.error.set(null);
    this.summary.set('');
    this.warnings.set([]);
    this.applied.set(null);
    this.log.set([]);
    this.reached.set('think');
    this.startClock();

    try {
      const mainFile = await this.ensureMainFile(project.id);
      const response = await this.ai.chatStream(
        project.id,
        {
          profile: 'balanced',
          messages: [{ role: 'user', content: aiSetupPrompt(description) }],
          activeFile: mainFile,
        },
        (event) => this.onProgress(event),
        this.abort.signal,
      );
      if (this.destroyRef.destroyed) return;
      this.summary.set(response.content);
      this.warnings.set(response.plan?.warnings ?? []);

      if (!response.plan?.actions.length) {
        this.phase.set('done');
        return;
      }

      this.phase.set('applying');
      const result = await this.ai.apply(project.id, response.plan.actions);
      await this.canvas.arrangeNew(project.id, result.createdComponentIds).catch(() => undefined);
      this.snapshots.forget(project.id);
      this.files.forget(project.id);
      await this.store.loadFiles(project.id).catch(() => undefined);
      this.applied.set(result);
      this.phase.set('done');
    } catch (error: unknown) {
      if (this.destroyRef.destroyed) return;
      this.fail(errorText(error));
    } finally {
      this.stopClock();
    }
  }
```

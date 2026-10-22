import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import type {
  AiProgressEvent,
  AiProgressStage,
  ApplyPlanResult,
} from '../../../../core/models/project-ai.model';
import { ProjectStore } from '../../projects/project.store';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { aiSetupPrompt } from '../ai-setup-prompt';
import { ProjectAiService } from '../project-ai.service';
import { pickEntryFile } from '../project-entry-file';
import { ProjectFilesClient } from '../project-files.client';
import { CanvasSnapshotCache } from '../virtual-device/services/canvas-snapshot-cache';
import { ProjectCanvasService } from '../virtual-device/services/project-canvas.service';

type Phase = 'waiting' | 'generating' | 'applying' | 'done' | 'failed';

type MilestoneId = 'think' | 'devices' | 'wiring' | 'code' | 'build';

interface Milestone {
  readonly id: MilestoneId;
  readonly label: string;
  readonly active: string;
}

interface LogEntry {
  readonly id: number;
  readonly key: string;
  readonly text: string;
  readonly status: AiProgressEvent['status'];
  readonly statusText: string;
}

const MILESTONES: readonly Milestone[] = [
  { id: 'think', label: 'วิเคราะห์ความต้องการ', active: 'AI กำลังคิดว่าต้องใช้อะไรบ้าง' },
  { id: 'devices', label: 'เลือกอุปกรณ์', active: 'กำลังเลือกอุปกรณ์และอ่าน datasheet' },
  { id: 'wiring', label: 'ต่อสาย', active: 'กำลังต่อสายเข้ากับบอร์ด' },
  { id: 'code', label: 'เขียนโปรแกรม', active: 'กำลังเขียนโปรแกรม' },
  { id: 'build', label: 'สร้างโปรเจกต์', active: 'กำลังวางอุปกรณ์และบันทึกลงโปรเจกต์' },
];

const MILESTONE_OF: Record<AiProgressStage, MilestoneId> = {
  thinking: 'think',
  checking: 'think',
  searching: 'devices',
  reading_datasheet: 'devices',
  adding_device: 'devices',
  configuring: 'devices',
  wiring: 'wiring',
  reading_code: 'code',
  writing_code: 'code',
};

const LOG_TEXT: Record<AiProgressStage, string> = {
  thinking: 'AI กำลังคิด',
  checking: 'ตรวจสอบวงจร',
  searching: 'ค้นหาอุปกรณ์',
  reading_datasheet: 'อ่าน datasheet',
  adding_device: 'เพิ่มอุปกรณ์',
  configuring: 'ตั้งค่าอุปกรณ์',
  wiring: 'ต่อสาย',
  reading_code: 'อ่านโค้ด',
  writing_code: 'เขียนโค้ด',
};

/**
 * The sketch a project without one gets, so the assistant edits a file that exists.
 * New projects arrive with a PlatformIO `src/main.cpp` from the server; this covers
 * projects created before that.
 */
const STARTER_SKETCH = `void setup() {
  Serial.begin(115200);
}

void loop() {
}
`;

const FALLBACK_MAIN_FILE = 'main.ino';

/**
 * Builds a project from the description it was created with.
 *
 * Creating a project in AI mode used to open the IDE and leave a proposal in the chat
 * for the user to accept. The description is the request, so here the proposal is
 * applied as soon as it is ready — the server still validates every wire exactly as it
 * does for an accepted plan. While the assistant works, each step it takes is shown,
 * because a turn runs for minutes and a bare spinner reads as a hang.
 */
@Component({
  selector: 'app-project-setup-page',
  imports: [RouterLink, MarkdownPipe],
  templateUrl: './project-setup.page.html',
  styleUrl: './project-setup.page.css',
})
export class ProjectSetupPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(ProjectStore);
  private readonly ai = inject(ProjectAiService);
  private readonly files = inject(ProjectFilesClient);
  private readonly canvas = inject(ProjectCanvasService);
  private readonly snapshots = inject(CanvasSnapshotCache);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly projectId =
    this.route.snapshot.paramMap.get('projectId') ??
    this.route.parent?.snapshot.paramMap.get('projectId') ??
    '';
  protected readonly project = computed(() => this.store.projectById(this.projectId));
  protected readonly milestones = MILESTONES;

  protected readonly phase = signal<Phase>('waiting');
  protected readonly log = signal<readonly LogEntry[]>([]);
  protected readonly reached = signal<MilestoneId>('think');
  protected readonly summary = signal('');
  protected readonly warnings = signal<readonly string[]>([]);
  protected readonly applied = signal<ApplyPlanResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly elapsedSeconds = signal(0);
  protected readonly motionPaused = signal(false);
  protected readonly busy = computed(
    () => this.phase() === 'generating' || this.phase() === 'applying',
  );
  protected readonly recentLog = computed(() => this.log().slice(-3));

  protected readonly activeText = computed(() => {
    if (this.phase() === 'applying') return MILESTONES[4].active;
    return MILESTONES.find((milestone) => milestone.id === this.reached())?.active ?? '';
  });

  private readonly abort = new AbortController();
  private logSequence = 0;
  private clock: ReturnType<typeof setInterval> | null = null;

  /** Starts once the project is known, and only for the creation that asked for it. */
  private readonly startWhenReady = effect(() => {
    const project = this.project();
    if (!project || this.phase() !== 'waiting') return;
    untracked(() => {
      if (this.store.takeAiSetupRequest(project.id)) void this.generate();
    });
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.abort.abort();
      this.stopClock();
    });
  }

  protected milestoneState(id: MilestoneId): 'done' | 'active' | 'pending' {
    const phase = this.phase();
    if (phase === 'done') return 'done';
    const order = MILESTONES.findIndex((milestone) => milestone.id === id);
    const current =
      phase === 'applying'
        ? MILESTONES.length - 1
        : MILESTONES.findIndex((milestone) => milestone.id === this.reached());
    if (order < current) return 'done';
    if (order === current && phase !== 'failed') return 'active';
    return 'pending';
  }

  protected elapsedText(): string {
    const seconds = this.elapsedSeconds();
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes} นาที ${seconds % 60} วินาที` : `${seconds} วินาที`;
  }

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
      // Everything cached about this project predates the build.
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

  protected cancel(): void {
    this.abort.abort();
    void this.router.navigate(['/user/projects', this.projectId, 'ide']);
  }

  private onProgress(event: AiProgressEvent): void {
    const milestone = MILESTONE_OF[event.stage];
    // Milestones only move forward: a check of the circuit after wiring is not a
    // step back to "analysing", however the model orders its reads.
    const order = (id: MilestoneId) => MILESTONES.findIndex((item) => item.id === id);
    if (order(milestone) > order(this.reached())) this.reached.set(milestone);

    if (event.stage === 'thinking' || event.stage === 'checking') return;
    const text = event.detail ? `${LOG_TEXT[event.stage]}: ${event.detail}` : LOG_TEXT[event.stage];
    const key = `${event.stage}:${event.detail ?? ''}`;
    const status = event.status ?? 'pending';
    const statusText = {
      pending: 'กำลังเตรียม',
      completed: 'เตรียมแล้ว',
      reused: 'ใช้อุปกรณ์เดิม',
      failed: 'คำสั่งไม่สำเร็จ',
      warning: 'เตรียมอุปกรณ์แล้ว · ต้องแก้สาย',
    }[status];
    this.log.update((entries) => {
      const existing = entries.find((entry) => entry.key === key);
      const entry: LogEntry = {
        id: existing?.id ?? ++this.logSequence,
        key,
        text,
        status,
        statusText,
      };
      return existing
        ? entries.map((item) => (item.key === key ? entry : item))
        : [...entries, entry];
    });
  }

  /** Returns the project's sketch path, creating a starter sketch only when it has none. */
  private async ensureMainFile(projectId: string): Promise<string> {
    const existing = pickEntryFile(await this.files.list(projectId));
    if (existing) return existing;
    await this.files.save(projectId, FALLBACK_MAIN_FILE, STARTER_SKETCH);
    return FALLBACK_MAIN_FILE;
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('failed');
  }

  private startClock(): void {
    this.stopClock();
    this.elapsedSeconds.set(0);
    this.clock = setInterval(() => this.elapsedSeconds.update((seconds) => seconds + 1), 1000);
  }

  private stopClock(): void {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }
}

function errorText(error: unknown): string {
  const body = (error as { error?: { error?: { message?: unknown } } })?.error?.error;
  if (typeof body?.message === 'string') return body.message;
  if (error instanceof Error && error.message) return error.message;
  return 'AI สร้างโปรเจกต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

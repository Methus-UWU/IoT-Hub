import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormField,
  form,
  maxLength,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  CommunityApiService,
  CommunityPostKind,
  CommunityTag,
} from '../../../core/services/community-api.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { AuthorBadge } from './author-badge';
import { communityBasePath } from './community-route';

interface AskFormValue {
  kind: CommunityPostKind;
  title: string;
  body: string;
  tags: string[];
}

interface KindOption {
  value: CommunityPostKind;
  label: string;
  hint: string;
}

const KIND_OPTIONS: readonly KindOption[] = [
  { value: 'question', label: 'คำถาม', hint: 'มีปัญหาที่ต้องการคำตอบ' },
  { value: 'discussion', label: 'พูดคุย', hint: 'ชวนแลกเปลี่ยนความเห็น' },
  { value: 'showcase', label: 'อวดผลงาน', hint: 'แชร์สิ่งที่ทำสำเร็จ' },
];

/** Mirrors the API's DTO limits, which in turn mirror the database constraints. */
const TITLE_MIN = 10;
const TITLE_MAX = 160;
const BODY_MIN = 20;
const BODY_MAX = 20_000;
const TAGS_MAX = 5;

/**
 * The composer.
 *
 * The body is Markdown, previewed through the same sanitizing pipe that renders
 * it on the thread page — what the author sees here is exactly what readers get,
 * including what the sanitizer strips.
 */
@Component({
  selector: 'app-ask-question-page',
  imports: [AuthorBadge, FormField, FieldError, MarkdownPipe],
  templateUrl: './ask-question.page.html',
  styleUrl: './ask-question.page.css',
})
export class AskQuestionPage {
  readonly closed = output<void>();

  private readonly api = inject(CommunityApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly communityPath = communityBasePath(this.router.url);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly titleMax = TITLE_MAX;
  protected readonly bodyMax = BODY_MAX;
  protected readonly tagsMax = TAGS_MAX;

  protected readonly tags = signal<CommunityTag[]>([]);
  protected readonly tagsLoading = signal(true);
  protected readonly tagsError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly showPreview = signal(false);

  private readonly model = signal<AskFormValue>({
    kind: 'question',
    title: '',
    body: '',
    tags: [],
  });

  protected readonly askForm = form(this.model, (path) => {
    required(path.title, { message: 'กรุณาตั้งชื่อกระทู้' });
    minLength(path.title, TITLE_MIN, {
      message: `ชื่อกระทู้ต้องมีอย่างน้อย ${TITLE_MIN} ตัวอักษร`,
    });
    maxLength(path.title, TITLE_MAX, {
      message: `ชื่อกระทู้ต้องไม่เกิน ${TITLE_MAX} ตัวอักษร`,
    });

    required(path.body, { message: 'กรุณาเขียนรายละเอียด' });
    minLength(path.body, BODY_MIN, {
      message: `อธิบายเพิ่มอีกนิด อย่างน้อย ${BODY_MIN} ตัวอักษร`,
    });
    maxLength(path.body, BODY_MAX, {
      message: 'รายละเอียดยาวเกินกำหนด',
    });

    validate(path.tags, (ctx) =>
      ctx.value().length === 0 ? { kind: 'required', message: 'เลือกอย่างน้อย 1 หัวข้อ' } : null,
    );
  });

  protected readonly selectedTags = computed(() => this.model().tags);
  protected readonly titleLength = computed(() => this.model().title.length);
  protected readonly bodyLength = computed(() => this.model().body.length);
  protected readonly bodyPreview = computed(() => this.model().body);
  protected readonly username = computed(
    () => this.auth.currentUser()?.username ?? 'สมาชิก IoT Hub',
  );
  protected readonly canSubmit = computed(() => {
    const value = this.model();
    return (
      value.title.trim().length >= TITLE_MIN &&
      value.body.trim().length >= BODY_MIN &&
      value.tags.length > 0 &&
      !this.askForm().invalid() &&
      !this.submitting()
    );
  });

  constructor() {
    void this.loadTags();
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  protected isSelected(slug: string): boolean {
    return this.model().tags.includes(slug);
  }

  /** Selecting a sixth tag is refused rather than silently dropping the first. */
  protected toggleTag(slug: string): void {
    this.model.update((value) => {
      if (value.tags.includes(slug)) {
        return { ...value, tags: value.tags.filter((tag) => tag !== slug) };
      }
      if (value.tags.length >= TAGS_MAX) return value;
      return { ...value, tags: [...value.tags, slug] };
    });
  }

  protected setKind(kind: CommunityPostKind): void {
    this.model.update((value) => ({ ...value, kind }));
  }

  protected togglePreview(): void {
    this.showPreview.update((value) => !value);
  }

  protected cancel(): void {
    if (this.submitting()) return;

    this.closed.emit();
    if (this.router.url === `${this.communityPath}/ask`) {
      void this.router.navigate([this.communityPath]);
    }
  }

  protected cancelDialog(event: Event): void {
    event.preventDefault();
    this.cancel();
  }

  protected async onSubmit(): Promise<void> {
    this.submitError.set(null);
    this.submitting.set(true);

    try {
      await submit(this.askForm, async () => {
        const value = this.askForm().value();
        const post = await firstValueFrom(this.api.createPost(value));
        await this.router.navigate([this.communityPath, post.slug]);
        return undefined;
      });
    } catch (error) {
      this.logger.error('Community post failed', error);
      this.submitError.set(this.messageFor(error));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async loadTags(): Promise<void> {
    this.tagsLoading.set(true);
    this.tagsError.set(null);

    try {
      this.tags.set(await firstValueFrom(this.api.listTags()));
    } catch (error) {
      this.logger.warn('Community tags failed to load', error);
      this.tags.set([]);
      this.tagsError.set('โหลดหัวข้อไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      this.tagsLoading.set(false);
    }
  }

  /** The daily ceiling is the one refusal worth explaining in its own words. */
  private messageFor(error: unknown): string {
    const code = (error as { error?: { error?: { code?: unknown } } })?.error?.error?.code;

    return code === 'COMMUNITY_POST_LIMIT_REACHED'
      ? 'วันนี้ตั้งกระทู้ครบจำนวนที่กำหนดแล้ว ลองใหม่พรุ่งนี้'
      : 'ตั้งกระทู้ไม่สำเร็จ ลองใหม่อีกครั้ง';
  }
}

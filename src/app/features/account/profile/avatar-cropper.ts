import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-avatar-cropper',
  templateUrl: './avatar-cropper.html',
  styleUrls: ['./profile.page.css', './avatar-cropper.css'],
})
export class AvatarCropper {
  readonly image = input.required<ImageBitmap>();
  readonly busy = input(false);
  readonly confirmed = output<Blob>();
  readonly cancelled = output<void>();
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zoomInput = viewChild<ElementRef<HTMLInputElement>>('zoomInput');
  protected readonly zoom = signal(1);
  protected readonly horizontal = signal(50);
  protected readonly vertical = signal(50);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  protected readonly disabled = computed(() => this.busy() || this.exporting());
  protected readonly zoomLabel = computed(() => `${Math.round(this.zoom() * 100)}%`);
  private drag: { id: number; x: number; y: number; horizontal: number; vertical: number } | null =
    null;
  private readonly crop = computed(() => {
    const image = this.image();
    const side = Math.min(image.width, image.height) / this.zoom();
    return {
      side,
      x: ((image.width - side) * this.horizontal()) / 100,
      y: ((image.height - side) * this.vertical()) / 100,
    };
  });

  constructor() {
    afterNextRender(() => this.zoomInput()?.nativeElement.focus());
    effect(() => {
      this.image();
      this.reset();
    });
    effect(() => {
      const canvas = this.canvas()?.nativeElement;
      const image = this.image();
      const { x, y, side } = this.crop();
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, side, side, 0, 0, canvas.width, canvas.height);
    });
  }

  protected adjust(control: 'zoom' | 'horizontal' | 'vertical', event: Event): void {
    if (this.disabled()) return;
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this[control].set(
      control === 'zoom' ? Math.max(1, Math.min(3, value)) : Math.max(0, Math.min(100, value)),
    );
  }

  protected reset(): void {
    this.zoom.set(1);
    this.horizontal.set(50);
    this.vertical.set(50);
  }

  protected startDrag(event: PointerEvent): void {
    if (this.disabled() || !event.isPrimary || event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal: this.horizontal(),
      vertical: this.vertical(),
    };
  }

  protected moveDrag(event: PointerEvent): void {
    if (!this.drag || this.drag.id !== event.pointerId || this.disabled()) return;
    const image = this.image();
    const side = this.crop().side;
    const width = (event.currentTarget as HTMLElement).getBoundingClientRect().width;
    const offset = (distance: number, available: number) =>
      available > 0 ? ((distance * side) / width / available) * 100 : 0;
    this.horizontal.set(
      Math.max(
        0,
        Math.min(
          100,
          this.drag.horizontal - offset(event.clientX - this.drag.x, image.width - side),
        ),
      ),
    );
    this.vertical.set(
      Math.max(
        0,
        Math.min(
          100,
          this.drag.vertical - offset(event.clientY - this.drag.y, image.height - side),
        ),
      ),
    );
  }

  protected endDrag(): void {
    this.drag = null;
  }

  protected async confirm(): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas || this.disabled()) return;
    this.exporting.set(true);
    this.error.set('');
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.size > 512 * 1024) throw new Error('Image conversion failed');
      this.confirmed.emit(blob);
    } catch {
      this.error.set('เตรียมรูปไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      this.exporting.set(false);
    }
  }
}

import {
  Directive,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';

const DEFAULT_HEIGHT = 224;
const MIN_HEIGHT = 144;
const CANVAS_CLEARANCE = 96;

@Directive({
  selector: '[appSerialMonitorResize]',
  exportAs: 'serialMonitorResize',
  host: {
    '[style.height.px]': 'visibleHeight()',
    '[class.serial-resizing]': 'resizing()',
  },
})
export class SerialMonitorResize {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private drag: { pointerId: number; y: number; height: number } | null = null;

  readonly height = model(DEFAULT_HEIGHT);
  readonly maxHeight = signal(DEFAULT_HEIGHT);
  readonly minHeight = computed(() => Math.min(MIN_HEIGHT, this.maxHeight()));
  readonly visibleHeight = computed(() => this.clamp(this.height()));
  readonly resizing = signal(false);

  constructor() {
    afterNextRender(() => {
      const parent = this.element.nativeElement.parentElement;
      if (!parent) return;
      const updateBounds = () => {
        this.maxHeight.set(Math.max(0, parent.clientHeight - CANVAS_CLEARANCE));
      };
      updateBounds();
      const observer = new ResizeObserver(updateBounds);
      observer.observe(parent);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  begin(event: PointerEvent): void {
    if (event.button !== 0 || this.drag) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, y: event.clientY, height: this.visibleHeight() };
    this.resizing.set(true);
  }

  move(event: PointerEvent): void {
    if (event.pointerId !== this.drag?.pointerId) return;
    event.stopPropagation();
    this.height.set(this.clamp(this.drag.height + this.drag.y - event.clientY));
  }

  finish(event: PointerEvent): void {
    if (event.pointerId !== this.drag?.pointerId) return;
    event.stopPropagation();
    this.drag = null;
    this.resizing.set(false);
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }

  handleKey(event: KeyboardEvent): void {
    let next = this.visibleHeight();
    switch (event.key) {
      case 'ArrowUp':
        next += 24;
        break;
      case 'ArrowDown':
        next -= 24;
        break;
      case 'Home':
        next = this.minHeight();
        break;
      case 'End':
        next = this.maxHeight();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.height.set(this.clamp(next));
  }

  reset(): void {
    this.height.set(this.clamp(DEFAULT_HEIGHT));
  }

  private clamp(height: number): number {
    return Math.round(Math.min(this.maxHeight(), Math.max(this.minHeight(), height)));
  }
}

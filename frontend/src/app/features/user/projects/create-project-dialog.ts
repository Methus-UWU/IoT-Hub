import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, form, maxLength, pattern, required } from '@angular/forms/signals';

import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { NewProjectValue, ProjectSetupMode } from './project.store';
import { ProjectSetupStore } from './project-setup.store';
import { FieldError } from '../../../shared/components/field-error/field-error';

export type { NewProjectValue } from './project.store';

const EMPTY_PROJECT: NewProjectValue = {
  name: '',
  setupMode: 'ai',
  description: '',
  boardId: '',
  framework: '',
  devices: [],
};

@Component({
  selector: 'app-create-project-dialog',
  imports: [CustomSelect, FormField, FieldError],
  templateUrl: './create-project-dialog.html',
  styleUrl: './create-project-dialog.css',
  providers: [ProjectSetupStore],
})
export class CreateProjectDialog {
  readonly created = output<NewProjectValue>();
  readonly closed = output<void>();
  readonly creating = input(false);
  readonly error = input<string | null>(null);
  protected readonly setup = inject(ProjectSetupStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  private readonly model = signal<NewProjectValue>({ ...EMPTY_PROJECT });

  protected readonly submitAttempted = signal(false);
  protected readonly maxInitialDevices = 49;
  protected readonly boardOptions = this.setup.boardOptions;
  protected readonly frameworkOptions = computed<readonly CustomSelectOption[]>(() => {
    const board = this.setup.boards().find((board) => board.id === this.model().boardId);
    return (board?.frameworks ?? []).map((framework) => ({ value: framework, label: framework }));
  });
  protected readonly deviceQuery = signal('');
  protected readonly filteredDevices = computed(() => {
    const query = this.deviceQuery().trim().toLocaleLowerCase();
    return this.setup
      .devices()
      .filter(
        (device) =>
          !query ||
          device.name.toLocaleLowerCase().includes(query) ||
          device.description.toLocaleLowerCase().includes(query),
      );
  });
  protected readonly selectedDeviceCount = computed(() => this.model().devices.length);
  protected readonly previewName = computed(() => this.model().name.trim() || 'Your next big idea');
  protected readonly previewBoard = computed(
    () =>
      this.boardOptions().find((board) => board.value === this.model().boardId)?.label ||
      'เลือกบอร์ดของคุณ',
  );
  protected readonly isAiMode = computed(() => this.model().setupMode === 'ai');
  protected readonly previewDescription = computed(
    () => this.model().description.trim() || 'จากไอเดียเล็ก ๆ สู่สิ่งที่เชื่อมต่อได้จริง',
  );
  protected readonly projectForm = form(this.model, (path) => {
    required(path.name, { message: 'กรุณากรอกชื่อโปรเจกต์' });
    pattern(path.name, /\S/, { message: 'กรุณากรอกชื่อโปรเจกต์' });
    maxLength(path.name, 80, { message: 'ชื่อโปรเจกต์ต้องไม่เกิน 80 ตัวอักษร' });
    maxLength(path.description, 500, { message: 'คำอธิบายต้องไม่เกิน 500 ตัวอักษร' });
    required(path.boardId, { message: 'กรุณาเลือกบอร์ดอุปกรณ์' });
    required(path.framework, { message: 'กรุณาเลือกเฟรมเวิร์ก' });
  });

  protected readonly showNameError = computed(
    () =>
      this.projectForm.name().invalid() &&
      (this.projectForm.name().dirty() || this.submitAttempted()),
  );
  protected readonly canCreate = computed(() => {
    const project = this.model();
    const hasRequiredFields =
      project.name.trim().length > 0 &&
      project.boardId.trim().length > 0 &&
      project.framework.trim().length > 0;
    return (
      hasRequiredFields &&
      !this.projectForm().invalid() &&
      this.boardOptions().some((option) => option.value === project.boardId) &&
      this.frameworkOptions().some((option) => option.value === project.framework) &&
      !this.setup.loading() &&
      !this.setup.error() &&
      !this.creating()
    );
  });

  constructor() {
    this.setup.load();
    effect(() => {
      const first = this.setup.boards()[0];
      if (first && !this.model().boardId) this.updateBoard(first.id);
    });
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  protected setSetupMode(mode: ProjectSetupMode): void {
    if (this.creating()) return;
    if (this.model().setupMode === mode) return;
    this.model.update((value) => ({ ...value, setupMode: mode }));
  }

  protected updateBoard(value: string): void {
    const board = this.setup.boards().find((board) => board.id === value);
    if (!board || this.creating()) return;
    this.model.update((project) => ({
      ...project,
      boardId: board.id,
      framework: board.defaultFramework,
    }));
  }

  protected updateFramework(value: string): void {
    this.model.update((project) => ({ ...project, framework: value }));
  }

  protected updateDeviceSearch(event: Event): void {
    this.deviceQuery.set((event.target as HTMLInputElement).value);
  }

  protected deviceSelected(deviceId: string): boolean {
    return this.deviceQuantity(deviceId) > 0;
  }

  protected deviceQuantity(deviceId: string): number {
    return this.model().devices.reduce((quantity, id) => quantity + (id === deviceId ? 1 : 0), 0);
  }

  protected toggleDevice(deviceId: string): void {
    if (this.creating()) return;
    this.model.update((project) => ({
      ...project,
      devices: project.devices.includes(deviceId)
        ? project.devices.filter((id) => id !== deviceId)
        : [...project.devices, deviceId],
    }));
  }

  protected increaseDeviceQuantity(deviceId: string): void {
    if (this.creating() || this.selectedDeviceCount() >= this.maxInitialDevices) return;
    this.model.update((project) => ({
      ...project,
      devices: [...project.devices, deviceId],
    }));
  }

  protected decreaseDeviceQuantity(deviceId: string): void {
    if (this.creating() || this.deviceQuantity(deviceId) <= 1) return;
    this.model.update((project) => {
      const index = project.devices.lastIndexOf(deviceId);
      return {
        ...project,
        devices: project.devices.filter((_, itemIndex) => itemIndex !== index),
      };
    });
  }

  protected close(): void {
    if (!this.creating()) this.closed.emit();
  }

  protected cancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected createProject(): void {
    this.submitAttempted.set(true);
    if (!this.canCreate()) return;

    this.created.emit({ ...this.model(), devices: [...this.model().devices] });
  }
}

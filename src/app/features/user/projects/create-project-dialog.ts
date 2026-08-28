import { Component, computed, output, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';

import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { NewProjectValue, ProjectSetupMode } from './project.store';

export type { NewProjectValue } from './project.store';

const EMPTY_PROJECT: NewProjectValue = {
  name: '',
  setupMode: 'ai',
  description: '',
  board: 'ESP32 DevKit V1',
  framework: 'Arduino C++',
  devices: [],
};

const BOARD_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'ESP32 DevKit V1', label: 'ESP32 DevKit V1', description: 'เหมาะสำหรับเริ่มต้นและงานต้นแบบ' },
  { value: 'ESP32-S3', label: 'ESP32-S3', description: 'รองรับ AI และ USB ในตัว' },
  { value: 'Raspberry Pi Pico W', label: 'Raspberry Pi Pico W', description: 'บอร์ด RP2040 พร้อม Wi-Fi' },
  { value: 'Arduino Nano 33 IoT', label: 'Arduino Nano 33 IoT', description: 'ขนาดกะทัดรัด พร้อม Wi-Fi' },
];

const FRAMEWORK_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'Arduino C++', label: 'Arduino C++', description: 'ใช้งานง่ายและมีไลบรารีจำนวนมาก' },
  { value: 'PlatformIO', label: 'PlatformIO', description: 'เหมาะกับโปรเจกต์ที่มีโครงสร้างซับซ้อน' },
  { value: 'MicroPython', label: 'MicroPython', description: 'พัฒนาและทดลองได้อย่างรวดเร็ว' },
];

interface SelectableDevice {
  id: string;
  name: string;
  detail: string;
  type: 'board' | 'sensor' | 'module';
}

const MANUAL_DEVICES: readonly SelectableDevice[] = [
  { id: 'esp32-dev-board', name: 'ESP32 Dev Board', detail: 'Wi-Fi + Bluetooth', type: 'board' },
  { id: 'esp8266-nodemcu', name: 'ESP8266 NodeMCU', detail: 'Wi-Fi ในตัว', type: 'board' },
  { id: 'esp32-cam', name: 'ESP32-CAM Module', detail: 'กล้องและ Wi-Fi ในตัว', type: 'module' },
  { id: 'arduino-uno-r3', name: 'Arduino UNO R3', detail: 'บอร์ดสำหรับเริ่มต้น', type: 'board' },
  { id: 'arduino-mega-2560', name: 'Arduino Mega 2560', detail: 'พอร์ต I/O จำนวนมาก', type: 'board' },
  { id: 'pico-w', name: 'Raspberry Pi Pico W', detail: 'RP2040 พร้อม Wi-Fi', type: 'board' },
  { id: 'dht22', name: 'DHT22', detail: 'เซนเซอร์อุณหภูมิและความชื้น', type: 'sensor' },
  { id: 'soil-moisture', name: 'Soil Moisture Sensor', detail: 'เซนเซอร์ความชื้นในดิน', type: 'sensor' },
  { id: 'relay-module', name: 'Relay Module', detail: 'ควบคุมปั๊ม วาล์ว หรืออุปกรณ์ไฟฟ้า', type: 'module' },
];

@Component({
  selector: 'app-create-project-dialog',
  imports: [CustomSelect, FormField],
  templateUrl: './create-project-dialog.html',
  styleUrl: './create-project-dialog.css',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class CreateProjectDialog {
  readonly created = output<NewProjectValue>();
  readonly closed = output<void>();

  private readonly model = signal<NewProjectValue>({ ...EMPTY_PROJECT });
  private readonly dragStartX = signal<number | null>(null);
  private readonly dragStartMode = signal<ProjectSetupMode>('ai');
  private readonly dragTrackWidth = signal(1);
  private readonly dragPercent = signal(0);
  private suppressSetupClick = false;

  protected readonly creating = signal(false);
  protected readonly submitAttempted = signal(false);
  protected readonly boardOptions = BOARD_OPTIONS;
  protected readonly frameworkOptions = FRAMEWORK_OPTIONS;
  protected readonly deviceQuery = signal('');
  protected readonly setupDragging = signal(false);
  protected readonly filteredDevices = computed(() => {
    const query = this.deviceQuery().trim().toLocaleLowerCase();
    return MANUAL_DEVICES.filter(
      (device) =>
        !query ||
        device.name.toLocaleLowerCase().includes(query) ||
        device.detail.toLocaleLowerCase().includes(query),
    );
  });
  protected readonly selectedDeviceCount = computed(() => this.model().devices.length);
  protected readonly setupSlidePercent = computed(() => {
    if (this.setupDragging()) {
      const base = this.dragStartMode() === 'ai' ? 0 : 100;
      return Math.min(100, Math.max(0, base + this.dragPercent()));
    }
    return this.model().setupMode === 'ai' ? 0 : 100;
  });
  protected readonly setupThumbTransform = computed(() => {
    if (this.setupDragging()) {
      const offset = (this.setupSlidePercent() / 100) * this.dragTrackWidth();
      return `translateX(${offset}px)`;
    }
    return this.model().setupMode === 'manual'
      ? 'translateX(calc(100% + 0.3rem))'
      : 'translateX(0)';
  });
  protected readonly projectForm = form(this.model, (path) => {
    required(path.name, { message: 'กรุณากรอกชื่อโปรเจกต์' });
    required(path.board, { message: 'กรุณาเลือกบอร์ดอุปกรณ์' });
    required(path.framework, { message: 'กรุณาเลือกเฟรมเวิร์ก' });
  });

  protected readonly showNameError = computed(
    () =>
      this.model().name.trim().length === 0 &&
      (this.projectForm.name().dirty() || this.submitAttempted()),
  );
  protected readonly canCreate = computed(() => {
    const project = this.model();
    const hasRequiredFields =
      project.name.trim().length > 0 &&
      project.board.trim().length > 0 &&
      project.framework.trim().length > 0;
    const hasManualDevice = project.setupMode !== 'manual' || project.devices.length > 0;

    return hasRequiredFields && hasManualDevice && !this.creating();
  });

  protected setSetupMode(mode: ProjectSetupMode): void {
    if (this.suppressSetupClick) return;
    if (this.model().setupMode === mode) return;
    this.model.update((value) => ({ ...value, setupMode: mode }));
  }

  protected updateBoard(value: string): void {
    this.model.update((project) => ({ ...project, board: value }));
  }

  protected updateFramework(value: string): void {
    this.model.update((project) => ({ ...project, framework: value }));
  }

  protected updateDeviceSearch(event: Event): void {
    this.deviceQuery.set((event.target as HTMLInputElement).value);
  }

  protected deviceSelected(deviceId: string): boolean {
    return this.model().devices.includes(deviceId);
  }

  protected toggleDevice(deviceId: string): void {
    this.model.update((project) => ({
      ...project,
      devices: project.devices.includes(deviceId)
        ? project.devices.filter((id) => id !== deviceId)
        : [...project.devices, deviceId],
    }));
  }

  protected startSetupDrag(event: PointerEvent): void {
    const track = event.currentTarget as HTMLElement;
    track.setPointerCapture(event.pointerId);
    this.dragStartX.set(event.clientX);
    this.dragStartMode.set(this.model().setupMode);
    const options = track.querySelectorAll<HTMLElement>('button');
    const travelDistance =
      options.length > 1 ? options[1].offsetLeft - options[0].offsetLeft : track.clientWidth / 2;
    this.dragTrackWidth.set(Math.max(travelDistance, 1));
    this.dragPercent.set(0);
    this.setupDragging.set(false);
    this.suppressSetupClick = false;
  }

  protected moveSetupDrag(event: PointerEvent): void {
    const startX = this.dragStartX();
    if (startX === null) return;

    const delta = event.clientX - startX;
    if (Math.abs(delta) <= 5 && !this.setupDragging()) return;

    this.setupDragging.set(true);
    this.dragPercent.set((delta / this.dragTrackWidth()) * 100);
    this.suppressSetupClick = true;
  }

  protected endSetupDrag(event: PointerEvent): void {
    if (this.dragStartX() === null) return;

    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (this.setupDragging()) {
      const mode: ProjectSetupMode = this.setupSlidePercent() >= 50 ? 'manual' : 'ai';
      this.model.update((value) => ({ ...value, setupMode: mode }));
    } else {
      const rect = target.getBoundingClientRect();
      const mode: ProjectSetupMode = event.clientX - rect.left >= rect.width / 2 ? 'manual' : 'ai';
      this.setSetupMode(mode);
    }
    this.dragStartX.set(null);
    this.dragPercent.set(0);
    this.setupDragging.set(false);
    if (this.suppressSetupClick) {
      setTimeout(() => (this.suppressSetupClick = false));
    }
  }

  protected close(): void {
    if (!this.creating()) this.closed.emit();
  }

  protected async createProject(): Promise<void> {
    this.submitAttempted.set(true);
    if (!this.canCreate()) return;

    this.creating.set(true);

    try {
      await submit(this.projectForm, async () => {
        this.created.emit(this.model());
        this.model.set({ ...EMPTY_PROJECT });
        this.projectForm().reset();
        this.submitAttempted.set(false);
        return undefined;
      });
    } finally {
      this.creating.set(false);
    }
  }
}

import { DatePipe, DOCUMENT } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';

import { apiErrorMessage } from '../../../../core/models/api-error';
import { environment } from '../../../../../environments/environment';
import type { Datastream } from './dashboard-api.client';
import { DashboardIcon } from './dashboard-icon';
import { DashboardLive } from './dashboard-live';
import { DeviceView, DevicesApiClient } from './devices-api.client';

/**
 * The project's devices: add a board, see whether it is online, rotate its token, or
 * remove it. A new or rotated token is shown once, with a sketch that reports to it;
 * the server keeps only a hash, so closing the panel is the last chance to copy it.
 */
@Component({
  selector: 'app-devices-panel',
  imports: [DashboardIcon, DatePipe],
  templateUrl: './devices-panel.html',
  styleUrl: './devices-panel.css',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class DevicesPanel {
  private readonly api = inject(DevicesApiClient);
  private readonly live = inject(DashboardLive);
  private readonly document = inject(DOCUMENT);

  readonly projectId = input.required<string>();
  readonly datastreams = input<readonly Datastream[]>([]);
  /** The device the dashboard shows. */
  readonly selectedDeviceId = input('');
  readonly deviceSelected = output<string>();
  readonly closed = output<void>();

  protected readonly devices = this.live.devices;
  protected readonly loaded = this.live.devicesLoaded;
  protected readonly busy = signal(false);
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly status = signal<{ text: string; kind: 'success' | 'warning' } | null>(null);
  /** A token just issued, shown until the panel closes. */
  protected readonly revealed = signal<{ deviceName: string; token: string } | null>(null);
  protected readonly copied = signal(false);

  protected readonly apiBase = computed(
    () => new URL(`${environment.apiUrl}device/v1`, this.document.baseURI).href,
  );
  protected readonly sketch = computed(() => {
    const token = this.revealed()?.token ?? 'YOUR_DEVICE_TOKEN';
    const numeric = this.datastreams().find((stream) => stream.dataType === 'number');
    const key = numeric?.key ?? 'temperature';
    return [
      '#include <WiFi.h>',
      '#include <WiFiClientSecure.h>',
      '#include <HTTPClient.h>',
      '',
      'const char* WIFI_SSID = "your-wifi";',
      'const char* WIFI_PASSWORD = "your-password";',
      `const char* API = "${this.apiBase()}";`,
      `const char* DEVICE_TOKEN = "${token}";`,
      '',
      'void report(float value) {',
      '  WiFiClientSecure client;',
      '  client.setInsecure();  // For a first test only; use client.setCACert(...) in production.',
      '  HTTPClient http;',
      '  http.begin(client, String(API) + "/telemetry");',
      '  http.addHeader("Content-Type", "application/json");',
      '  http.addHeader("Authorization", String("Device ") + DEVICE_TOKEN);',
      `  http.POST("{\\"values\\":{\\"${key}\\":" + String(value, 2) + "}}");`,
      '  http.end();',
      '}',
      '',
      'void setup() {',
      '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
      '  while (WiFi.status() != WL_CONNECTED) delay(500);',
      '}',
      '',
      'void loop() {',
      '  report(analogRead(34) / 40.95);  // replace with your sensor reading',
      '  delay(5000);',
      '}',
    ].join('\n');
  });

  constructor() {
    if (!this.live.devicesLoaded()) void this.reload();
  }

  protected async reload(): Promise<void> {
    await this.live.loadDevices(this.projectId());
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    await this.run(async () => {
      const created = await this.api.create(this.projectId(), name);
      this.devices.update((devices) => [...devices, created.device]);
      this.revealed.set({ deviceName: created.device.name, token: created.token });
      form.reset();
      if (!this.selectedDeviceId()) this.deviceSelected.emit(created.device.id);
    });
  }

  protected async rotate(device: DeviceView): Promise<void> {
    await this.run(async () => {
      const rotated = await this.api.rotateToken(this.projectId(), device.id);
      this.devices.update((devices) =>
        devices.map((entry) => (entry.id === device.id ? rotated.device : entry)),
      );
      this.revealed.set({ deviceName: device.name, token: rotated.token });
      this.status.set({
        text: `ออก token ใหม่ให้ ${device.name} แล้ว token เดิมใช้ไม่ได้อีก`,
        kind: 'warning',
      });
    });
  }

  protected async remove(device: DeviceView): Promise<void> {
    this.confirmingDelete.set(null);
    await this.run(async () => {
      await this.api.remove(this.projectId(), device.id);
      this.devices.update((devices) => devices.filter((entry) => entry.id !== device.id));
      if (this.selectedDeviceId() === device.id) this.deviceSelected.emit('');
      this.status.set({ text: `ลบ ${device.name} แล้ว`, kind: 'success' });
    });
  }

  protected async copy(text: string): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.status.set({ text: 'คัดลอกไม่ได้ เลือกข้อความแล้วคัดลอกเอง', kind: 'warning' });
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
    } catch (error: unknown) {
      this.status.set({
        text: apiErrorMessage(error) ?? 'ทำรายการไม่สำเร็จ ลองอีกครั้ง',
        kind: 'warning',
      });
    } finally {
      this.busy.set(false);
    }
  }
}

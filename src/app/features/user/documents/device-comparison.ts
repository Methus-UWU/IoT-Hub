import { Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import { DeviceThumbnail } from '../workspace/virtual-device/device-thumbnail';
import type { DeviceReference } from './device-reference';

@Component({
  selector: 'app-device-comparison',
  imports: [DeviceThumbnail],
  templateUrl: './device-comparison.html',
  styleUrl: './device-comparison.css',
})
export class DeviceComparison {
  readonly devices = input.required<readonly DeviceReference[]>();
  readonly limit = input.required<number>();
  readonly removed = output<string>();
  readonly cleared = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly mixedCategories = computed(
    () => new Set(this.devices().map((device) => device.categoryId)).size > 1,
  );
  protected readonly rows = computed(() => {
    const devices = this.devices();
    return [
      { label: 'หมวดอุปกรณ์', values: devices.map((device) => device.categoryLabel) },
      {
        label: 'จุดเด่น / ความสามารถ',
        values: devices.map((device) => device.summary || 'ยังไม่มีข้อมูลจุดเด่น'),
      },
      {
        label: 'เหมาะกับงาน',
        values: devices.map((device) => device.usage || 'ยังไม่มีข้อมูลการใช้งาน'),
      },
      {
        label: 'ข้อจำกัด / ข้อควรระวัง',
        values: devices.map(
          (device) =>
            device.caution || 'ยังไม่มีข้อมูลข้อจำกัด โปรดตรวจสอบเอกสารของรุ่นก่อนเลือกใช้',
        ),
      },
      { label: 'แรงดันใช้งาน', values: devices.map((device) => device.voltageLabel || 'ไม่ระบุ') },
      {
        label: 'การเชื่อมต่อ',
        values: devices.map((device) => device.interfaceLabels.join(', ') || 'ไม่ระบุ'),
      },
      {
        label: 'ขอบเขตการทำงาน',
        values: devices.map((device) => device.operatingRangeLabel || 'ไม่ระบุ'),
      },
      { label: 'ขนาด', values: devices.map((device) => device.sizeLabel || 'ไม่ระบุ') },
      { label: 'ขาอินพุต / เอาต์พุต', values: devices.map((device) => device.ioLabel) },
      { label: 'จำนวนขาทั้งหมด', values: devices.map((device) => `${device.pins.length} ขา`) },
    ];
  });

  protected open(): void {
    if (this.devices().length >= 2) this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }
}

import { Component, computed, signal } from '@angular/core';
import { DeviceArt } from '../../workspace/virtual-device/device-art/device-art';
import { WIRING_EXAMPLES } from './wiring-examples';

@Component({
  selector: 'app-wiring-gallery',
  imports: [DeviceArt],
  templateUrl: './wiring-gallery.html',
  styleUrl: './wiring-gallery.css',
})
export class WiringGallery {
  protected readonly examples = WIRING_EXAMPLES;
  protected readonly exampleIndex = signal(0);
  protected readonly example = computed(() => this.examples[this.exampleIndex()]);
  protected readonly selected = signal<number | null>(null);
  protected readonly enlarged = signal(false);

  protected show(index: number): void {
    this.exampleIndex.set(index);
    this.selected.set(null);
  }

  protected select(id: number): void {
    this.selected.update((current) => (current === id ? null : id));
  }
}

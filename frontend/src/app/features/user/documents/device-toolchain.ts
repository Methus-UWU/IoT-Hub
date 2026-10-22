import { Component, computed, input } from '@angular/core';

import type { LibraryReference } from '../workspace/virtual-device/simulation/firmware/libraries/library-catalog';

/**
 * How to build a part's example code in the Arduino IDE and in PlatformIO.
 *
 * The library names and `lib_deps` entries come from the simulator's library
 * catalog — the same table the assistant is told to use — so the docs, the AI,
 * and the canvas never disagree about which library drives a part.
 */
@Component({
  selector: 'app-device-toolchain',
  template: `
    <section class="toolchain" aria-labelledby="toolchain-title">
      <h3 id="toolchain-title">ใช้งานกับ Arduino IDE และ PlatformIO</h3>
      <div class="toolchain-grid">
        <div>
          <h4>Arduino IDE</h4>
          @if (installable().length) {
            <p>ติดตั้งผ่าน Library Manager (Sketch → Include Library → Manage Libraries):</p>
            <ul>
              @for (library of installable(); track library.name) {
                <li>{{ library.name }}</li>
              }
            </ul>
          } @else {
            <p>ไม่ต้องติดตั้ง library เพิ่ม ใช้คำสั่งพื้นฐานของ Arduino ได้เลย</p>
          }
          @if (includes().length) {
            <pre><code>{{ includeLines() }}</code></pre>
          }
          <p class="toolchain-note">วางโค้ดตัวอย่างในไฟล์ .ino แล้วเลือกบอร์ดและพอร์ตก่อนอัปโหลด</p>
        </div>
        <div>
          <h4>PlatformIO</h4>
          <p>เพิ่มใน <code>platformio.ini</code> (ตัวอย่างสำหรับ ESP32 DevKit):</p>
          <pre><code>{{ platformioIni() }}</code></pre>
          <p class="toolchain-note">
            โค้ดอยู่ที่ <code>src/main.cpp</code> ให้ใส่ <code>#include &lt;Arduino.h&gt;</code> บรรทัดแรก
            และประกาศฟังก์ชันก่อนเรียกใช้ โปรเจกต์ที่สร้างด้วยเฟรมเวิร์ก PlatformIO ในระบบจะมีไฟล์นี้ให้แล้ว
          </p>
        </div>
      </div>
    </section>
  `,
  styles: `
    .toolchain {
      margin-top: 1.5rem;
    }
    .toolchain-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: 1rem;
    }
    .toolchain-grid > div {
      padding: 0.9rem 1rem;
      border: 1px solid #e6e6e6;
      border-radius: 0.75rem;
      background: #fafafa;
      min-width: 0;
    }
    h4 {
      margin: 0 0 0.4rem;
      font-size: 0.95rem;
    }
    p,
    li {
      font-size: 0.875rem;
    }
    p {
      margin: 0.35rem 0;
    }
    ul {
      margin: 0.25rem 0 0.5rem;
      padding-left: 1.2rem;
    }
    pre {
      margin: 0.5rem 0;
      padding: 0.6rem 0.75rem;
      border-radius: 0.5rem;
      background: #1f1f1f;
      color: #f2f2f2;
      font-size: 0.8rem;
      overflow-x: auto;
    }
    .toolchain-note {
      color: #6b6b6b;
      font-size: 0.8rem;
    }
  `,
})
export class DeviceToolchain {
  readonly libraries = input<readonly LibraryReference[]>([]);

  /** Libraries that ship with the board core have no `platformio` entry and need no install. */
  protected readonly installable = computed(() =>
    this.libraries().filter((library) => library.platformio),
  );

  protected readonly includes = computed(() => [
    ...new Set(this.libraries().flatMap((library) => library.includes)),
  ]);

  protected readonly includeLines = computed(() =>
    this.includes()
      .map((file) => `#include <${file}>`)
      .join('\n'),
  );

  protected readonly platformioIni = computed(() => {
    const deps = this.installable().map((library) => `    ${library.platformio}`);
    return [
      '[env:esp32dev]',
      'platform = espressif32',
      'board = esp32dev',
      'framework = arduino',
      'monitor_speed = 115200',
      ...(deps.length ? ['lib_deps =', ...deps] : []),
    ].join('\n');
  });
}

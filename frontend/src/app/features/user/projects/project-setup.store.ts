import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin, from } from 'rxjs';

import { BoardDefinition, ProjectsApiService } from '../../../core/services/projects-api.service';
import {
  DeviceLibraryItem,
  isBoardCategory,
} from '../workspace/virtual-device/device-library.models';

@Injectable()
export class ProjectSetupStore {
  private readonly api = inject(ProjectsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly boardsState = signal<readonly BoardDefinition[]>([]);
  private readonly devicesState = signal<readonly DeviceLibraryItem[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly boards = this.boardsState.asReadonly();
  readonly devices = this.devicesState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly boardOptions = computed(() =>
    this.boards().map((board) => ({
      value: board.id,
      label: board.name,
    })),
  );

  load(): void {
    if (this.loading()) return;
    this.loadingState.set(true);
    this.errorState.set(null);
    forkJoin({
      boards: this.api.listBoards(),
      catalog: from(import('../workspace/virtual-device/devices/device-catalog')),
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingState.set(false)),
      )
      .subscribe({
        next: ({ boards, catalog }) => {
          this.boardsState.set(boards);
          this.devicesState.set(
            catalog.DEVICE_LIBRARY_ITEMS.filter((device) => !isBoardCategory(device.categoryId)),
          );
          if (!boards.length) this.errorState.set('ยังไม่มีบอร์ดที่พร้อมใช้งาน');
        },
        error: () => this.errorState.set('โหลดรายการบอร์ดและอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง'),
      });
  }
}

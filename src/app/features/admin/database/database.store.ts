import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import { DatabaseOverview } from '../../../core/models/admin.model';
import { DatabaseService } from './database.service';

@Injectable()
export class DatabaseStore {
  private readonly databaseService = inject(DatabaseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly overviewState = signal<DatabaseOverview | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly overview = this.overviewState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  load(): void {
    if (this.loadingState()) return;

    this.loadingState.set(true);
    this.errorState.set(null);
    this.databaseService
      .getOverview()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingState.set(false)),
      )
      .subscribe({
        next: (overview) => this.overviewState.set(overview),
        error: (error: unknown) => {
          // Never retain privileged metrics after a failed authorization or refresh.
          this.overviewState.set(null);
          const forbidden = error instanceof HttpErrorResponse && error.status === 403;
          this.errorState.set(
            forbidden
              ? 'คุณไม่มีสิทธิ์ดูสถานะฐานข้อมูล'
              : 'ไม่สามารถตรวจสอบฐานข้อมูลได้ กรุณาลองอีกครั้ง',
          );
        },
      });
  }
}

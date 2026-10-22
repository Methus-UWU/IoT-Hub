import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Service()
export class AccountAvatarService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  // Keyed on the session, not the API profile: the cached display name renders
  // initials before the profile arrives, so waiting for it flashed initials first.
  private readonly userId = this.auth.sessionUserId;
  private readonly endpoint = `${environment.apiUrl}auth/me/avatar`;
  private readonly imageUrl = signal<string | null>(null);
  private revision = 0;
  private readonly settledUserId = signal<string | null>(null);
  readonly ready = computed(() => Boolean(this.userId() && this.settledUserId() === this.userId()));
  readonly url = this.imageUrl.asReadonly();
  /** Derived, so it is already true in the render before the fetch effect runs. */
  readonly loading = computed(() => Boolean(this.userId()) && !this.ready());
  readonly busy = signal(false);
  readonly loadError = signal(false);

  constructor() {
    effect((onCleanup) => {
      const userId = this.userId();
      this.replaceImage(null);
      this.settledUserId.set(null);
      const revision = ++this.revision;
      this.loadError.set(false);
      if (!userId) return;
      const request = this.http
        .get(this.endpoint, { responseType: 'blob' })
        .pipe(timeout(15000))
        .subscribe({
          next: (blob) => {
            void this.prepareLoadedImage(blob, userId, revision);
          },
          error: (error: unknown) => {
            if (revision !== this.revision) return;
            this.loadError.set(!(error instanceof HttpErrorResponse && error.status === 404));
            this.settledUserId.set(userId);
          },
        });
      onCleanup(() => request.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => {
      ++this.revision;
      this.replaceImage(null);
    });
  }

  private async prepareLoadedImage(blob: Blob, userId: string, revision: number): Promise<void> {
    const url = URL.createObjectURL(blob);
    let accepted = false;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (revision !== this.revision || this.userId() !== userId) return;
      this.replaceImageUrl(url);
      accepted = true;
    } catch {
      if (revision === this.revision && this.userId() === userId) this.loadError.set(true);
    } finally {
      if (!accepted) URL.revokeObjectURL(url);
      if (revision === this.revision && this.userId() === userId) this.settledUserId.set(userId);
    }
  }

  async save(image: Blob): Promise<void> {
    if (this.busy()) return;
    const userId = this.userId();
    if (!userId) throw new Error('No active account');
    const revision = ++this.revision;
    this.busy.set(true);
    try {
      const form = new FormData();
      form.append('file', image, 'avatar.png');
      await firstValueFrom(this.http.put<void>(this.endpoint, form));
      if (this.userId() === userId && revision === this.revision) {
        this.replaceImage(image);
        this.loadError.set(false);
      }
    } finally {
      this.settle(userId);
      this.busy.set(false);
    }
  }

  async remove(): Promise<void> {
    if (this.busy()) return;
    const userId = this.userId();
    if (!userId) throw new Error('No active account');
    const revision = ++this.revision;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete<void>(this.endpoint));
      if (this.userId() === userId && revision === this.revision) this.replaceImage(null);
    } finally {
      this.settle(userId);
      this.busy.set(false);
    }
  }

  /** A save/remove bumps the revision, so the initial load it overtook never settles. */
  private settle(userId: string): void {
    if (this.userId() === userId) this.settledUserId.set(userId);
  }

  private replaceImage(blob: Blob | null): void {
    this.replaceImageUrl(blob ? URL.createObjectURL(blob) : null);
  }

  private replaceImageUrl(url: string | null): void {
    const previous = untracked(this.imageUrl);
    if (previous) URL.revokeObjectURL(previous);
    this.imageUrl.set(url);
  }
}

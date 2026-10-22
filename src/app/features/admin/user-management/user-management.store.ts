import { Service, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, forkJoin } from 'rxjs';

import {
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
  CreateAdminUserPayload,
  UpdateAdminUserPayload,
} from '../../../core/models/admin.model';
import { LoggerService } from '../../../core/services/logger.service';
import { UserManagementService } from './user-management.service';

@Service()
export class UserManagementStore {
  private readonly userService = inject(UserManagementService);
  private readonly logger = inject(LoggerService);

  private readonly _users = signal<AdminUser[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _busyUserId = signal<string | null>(null);
  private readonly _search = signal('');
  private readonly _roleFilter = signal<AdminUserRole | 'all'>('all');
  private readonly _statusFilter = signal<AdminUserStatus | 'all'>('all');
  private readonly _roles = signal<AdminUserRole[]>([]);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busyUserId = this._busyUserId.asReadonly();
  readonly search = this._search.asReadonly();
  readonly roleFilter = this._roleFilter.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly roles = this._roles.asReadonly();

  readonly filteredUsers = computed(() => {
    const term = this._search().trim().toLowerCase();
    const users = this._users();
    const role = this._roleFilter();
    const status = this._statusFilter();
    return users.filter((user) => {
      const matchesSearch =
        !term ||
        user.username.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term);
      const matchesRole = role === 'all' || user.role === role;
      const matchesStatus = status === 'all' || user.status === status;
      return matchesSearch && matchesRole && matchesStatus;
    });
  });

  readonly hasActiveFilters = computed(
    () =>
      Boolean(this._search().trim()) ||
      this._roleFilter() !== 'all' ||
      this._statusFilter() !== 'all',
  );

  readonly totalCount = computed(() => this._users().length);
  readonly activeCount = computed(
    () => this._users().filter((user) => user.status === 'active').length,
  );

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    forkJoin({ users: this.userService.list(), roles: this.userService.listRoles() }).subscribe({
      next: ({ users, roles }) => {
        this._users.set(users);
        this._roles.set(roles);
        this._loading.set(false);
      },
      error: (err) => {
        this._error.set('ไม่สามารถโหลดรายการผู้ใช้งานได้');
        this._loading.set(false);
        this.logger.error('User list failed', err);
      },
    });
  }

  setSearch(term: string): void {
    this._search.set(term);
  }

  setRoleFilter(role: AdminUserRole | 'all'): void {
    this._roleFilter.set(role);
  }

  setStatusFilter(status: AdminUserStatus | 'all'): void {
    this._statusFilter.set(status);
  }

  clearFilters(): void {
    this._search.set('');
    this._roleFilter.set('all');
    this._statusFilter.set('all');
  }

  update(id: string, payload: UpdateAdminUserPayload): Promise<boolean> {
    this._busyUserId.set(id);
    this._error.set(null);
    return new Promise((resolve) => {
      this.userService.update(id, payload).subscribe({
        next: (updated) => {
          this.replaceUser(updated);
          this._busyUserId.set(null);
          resolve(true);
        },
        error: (err) => {
          this._busyUserId.set(null);
          this._error.set('ไม่สามารถแก้ไขข้อมูลได้ ชื่อผู้ใช้งานอาจถูกใช้งานแล้ว');
          this.logger.error('User update failed', err);
          resolve(false);
        },
      });
    });
  }

  setStatus(id: string, status: AdminUserStatus): void {
    this._busyUserId.set(id);
    this._error.set(null);
    this.userService.setStatus(id, status).subscribe({
      next: (updated) => {
        this.replaceUser(updated);
        this._busyUserId.set(null);
      },
      error: (err) => {
        this._busyUserId.set(null);
        this._error.set('ไม่สามารถเปลี่ยนสถานะผู้ใช้งานได้');
        this.logger.error('User status update failed', err);
      },
    });
  }

  /** Returns an error message for the dialog, or null when the account exists. */
  async create(payload: CreateAdminUserPayload): Promise<string | null> {
    try {
      const created = await firstValueFrom(this.userService.create(payload));
      this._users.update((users) => [created, ...users]);
      return null;
    } catch (err) {
      this.logger.error('User creation failed', err);
      const code = err instanceof HttpErrorResponse ? errorCode(err) : undefined;
      if (code === 'USERNAME_TAKEN') return 'ชื่อผู้ใช้งานนี้ถูกใช้แล้ว';
      if (code === 'EMAIL_TAKEN') return 'อีเมลนี้มีบัญชีอยู่แล้ว';
      return 'สร้างบัญชีไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง';
    }
  }

  /** Resolves true once the account is gone; failures surface in `error`. */
  async delete(id: string): Promise<boolean> {
    this._busyUserId.set(id);
    this._error.set(null);
    try {
      await firstValueFrom(this.userService.delete(id));
      this._users.update((users) => users.filter((user) => user.id !== id));
      return true;
    } catch (err) {
      this._error.set('ไม่สามารถลบบัญชีผู้ใช้งานได้');
      this.logger.error('User deletion failed', err);
      return false;
    } finally {
      this._busyUserId.set(null);
    }
  }

  private replaceUser(updated: AdminUser): void {
    this._users.update((users) => users.map((user) => (user.id === updated.id ? updated : user)));
  }
}

/** The API's error code: nested under `error` by the exception filter. */
function errorCode(err: HttpErrorResponse): string | undefined {
  const body = err.error as { code?: unknown; error?: { code?: unknown } } | null;
  const code = body?.error?.code ?? body?.code;
  return typeof code === 'string' ? code : undefined;
}

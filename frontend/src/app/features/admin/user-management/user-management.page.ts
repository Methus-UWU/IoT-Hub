import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, pattern, required, submit } from '@angular/forms/signals';

import {
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
  UpdateAdminUserPayload,
} from '../../../core/models/admin.model';
import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { CreateUserDialog } from './create-user-dialog';
import { DeleteUserDialog } from './delete-user-dialog';
import { UserManagementStore } from './user-management.store';

const ROLE_LABELS: Partial<Record<AdminUserRole, string>> = {
  admin: 'ผู้ดูแลระบบ',
  user: 'ผู้ใช้งาน',
  operator: 'ผู้ปฏิบัติงาน',
  viewer: 'ผู้ดูข้อมูล',
};

interface EditAdminUserFormValue {
  username: string;
  role: AdminUserRole;
}

const EMPTY_EDIT_FORM: EditAdminUserFormValue = {
  username: '',
  role: 'user',
};

const STATUS_FILTER_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'active', label: 'ใช้งาน' },
  { value: 'suspended', label: 'ระงับ' },
];

const PAGE_SIZE_OPTIONS: readonly CustomSelectOption[] = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
];

const THAI_DATE_FORMATTER = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
});

const THAI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Bangkok',
});

@Component({
  selector: 'app-user-management-page',
  imports: [FormField, CustomSelect, CreateUserDialog, DeleteUserDialog],
  templateUrl: './user-management.page.html',
  styleUrl: './user-management.page.css',
  host: {
    '(document:keydown.escape)': 'closeEdit()',
  },
})
export class UserManagementPage {
  protected readonly store = inject(UserManagementStore);

  protected readonly editingUser = signal<AdminUser | null>(null);
  protected readonly savingEdit = signal(false);
  protected readonly creatingUser = signal(false);
  protected readonly deletingUser = signal<AdminUser | null>(null);
  protected readonly statusFilterOptions = STATUS_FILTER_OPTIONS;
  protected readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  protected readonly pageSize = signal(10);
  protected readonly currentPage = signal(1);

  protected readonly roleFilterOptions = computed<readonly CustomSelectOption[]>(() => [
    { value: 'all', label: 'ทุกบทบาท' },
    ...this.store.roles().map((role) => ({ value: role, label: this.roleLabel(role) })),
  ]);

  protected readonly editRoleOptions = computed<readonly CustomSelectOption[]>(() =>
    this.store.roles().map((role) => ({ value: role, label: this.roleLabel(role) })),
  );

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.store.filteredUsers().length / this.pageSize())),
  );

  protected readonly displayPage = computed(() => Math.min(this.currentPage(), this.totalPages()));

  protected readonly paginatedUsers = computed(() => {
    const start = (this.displayPage() - 1) * this.pageSize();
    return this.store.filteredUsers().slice(start, start + this.pageSize());
  });

  protected readonly rangeStart = computed(() => {
    if (this.store.filteredUsers().length === 0) return 0;
    return (this.displayPage() - 1) * this.pageSize() + 1;
  });

  protected readonly rangeEnd = computed(() =>
    this.rangeStart() === 0
      ? 0
      : Math.min(
          this.rangeStart() + this.paginatedUsers().length - 1,
          this.store.filteredUsers().length,
        ),
  );

  private readonly editUsernameInput = viewChild<ElementRef<HTMLInputElement>>('editUsernameInput');
  private readonly editModel = signal<EditAdminUserFormValue>({ ...EMPTY_EDIT_FORM });

  protected readonly editForm = form(this.editModel, (path) => {
    required(path.username, { message: 'กรุณากรอกชื่อผู้ใช้งาน' });
    pattern(path.username, /^[a-zA-Z0-9._-]+$/, {
      message: 'ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดล่าง และขีดกลาง',
    });
    required(path.role, { message: 'กรุณาเลือกบทบาท' });
  });

  constructor() {
    this.store.load();
  }

  protected roleLabel(role: AdminUserRole): string {
    return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
  }

  protected formatThaiDate(value: string, includeTime = false): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return (includeTime ? THAI_DATE_TIME_FORMATTER : THAI_DATE_FORMATTER).format(date);
  }

  protected onSearchInput(event: Event): void {
    this.store.setSearch((event.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }

  protected onRoleFilterChange(value: string): void {
    this.store.setRoleFilter(value as AdminUserRole | 'all');
    this.currentPage.set(1);
  }

  protected onStatusFilterChange(value: string): void {
    this.store.setStatusFilter(value as AdminUserStatus | 'all');
    this.currentPage.set(1);
  }

  protected onEditRoleChange(value: string): void {
    this.editModel.update((current) => ({ ...current, role: value as AdminUserRole }));
  }

  protected clearFilters(): void {
    this.store.clearFilters();
    this.currentPage.set(1);
  }

  protected onPageSizeChange(value: string): void {
    const pageSize = Number(value);
    if (PAGE_SIZE_OPTIONS.some((option) => Number(option.value) === pageSize)) {
      this.pageSize.set(pageSize);
      this.currentPage.set(1);
    }
  }

  protected previousPage(): void {
    this.currentPage.set(Math.max(1, this.displayPage() - 1));
  }

  protected nextPage(): void {
    this.currentPage.set(Math.min(this.totalPages(), this.displayPage() + 1));
  }

  protected openEdit(user: AdminUser): void {
    this.editModel.set({ username: user.username, role: user.role });
    this.editForm().reset();
    this.editingUser.set(user);
    window.setTimeout(() => this.editUsernameInput()?.nativeElement.focus());
  }

  protected closeEdit(): void {
    if (!this.savingEdit()) this.editingUser.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const user = this.deletingUser();
    if (user && (await this.store.delete(user.id))) this.deletingUser.set(null);
  }

  protected async saveEdit(): Promise<void> {
    const user = this.editingUser();
    if (!user) {
      return;
    }

    this.savingEdit.set(true);
    try {
      await submit(this.editForm, async () => {
        const { username, role } = this.editModel();
        const payload: UpdateAdminUserPayload = { username, role };
        const updated = await this.store.update(user.id, payload);
        if (updated) {
          this.editingUser.set(null);
        }
        return undefined;
      });
    } finally {
      this.savingEdit.set(false);
    }
  }
}

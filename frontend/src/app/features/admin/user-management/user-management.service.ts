import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
  CreateAdminUserPayload,
  UpdateAdminUserPayload,
} from '../../../core/models/admin.model';
import { CrudService } from '../../../core/services/crud.service';

@Service()
export class UserManagementService {
  private readonly crud = inject(CrudService);
  private readonly users = this.crud.resource<AdminUser, CreateAdminUserPayload>('admin/users');
  private readonly roles = this.crud.resource<AdminUserRole>('admin/users/roles');

  list(): Observable<AdminUser[]> {
    return this.users.list();
  }

  listRoles(): Observable<AdminUserRole[]> {
    return this.roles.list();
  }

  update(id: string, payload: UpdateAdminUserPayload): Observable<AdminUser> {
    return this.users.patch(id, payload);
  }

  create(payload: CreateAdminUserPayload): Observable<AdminUser> {
    return this.users.create(payload);
  }

  delete(id: string): Observable<void> {
    return this.users.delete(id);
  }

  setStatus(id: string, status: AdminUserStatus): Observable<AdminUser> {
    return this.users.patch(id, { status });
  }
}

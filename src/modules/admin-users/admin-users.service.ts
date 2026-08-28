import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { RoleRepository } from '../users/role.repository';
import { AdminUserView, UserRepository } from '../users/user.repository';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  list(): Promise<AdminUserView[]> {
    return this.users.listForAdmin();
  }

  listRoles(): Promise<string[]> {
    return this.roles.listNames();
  }

  async update(
    actingUserId: string,
    id: string,
    body: UpdateAdminUserDto,
  ): Promise<AdminUserView> {
    if (!(await this.users.exists(id))) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // An administrator locking themselves out is unrecoverable without database
    // access, so it is refused rather than merely warned about.
    if (actingUserId === id && body.status === 'suspended') {
      throw new BadRequestException({
        code: 'CANNOT_SUSPEND_SELF',
        message: 'You cannot suspend your own account',
      });
    }

    const username = body.username?.trim();

    if (username) {
      const duplicateId = await this.users.findOtherIdByUsernameOrEmail(id, {
        username,
      });
      if (duplicateId) {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: 'Username already exists',
        });
      }
    }

    if (body.role && !(await this.roles.findByName(body.role))) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found',
      });
    }

    // Ban first. If Supabase rejects it, the profile stays untouched, so a
    // suspension can never be half-applied in the permissive direction.
    if (body.status !== undefined) {
      await this.supabaseAdmin.setBanned(id, body.status === 'suspended');
    }

    return this.users.updateForAdmin(id, {
      username,
      roleName: body.role,
      isActive: body.status ? body.status === 'active' : undefined,
    });
  }
}

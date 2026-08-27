import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { PASSWORD_HASH_ROUNDS } from '../auth/auth.constants';
import { RoleRepository } from '../users/role.repository';
import { AdminUserView, UserRepository } from '../users/user.repository';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  list(): Promise<AdminUserView[]> {
    return this.users.listForAdmin();
  }

  listRoles(): Promise<string[]> {
    return this.roles.listNames();
  }

  async update(id: string, body: UpdateAdminUserDto): Promise<AdminUserView> {
    if (!(await this.users.exists(id))) {
      throw new NotFoundException('User not found');
    }

    const username = body.username?.trim();
    const email = body.email?.trim().toLowerCase();

    if (username || email) {
      const duplicateId = await this.users.findOtherIdByUsernameOrEmail(id, {
        username,
        email,
      });
      if (duplicateId) {
        throw new ConflictException('Username or email already exists');
      }
    }

    if (body.role && !(await this.roles.findByName(body.role))) {
      throw new NotFoundException('Role not found');
    }

    return this.users.updateForAdmin(id, {
      username,
      email,
      roleName: body.role,
      isActive: body.status ? body.status === 'active' : undefined,
      passwordHash: body.password
        ? await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS)
        : undefined,
    });
  }
}

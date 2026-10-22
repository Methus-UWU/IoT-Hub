import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { SignInIpRepository } from '../auth/sign-in-ip.repository';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { RoleRepository } from '../users/role.repository';
import { AdminUserView, UserRepository } from '../users/user.repository';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

export interface AdminUserWithAuthView extends AdminUserView {
  lastLoginAt: string | null;
  /** Address of the last sign-in, from the Supabase session it created. */
  lastLoginIp: string | null;
  lastLoginAvailable: boolean;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly signInIps: SignInIpRepository,
  ) {}

  async list(): Promise<AdminUserWithAuthView[]> {
    const [users, ips] = await Promise.all([
      this.users.listForAdmin(),
      this.signInIps.listLatest().catch((): ReadonlyMap<string, string> => {
        this.logger.warn('Sign-in addresses are unavailable');
        return new Map();
      }),
    ]);

    try {
      const lastSignIns = await this.supabaseAdmin.listUserLastSignIns();
      return users.map((user) => ({
        ...user,
        lastLoginAt: lastSignIns.get(user.id) ?? null,
        lastLoginIp: ips.get(user.id) ?? null,
        lastLoginAvailable: true,
      }));
    } catch {
      this.logger.warn(
        'User activity enrichment is unavailable; returning profile data only',
      );
      return users.map((user) => ({
        ...user,
        lastLoginAt: null,
        lastLoginIp: null,
        lastLoginAvailable: false,
      }));
    }
  }

  listRoles(): Promise<string[]> {
    return this.roles.listNames();
  }

  /**
   * Creates an account in Supabase Auth; the sign-up trigger builds the profile
   * and workspace. Everything checkable is checked first, so a refused request
   * leaves no half-created identity behind.
   */
  async create(body: CreateAdminUserDto): Promise<AdminUserWithAuthView> {
    if (body.role && !(await this.roles.findByName(body.role))) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found',
      });
    }
    if (await this.users.existsByUsername(body.username)) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'Username already exists',
      });
    }
    if (await this.users.existsByEmail(body.email)) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with that email already exists',
      });
    }

    const id = await this.supabaseAdmin.createUser({
      email: body.email,
      password: body.password,
      username: body.username,
    });

    // The trigger always assigns the default role; only a different one needs a
    // second write.
    const user = await this.users.updateForAdmin(id, {
      roleName: body.role,
    });
    return {
      ...user,
      lastLoginAt: null,
      lastLoginIp: null,
      lastLoginAvailable: true,
    };
  }

  /**
   * Deletes the identity. The profile, workspaces, projects, community content,
   * and history follow through database cascades and the workspace succession
   * trigger, so there is nothing to clean up here.
   */
  async delete(actingUserId: string, id: string): Promise<void> {
    if (actingUserId === id) {
      throw new BadRequestException({
        code: 'CANNOT_DELETE_SELF',
        message: 'You cannot delete your own account',
      });
    }
    await this.requireUser(id);
    await this.supabaseAdmin.deleteUser(id);
  }

  private async requireUser(id: string): Promise<void> {
    if (!(await this.users.exists(id))) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
  }

  async update(
    actingUserId: string,
    id: string,
    body: UpdateAdminUserDto,
  ): Promise<AdminUserWithAuthView> {
    await this.requireUser(id);

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

    const user = await this.users.updateForAdmin(id, {
      username,
      roleName: body.role,
      isActive: body.status ? body.status === 'active' : undefined,
    });

    try {
      const [lastLoginAt, lastLoginIp] = await Promise.all([
        this.supabaseAdmin.getUserLastSignIn(id),
        this.signInIps.findLatest(id).catch(() => null),
      ]);
      return { ...user, lastLoginAt, lastLoginIp, lastLoginAvailable: true };
    } catch {
      this.logger.warn(
        `User activity enrichment is unavailable for user ${id}`,
      );
      return {
        ...user,
        lastLoginAt: null,
        lastLoginIp: null,
        lastLoginAvailable: false,
      };
    }
  }
}

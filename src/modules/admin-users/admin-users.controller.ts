import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { AdminUsersService } from './admin-users.service';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

/**
 * Guard order matters: SupabaseAuthGuard establishes identity, PlatformAdminGuard
 * then resolves the platform role from the database.
 */
@Controller('admin/users')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  list() {
    return this.adminUsersService.list();
  }

  @Get('roles')
  listRoles() {
    return this.adminUsersService.listRoles();
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateAdminUserDto,
  ) {
    return this.adminUsersService.update(request.user.id, id, body);
  }
}

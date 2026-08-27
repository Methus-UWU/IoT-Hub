import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import { AdminRoleGuard } from '../../common/guards/admin-role.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminUsersService } from './admin-users.service';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
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
  update(@Param('id') id: string, @Body() body: UpdateAdminUserDto) {
    return this.adminUsersService.update(id, body);
  }
}

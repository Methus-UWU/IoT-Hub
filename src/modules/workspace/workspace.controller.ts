import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/strategies/jwt.strategy';
import {
  SaveWorkspaceFileDto,
  WorkspaceFilePathDto,
} from './dto/workspace.dto';
import { WorkspaceFirmwareService } from './workspace-firmware.service';
import { WorkspaceService } from './workspace.service';

type AuthenticatedRequest = Request & { user: AccessTokenPayload };

/**
 * Every route requires a valid access token. Files are additionally scoped to the
 * authenticated user id, which is the current ownership boundary until the
 * workspace membership model lands.
 */
@Controller('projects/:projectId/workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly firmware: WorkspaceFirmwareService,
  ) {}

  @Get('files')
  listFiles(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ) {
    return this.workspace.listFiles(request.user.sub, projectId);
  }

  @Get('file')
  readFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: WorkspaceFilePathDto,
  ) {
    return this.workspace.readFile(request.user.sub, projectId, query.path);
  }

  @Put('file')
  saveFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: SaveWorkspaceFileDto,
  ) {
    return this.workspace.saveFile(
      request.user.sub,
      projectId,
      body.path,
      body.content,
    );
  }

  @Delete('file')
  deleteFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: WorkspaceFilePathDto,
  ) {
    return this.workspace.deleteFile(request.user.sub, projectId, query.path);
  }

  @Get('toolchain')
  toolchainStatus() {
    return this.firmware.toolchainStatus();
  }

  @Throttle(THROTTLE_OVERRIDES.build)
  @Post('build')
  build() {
    return this.firmware.build();
  }

  @Get('devices')
  listDevices() {
    return this.firmware.listDevices();
  }

  @Throttle(THROTTLE_OVERRIDES.build)
  @Post('serial/start')
  startSerialMonitor() {
    return this.firmware.startMonitor();
  }

  @Get('serial/output')
  serialOutput() {
    return this.firmware.monitorOutput();
  }

  @Post('serial/stop')
  stopSerialMonitor() {
    return this.firmware.stopMonitor();
  }
}

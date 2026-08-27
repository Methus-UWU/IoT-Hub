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
import type { Request } from 'express';

import type { AccessTokenPayload } from '../auth/strategies/jwt.strategy';
import {
  BuildWorkspaceDto,
  SaveWorkspaceFileDto,
  SerialMonitorDto,
  SerialOutputDto,
  WorkspaceFilePathDto,
} from './dto/workspace.dto';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspaceBuildService } from './workspace-build.service';
import { WorkspaceDeviceService } from './workspace-device.service';
import { WorkspaceService } from './workspace.service';

type AuthenticatedRequest = Request & { user: AccessTokenPayload };

@Controller('projects/:projectId/workspace')
@UseGuards(WorkspaceAccessGuard)
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly builds: WorkspaceBuildService,
    private readonly devices: WorkspaceDeviceService,
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
    return this.builds.toolchainStatus();
  }

  @Post('build')
  build(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: BuildWorkspaceDto,
  ) {
    return this.builds.run(request.user.sub, projectId, body.target, body.port);
  }

  @Get('devices')
  listDevices() {
    return this.devices.listDevices();
  }

  @Post('serial/start')
  startSerialMonitor(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: SerialMonitorDto,
  ) {
    return this.devices.startMonitor(
      request.user.sub,
      projectId,
      body.port,
      body.baud,
    );
  }

  @Get('serial/output')
  serialOutput(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: SerialOutputDto,
  ) {
    return this.devices.monitorOutput(
      request.user.sub,
      projectId,
      query.cursor,
    );
  }

  @Post('serial/stop')
  stopSerialMonitor(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ) {
    return this.devices.stopMonitor(request.user.sub, projectId);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { ProjectsService } from '../projects/projects.service';
import type { WorkspaceRole } from '../workspaces/workspace-role';
import { DeviceTokenGuard, type DeviceRequest } from './device-token.guard';
import { DevicesService } from './devices.service';
import {
  ControlValueDto,
  DATASTREAM_KEY_PARAM,
  DeviceNameDto,
  SeriesQueryDto,
  TelemetryReportDto,
} from './dto/device.dto';
import { TelemetryService } from './telemetry.service';

/**
 * A project's devices, their latest values, their history, and dashboard controls.
 * Same two-step authorization as every project route.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/devices')
@UseGuards(SupabaseAuthGuard)
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly telemetry: TelemetryService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.devices.list(projectId);
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: DeviceNameDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.devices.create(projectId, body.name, request.user.id);
  }

  @Patch(':deviceId')
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() body: DeviceNameDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.devices.rename(projectId, deviceId, body.name);
  }

  /** Issues a new token; the old one stops working at once. */
  @Post(':deviceId/token')
  async rotateToken(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.devices.rotateToken(projectId, deviceId);
  }

  @Delete(':deviceId')
  @HttpCode(204)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    await this.devices.delete(projectId, deviceId);
  }

  @Get(':deviceId/values')
  async values(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.telemetry.snapshot(projectId, deviceId);
  }

  @Get(':deviceId/series')
  async series(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query() query: SeriesQueryDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.telemetry.series(projectId, deviceId, query.key, query.range);
  }

  /** A dashboard control (switch, slider, button) sets a value for the device. */
  @Put(':deviceId/values/:key')
  async setControl(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('key') key: string,
    @Body() body: ControlValueDto,
  ) {
    if (!DATASTREAM_KEY_PARAM.test(key)) {
      throw new BadRequestException({
        code: 'INVALID_DATASTREAM_KEY',
        message: 'key is not a datastream key',
      });
    }
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.telemetry.setControl(projectId, deviceId, key, body.value);
  }

  private async authorize(
    request: AuthenticatedRequest,
    workspaceId: string,
    projectId: string,
    required: WorkspaceRole,
  ): Promise<void> {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      required,
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
  }
}

/**
 * The board-facing API. A device token, not a user session, authenticates it; each
 * token reaches only its own device.
 */
@Controller('device/v1')
@UseGuards(DeviceTokenGuard)
@Throttle(THROTTLE_OVERRIDES.deviceApi)
export class DeviceApiController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(200)
  report(@Req() request: DeviceRequest, @Body() body: TelemetryReportDto) {
    return this.telemetry.report(request.device, body.values);
  }

  @Get('controls')
  controls(@Req() request: DeviceRequest) {
    return this.telemetry.controls(request.device);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/supabase-auth.guard';
import { AuthorizationService } from '../../authorization/authorization.service';
import { ProjectsService } from '../../projects/projects.service';
import { AiConversationsService } from './ai-conversations.service';
import { AiProfilesService } from './ai-profiles.service';
import {
  CreateAiProfileDto,
  CreateConversationDto,
  ImportConversationDto,
  PlanStateDto,
  UpdateAiProfileDto,
  UpdateConversationDto,
} from './dto/ai-conversation.dto';

/** The caller's AI profiles and the system ones. Any signed-in user. */
@Controller('ai/profiles')
@UseGuards(SupabaseAuthGuard)
export class AiProfilesController {
  constructor(private readonly profiles: AiProfilesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.profiles.list(request.user.id);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAiProfileDto,
  ) {
    return this.profiles.create(
      request.user.id,
      {
        name: body.name,
        description: body.description ?? '',
        model: body.model ?? null,
        tier: body.tier ?? 'auto',
        instructions: body.instructions ?? '',
      },
      body.scope ?? 'personal',
    );
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAiProfileDto,
  ) {
    return this.profiles.update(request.user.id, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.tier !== undefined ? { tier: body.tier } : {}),
      ...(body.instructions !== undefined
        ? { instructions: body.instructions }
        : {}),
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.profiles.delete(request.user.id, id);
  }
}

/**
 * A user's own conversations with one project's assistant. `viewer` is enough: a
 * conversation writes nothing to the project, and it is private to its author.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/ai/conversations')
@UseGuards(SupabaseAuthGuard)
export class AiConversationsController {
  constructor(
    private readonly conversations: AiConversationsService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId);
    return this.conversations.list(request.user.id, projectId);
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateConversationDto,
  ) {
    await this.authorize(request, workspaceId, projectId);
    return this.conversations.create(
      request.user.id,
      projectId,
      body.profileId ?? null,
    );
  }

  /** Moves a conversation the browser kept before ADR-007 into this project. */
  @Post('import')
  async importConversation(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ImportConversationDto,
  ) {
    await this.authorize(request, workspaceId, projectId);
    return this.conversations.importConversation(
      request.user.id,
      projectId,
      body.title,
      body.messages,
    );
  }

  @Get(':conversationId')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    await this.authorize(request, workspaceId, projectId);
    return this.conversations.get(request.user.id, projectId, conversationId);
  }

  @Patch(':conversationId')
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: UpdateConversationDto,
  ) {
    await this.authorize(request, workspaceId, projectId);
    return this.conversations.update(
      request.user.id,
      projectId,
      conversationId,
      {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
      },
    );
  }

  @Delete(':conversationId')
  @HttpCode(204)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    await this.authorize(request, workspaceId, projectId);
    await this.conversations.delete(request.user.id, projectId, conversationId);
  }

  @Patch(':conversationId/messages/:messageId')
  @HttpCode(204)
  async setPlanState(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: PlanStateDto,
  ) {
    await this.authorize(request, workspaceId, projectId);
    await this.conversations.setPlanState(
      request.user.id,
      projectId,
      conversationId,
      messageId,
      body.planState,
      body.planError ?? null,
    );
  }

  private async authorize(
    request: AuthenticatedRequest,
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
  }
}

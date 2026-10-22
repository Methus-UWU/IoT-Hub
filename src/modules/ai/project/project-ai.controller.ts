import {
  Body,
  Controller,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { THROTTLE_OVERRIDES } from '../../../common/config/security.config';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/supabase-auth.guard';
import { AuthorizationService } from '../../authorization/authorization.service';
import { ProjectsService } from '../../projects/projects.service';
import { AiPlanApplyService } from './ai-plan-apply.service';
import { ApplyPlanDto, ProjectChatDto } from './dto/project-ai.dto';
import { ProjectChatTurnsService } from '../conversations/project-chat-turns.service';

/**
 * The assistant, scoped to one project.
 *
 * The route carries the scope, and both halves of it are proved before anything runs:
 *
 *   1. `requireWorkspaceRole` — may this user act in this workspace, at this level?
 *   2. `requireInWorkspace`   — does this project actually live in that workspace?
 *
 * That is the same pair every project route uses, and it is what makes it structurally
 * impossible for the assistant to read another project's devices: the project row it works
 * from is the one these two checks returned, and no tool takes a project id.
 *
 * Asking needs `viewer`, because a conversation writes nothing. Applying needs `editor`,
 * the same level as drawing the wire by hand — accepting a proposal is a normal edit and
 * is authorized as one.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/ai')
@UseGuards(SupabaseAuthGuard)
export class ProjectAiController {
  private readonly logger = new Logger(ProjectAiController.name);

  constructor(
    private readonly turns: ProjectChatTurnsService,
    private readonly plans: AiPlanApplyService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Throttle(THROTTLE_OVERRIDES.ai)
  @Post('chat')
  async chat(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ProjectChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      projectId,
    );

    // A user who closes the tab should not leave a paid upstream request running.
    const controller = new AbortController();
    const cancel = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', cancel);

    try {
      return await this.turns.run(
        request.user.id,
        project,
        body,
        controller.signal,
      );
    } finally {
      response.off('close', cancel);
    }
  }

  /**
   * The same turn as `chat`, streamed as newline-delimited JSON.
   *
   * Each line is `{ "type": "progress", "stage", "detail", "status" }` while the assistant works,
   * then exactly one `{ "type": "result", "result" }` or `{ "type": "error", "error" }`.
   * Authorization runs before the stream opens, so a refusal is still an ordinary HTTP
   * error; once the stream is open a failure can only be reported as a line.
   */
  @Throttle(THROTTLE_OVERRIDES.ai)
  @Post('chat/stream')
  async chatStream(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ProjectChatDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      projectId,
    );

    const controller = new AbortController();
    const cancel = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', cancel);

    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    // Stops a buffering proxy from holding progress lines until the turn ends.
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const send = (line: object) => {
      if (!response.writableEnded)
        response.write(`${JSON.stringify(line)}
`);
    };

    try {
      const result = await this.turns.run(
        request.user.id,
        project,
        body,
        controller.signal,
        (event) => send({ type: 'progress', ...event }),
      );
      send({ type: 'result', result });
    } catch (error) {
      send({ type: 'error', error: streamError(error) });
      if (!(error instanceof HttpException)) {
        this.logger.error(
          'Streamed AI turn failed',
          error instanceof Error ? error.stack : String(error),
        );
      }
    } finally {
      response.off('close', cancel);
      response.end();
    }
  }

  @Throttle(THROTTLE_OVERRIDES.ai)
  @Post('apply')
  async apply(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ApplyPlanDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      projectId,
    );

    return this.plans.apply(request.user.id, project, body.actions);
  }
}

/**
 * The error line of a stream. An HttpException carries a message written for the
 * user; anything else is internal and is reported generically, as the global filter
 * would.
 */
function streamError(error: unknown): { code: string; message: string } {
  if (error instanceof HttpException) {
    const payload = error.getResponse();
    const record =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return {
      code: typeof record['code'] === 'string' ? record['code'] : 'AI_ERROR',
      message:
        typeof record['message'] === 'string'
          ? record['message']
          : error.message,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'AI ทำงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  };
}

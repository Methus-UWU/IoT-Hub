import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import {
  type MaybeAuthenticatedRequest,
  OptionalSupabaseAuthGuard,
} from '../auth/optional-supabase-auth.guard';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { CommunityCommentsService } from './community-comments.service';
import { CommunityVotesService } from './community-votes.service';
import {
  CommunityVoteDto,
  CreateCommunityCommentDto,
  UpdateCommunityCommentDto,
} from './dto/community.dto';

/** Answers and replies. Same read/write split as the posts controller. */
@Controller('community')
export class CommunityCommentsController {
  constructor(
    private readonly comments: CommunityCommentsService,
    private readonly votes: CommunityVotesService,
  ) {}

  @Get('posts/:postId/comments')
  @UseGuards(OptionalSupabaseAuthGuard)
  async list(
    @Req() request: MaybeAuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    return {
      data: await this.comments.listForPost(postId, request.user?.id ?? null),
    };
  }

  @Post('posts/:postId/comments')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() body: CreateCommunityCommentDto,
  ) {
    return {
      data: await this.comments.create(
        request.user.id,
        postId,
        body.body,
        body.parentId ?? null,
      ),
    };
  }

  @Patch('comments/:commentId')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: UpdateCommunityCommentDto,
  ) {
    return {
      data: await this.comments.update(request.user.id, commentId, body.body),
    };
  }

  @Delete('comments/:commentId')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.comments.remove(request.user.id, commentId);
    return { data: { deleted: true } };
  }

  @Post('comments/:commentId/accept')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async accept(
    @Req() request: AuthenticatedRequest,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return {
      data: await this.comments.setAccepted(request.user.id, commentId),
    };
  }

  @Post('comments/:commentId/vote')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async vote(
    @Req() request: AuthenticatedRequest,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: CommunityVoteDto,
  ) {
    return {
      data: await this.votes.voteComment(
        request.user.id,
        commentId,
        body.value,
      ),
    };
  }
}

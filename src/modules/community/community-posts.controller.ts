import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CommunityPostsService } from './community-posts.service';
import { CommunityVotesService } from './community-votes.service';
import {
  CommunityVoteDto,
  CreateCommunityPostDto,
  ListCommunityPostsDto,
  UpdateCommunityPostDto,
} from './dto/community.dto';

/**
 * The community feed.
 *
 * Reads are open to anonymous visitors — a question nobody can read before
 * signing up is not a community — and every write requires an account. The two
 * therefore carry different guards per handler rather than one on the class:
 * `OptionalSupabaseAuthGuard` establishes identity when the caller offers it, so
 * a reader sees how they voted, while `SupabaseAuthGuard` refuses anonymous writes.
 *
 * Ownership is checked in the service, which is also what a moderator's delete
 * has to pass through.
 */
@Controller('community')
export class CommunityPostsController {
  constructor(
    private readonly posts: CommunityPostsService,
    private readonly votes: CommunityVotesService,
  ) {}

  @Get('tags')
  async listTags() {
    return { data: await this.posts.listTags() };
  }

  @Get('posts')
  @UseGuards(OptionalSupabaseAuthGuard)
  list(
    @Req() request: MaybeAuthenticatedRequest,
    @Query() query: ListCommunityPostsDto,
  ) {
    return this.posts.list(query, request.user?.id ?? null);
  }

  @Get('posts/:slug')
  @UseGuards(OptionalSupabaseAuthGuard)
  async getBySlug(
    @Req() request: MaybeAuthenticatedRequest,
    @Param('slug') slug: string,
  ) {
    return {
      data: await this.posts.getBySlug(slug, request.user?.id ?? null),
    };
  }

  @Post('posts')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateCommunityPostDto,
  ) {
    return { data: await this.posts.create(request.user.id, body) };
  }

  @Patch('posts/:postId')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() body: UpdateCommunityPostDto,
  ) {
    return { data: await this.posts.update(request.user.id, postId, body) };
  }

  @Delete('posts/:postId')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.posts.remove(request.user.id, postId);
    return { data: { deleted: true } };
  }

  @Post('posts/:postId/vote')
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  async vote(
    @Req() request: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() body: CommunityVoteDto,
  ) {
    return {
      data: await this.votes.votePost(request.user.id, postId, body.value),
    };
  }
}

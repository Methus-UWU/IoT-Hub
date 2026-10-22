import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import {
  CommunityCommentRepository,
  CommunityPostRepository,
  CommunityTagRepository,
  CommunityVoteRepository,
} from './community.repository';
import { CommunityCommentsController } from './community-comments.controller';
import { CommunityCommentsService } from './community-comments.service';
import { CommunityPostsController } from './community-posts.controller';
import { CommunityPostsService } from './community-posts.service';
import { CommunityVotesService } from './community-votes.service';
import {
  PrismaCommunityCommentRepository,
  PrismaCommunityPostRepository,
  PrismaCommunityTagRepository,
  PrismaCommunityVoteRepository,
} from './prisma-community.repository';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [CommunityPostsController, CommunityCommentsController],
  providers: [
    CommunityPostsService,
    CommunityCommentsService,
    CommunityVotesService,
    {
      provide: CommunityPostRepository,
      useClass: PrismaCommunityPostRepository,
    },
    {
      provide: CommunityCommentRepository,
      useClass: PrismaCommunityCommentRepository,
    },
    { provide: CommunityTagRepository, useClass: PrismaCommunityTagRepository },
    {
      provide: CommunityVoteRepository,
      useClass: PrismaCommunityVoteRepository,
    },
  ],
  exports: [CommunityPostsService, CommunityCommentsService],
})
export class CommunityModule {}

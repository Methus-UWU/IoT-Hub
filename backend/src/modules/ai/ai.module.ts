import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { IotAdvisorController } from './advisor/iot-advisor.controller';
import { IotAdvisorService } from './advisor/iot-advisor.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiPlanApplyService } from './project/ai-plan-apply.service';
import { ProjectAiController } from './project/project-ai.controller';
import { ProjectAiService } from './project/project-ai.service';
import { ProjectContextService } from './project/project-context.service';
import { GeminiProvider } from './providers/gemini.provider';
import { ModelCatalogService } from './providers/model-catalog.service';
import { ModelSelectorService } from './providers/model-selector.service';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { SystemContextService } from './system-context.service';
import { AiCreditsModule } from '../ai-credits/ai-credits.module';
import {
  AdminAiSettingsController,
  AiCreditsController,
} from './credits/ai-settings.controller';
import {
  AiConversationRepository,
  AiProfileRepository,
} from './conversations/ai-conversation.repository';
import {
  AiConversationsController,
  AiProfilesController,
} from './conversations/ai-conversations.controller';
import { AiConversationsService } from './conversations/ai-conversations.service';
import { AiProfilesService } from './conversations/ai-profiles.service';
import {
  PrismaAiConversationRepository,
  PrismaAiProfileRepository,
} from './conversations/prisma-ai-conversation.repository';
import { ProjectChatTurnsService } from './conversations/project-chat-turns.service';

/**
 * Three assistants share one provider stack.
 *
 * The admin assistant analyses the platform; the project assistant works inside one user's
 * project; the advisor answers general IoT questions and error logs for any signed-in user.
 * They differ in scope and authority, not in plumbing, so the catalog, the model ranker,
 * and the OpenRouter adapter are registered once and all of them use them. The advisor
 * alone answers through Gemini first, falling back to that shared OpenRouter path.
 *
 * `ProjectsModule` is imported rather than reimplemented: the project assistant creates
 * components and wires through the same services the canvas uses, which is what keeps
 * entitlements, ownership checks, and quotas on one path instead of two.
 */
@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    UsersModule,
    ProjectsModule,
    DashboardsModule,
    AiCreditsModule,
  ],
  controllers: [
    AiController,
    ProjectAiController,
    IotAdvisorController,
    AiProfilesController,
    AiConversationsController,
    AdminAiSettingsController,
    AiCreditsController,
  ],
  providers: [
    AiService,
    IotAdvisorService,
    SystemContextService,
    ProjectAiService,
    ProjectContextService,
    AiPlanApplyService,
    ModelCatalogService,
    ModelSelectorService,
    OpenRouterProvider,
    GeminiProvider,
    AiProfilesService,
    AiConversationsService,
    ProjectChatTurnsService,
    { provide: AiProfileRepository, useClass: PrismaAiProfileRepository },
    {
      provide: AiConversationRepository,
      useClass: PrismaAiConversationRepository,
    },
  ],
})
export class AiModule {}

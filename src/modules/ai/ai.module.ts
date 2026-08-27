import { Module } from '@nestjs/common';

import { AdminRoleGuard } from '../../common/guards/admin-role.guard';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import {
  AnthropicProvider,
  DeepSeekProvider,
  GemmaProvider,
  GeminiProvider,
  MetaProvider,
  NvidiaProvider,
  OpenAiProvider,
} from './providers/ai-provider.adapters';
import { SystemContextService } from './system-context.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AiController],
  providers: [
    AiService,
    SystemContextService,
    AdminRoleGuard,
    OpenAiProvider,
    AnthropicProvider,
    GeminiProvider,
    GemmaProvider,
    DeepSeekProvider,
    MetaProvider,
    NvidiaProvider,
  ],
})
export class AiModule {}

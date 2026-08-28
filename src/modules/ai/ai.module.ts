import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
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
  imports: [AuthModule, AuthorizationModule, UsersModule],
  controllers: [AiController],
  providers: [
    AiService,
    SystemContextService,
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

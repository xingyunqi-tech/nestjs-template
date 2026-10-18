import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import aiConfig from './config/ai.config';
import { RelationalAiPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { AiRealtimeStore } from './infrastructure/realtime/ai-realtime.store';
import { RedisAiRealtimeStore } from './infrastructure/realtime/redis-ai-realtime.store';
import { MemoryAiRealtimeStore } from './infrastructure/realtime/memory-ai-realtime.store';
import { AiQuotaService } from './ai-quota.service';
import { AiBudgetService } from './ai-budget.service';
import { AiContentSafetyService } from './ai-content-safety.service';
import { AiAccessService } from './ai-access.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiContextService } from './ai-context.service';
import { AiGenerationService } from './ai-generation.service';
import { AiConversationsService } from './ai-conversations.service';
import { AiChatService } from './ai-chat.service';
import { AiSseResponder } from './ai-sse.responder';
import { AiController } from './ai.controller';
import { AdminAiController } from './admin-ai.controller';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiStaleMessageTask } from './ai-stale-message.task';
import { AiMessageFeedbackService } from './ai-message-feedback.service';
import { AiUsageService } from './ai-usage.service';
import { AiAccountCleaner } from './ai-account.cleaner';
import { LlmModule } from '../../integrations/llm/llm.module';
import { WechatModule } from '../../integrations/wechat/wechat.module';
import { UsersModule } from '../../core/users/users.module';
import { ConsentsModule } from '../consents/consents.module';
import { AppConfigModule } from '../config/config.module';
import { PracticeModule } from '../practice/practice.module';
import { FeedbacksModule } from '../feedbacks/feedbacks.module';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { AllConfigType } from '../../config/config.type';

@Module({
  imports: [
    ConfigModule.forFeature(aiConfig),
    RelationalAiPersistenceModule,
    LlmModule,
    WechatModule,
    UsersModule,
    ConsentsModule,
    AppConfigModule,
    PracticeModule,
    FeedbacksModule,
    SchedulerModule,
  ],
  controllers: [AiController, AdminAiController],
  providers: [
    {
      provide: AiRealtimeStore,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AllConfigType>): AiRealtimeStore =>
        configService.get('redis.enabled', { infer: true })
          ? new RedisAiRealtimeStore({
              host: configService.get('redis.host', { infer: true }),
              port: configService.get('redis.port', { infer: true }),
              password: configService.get('redis.password', { infer: true }),
              db: configService.get('redis.db', { infer: true }),
            })
          : new MemoryAiRealtimeStore(),
    },
    AiQuotaService,
    AiBudgetService,
    AiContentSafetyService,
    AiAccessService,
    AiMessageStreamService,
    AiContextService,
    AiGenerationService,
    AiConversationsService,
    AiChatService,
    AiSseResponder,
    AiRateLimitService,
    AiStaleMessageTask,
    AiMessageFeedbackService,
    AiUsageService,
    AiAccountCleaner,
  ],
})
export class AiModule {}

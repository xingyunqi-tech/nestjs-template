import { Module } from '@nestjs/common';
import { UsersModule } from './core/users/users.module';
import { FilesModule } from './modules/files/files.module';
import { AuthModule } from './core/auth/auth.module';
import databaseConfig from './infrastructure/database/config/database.config';
import authConfig from './core/auth/config/auth.config';
import appConfig from './config/app.config';
import mailConfig from './integrations/mail/config/mail.config';
import fileConfig from './modules/files/config/file.config';
import loggerConfig from './infrastructure/logger/config/logger.config';
import redisConfig, { isRedisEnabled } from './infrastructure/redis/config/redis.config';
import throttlerConfig from './infrastructure/throttler/config/throttler.config';
import metricsConfig from './infrastructure/metrics/config/metrics.config';
import smsConfig from './integrations/sms/config/sms.config';
import wechatConfig from './integrations/wechat/config/wechat.config';
import alipayConfig from './integrations/alipay/config/alipay.config';
import llmConfig from './integrations/llm/config/llm.config';
import aliyunGreenConfig from './integrations/aliyun-green/config/aliyun-green.config';
import aiConfig from './modules/ai/config/ai.config';
import gameAuthConfig from './modules/game-auth/config/game-auth.config';
import path from 'path';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceFactory } from './infrastructure/database/data-source.factory';
import { HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TypeOrmConfigService } from './infrastructure/database/typeorm-config.service';
import { MailModule } from './integrations/mail/mail.module';
import { HomeModule } from './modules/home/home.module';
import { AllConfigType } from './config/config.type';
import { SessionModule } from './core/session/session.module';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './infrastructure/health/health.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { ThrottlerModule } from './infrastructure/throttler/throttler.module';
import { MetricsModule } from './infrastructure/metrics/metrics.module';
import { SmsModule } from './integrations/sms/sms.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { RegionsModule } from './modules/regions/regions.module';
import { FavoritesApiModule } from './modules/favorites/favorites-api.module';
import { FeedbacksModule } from './modules/feedbacks/feedbacks.module';
import { PermissionsModule } from './core/permissions/permissions.module';
import { AuditModule } from './infrastructure/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationQueueModule } from './infrastructure/queue/notification-queue/notification-queue.module';
import { WechatModule } from './integrations/wechat/wechat.module';
import { AlipayModule } from './integrations/alipay/alipay.module';
import { SharesModule } from './modules/shares/shares.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SchedulerModule } from './infrastructure/scheduler/scheduler.module';
import { AppConfigModule } from './modules/config/config.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { ExamsModule } from './modules/exams/exams.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { PapersModule } from './modules/papers/papers.module';
import { ImportsModule } from './modules/imports/imports.module';
import { PracticeModule } from './modules/practice/practice.module';
import { ImportQueueModule } from './infrastructure/queue/import-queue/import-queue.module';
import { MockSubmitQueueModule } from './infrastructure/queue/mock-submit-queue/mock-submit-queue.module';
import { StudyStatsModule } from './modules/study-stats/study-stats.module';
import { WrongBookApiModule } from './modules/wrong-book/wrong-book-api.module';
import { StudyStatsApiModule } from './modules/study-stats/study-stats-api.module';
import { QuestionNotesApiModule } from './modules/question-notes/question-notes-api.module';
import { StudyStatsQueueModule } from './infrastructure/queue/study-stats-queue/study-stats-queue.module';
import { ErrataModule } from './modules/errata/errata.module';
import { QuestionReportsApiModule } from './modules/feedbacks/question-reports-api.module';
import { ErrataQueueModule } from './infrastructure/queue/errata-queue/errata-queue.module';
import { ConsentsModule } from './modules/consents/consents.module';
import { AccountCleanupModule } from './modules/account-cleanup/account-cleanup.module';
import { AccountCleanupQueueModule } from './infrastructure/queue/account-cleanup-queue/account-cleanup-queue.module';
import { AiModule } from './modules/ai/ai.module';
import { AppProfileModule } from './modules/app-profile/app-profile.module';
import { GameAuthModule } from './modules/game-auth/game-auth.module';

const infrastructureDatabaseModule = TypeOrmModule.forRootAsync({
  useClass: TypeOrmConfigService,
  dataSourceFactory,
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        appConfig,
        mailConfig,
        fileConfig,
        loggerConfig,
        redisConfig,
        throttlerConfig,
        metricsConfig,
        smsConfig,
        wechatConfig,
        alipayConfig,
        llmConfig,
        aliyunGreenConfig,
        aiConfig,
        gameAuthConfig,
      ],
      envFilePath: ['.env'],
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AllConfigType>) => {
        const logLevel = configService.get('logger.level', { infer: true });
        const prettyPrint = configService.get('logger.prettyPrint', {
          infer: true,
        });

        return {
          pinoHttp: {
            level: logLevel,
            transport: prettyPrint
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:standard',
                  },
                }
              : undefined,
            autoLogging: true,
            genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.oldPassword',
                'req.body.newPassword',
                'req.body.code',
                'req.body.phone',
                'req.body.email',
                'req.query.hash',
                'req.query.token',
              ],
              censor: '[REDACTED]',
            },
            customProps: () => ({
              context: 'HTTP',
            }),
            customLogLevel: (_req, res, err) => {
              if (res.statusCode >= 500 || err) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            customSuccessMessage: (req, res) => {
              return `${req.method} ${req.url} ${res.statusCode}`;
            },
            customErrorMessage: (req, res, err) => {
              return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
            },
          },
        };
      },
    }),
    infrastructureDatabaseModule,
    I18nModule.forRootAsync({
      useFactory: (configService: ConfigService<AllConfigType>) => ({
        fallbackLanguage: configService.getOrThrow('app.fallbackLanguage', {
          infer: true,
        }),
        loaderOptions: {
          path: path.join(__dirname, '/i18n/'),
          watch: configService.get('app.nodeEnv', { infer: true }) !== 'production',
        },
      }),
      resolvers: [
        {
          use: HeaderResolver,
          useFactory: (configService: ConfigService<AllConfigType>) => {
            return [
              configService.get('app.headerLanguage', {
                infer: true,
              }),
            ];
          },
          inject: [ConfigService],
        },
      ],
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
    UsersModule,
    FilesModule,
    AuthModule,
    SessionModule,
    MailModule,
    HomeModule,
    CacheModule,
    RedisModule,
    HealthModule,
    ConditionalModule.registerWhen(QueueModule, isRedisEnabled),
    ThrottlerModule,
    MetricsModule.forRoot(),
    SmsModule,
    AddressesModule,
    RegionsModule,
    FavoritesApiModule,
    FeedbacksModule,
    PermissionsModule,
    WechatModule,
    AlipayModule,
    AuditModule,
    OrdersModule,
    PaymentsModule,
    SchedulerModule,
    NotificationsModule,
    ConditionalModule.registerWhen(NotificationQueueModule, isRedisEnabled),
    SharesModule,
    AppConfigModule,
    MonitorModule,
    ExamsModule,
    QuestionsModule,
    PapersModule,
    ImportsModule,
    PracticeModule,
    StudyStatsModule,
    WrongBookApiModule,
    StudyStatsApiModule,
    QuestionNotesApiModule,
    ErrataModule,
    QuestionReportsApiModule,
    ConsentsModule,
    AccountCleanupModule,
    AiModule,
    AppProfileModule,
    GameAuthModule,
    ConditionalModule.registerWhen(ImportQueueModule, isRedisEnabled),
    ConditionalModule.registerWhen(MockSubmitQueueModule, isRedisEnabled),
    ConditionalModule.registerWhen(StudyStatsQueueModule, isRedisEnabled),
    ConditionalModule.registerWhen(ErrataQueueModule, isRedisEnabled),
    ConditionalModule.registerWhen(AccountCleanupQueueModule, isRedisEnabled),
  ],
})
export class AppModule {}

import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { UserThrottlerGuard } from './user-throttler.guard';

@Module({
  imports: [ConfigModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
class ThrottlerStorageModule {}

@Global()
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule, ThrottlerStorageModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (configService: ConfigService<AllConfigType>, storage: RedisThrottlerStorage) => {
        const enabled = configService.get('throttler.enabled', { infer: true });
        const ttl = configService.get('throttler.ttl', { infer: true }) ?? 60000;
        const limit = configService.get('throttler.limit', { infer: true }) ?? 10;

        if (!enabled) {
          return {
            throttlers: [{ ttl: 0, limit: 0 }],
            skipIf: () => true,
          };
        }

        return {
          throttlers: [
            {
              name: 'default',
              ttl,
              limit,
            },
          ],
          storage,
        };
      },
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class ThrottlerModule {}

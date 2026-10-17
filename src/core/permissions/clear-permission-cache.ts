import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import redisConfig from '../../infrastructure/redis/config/redis.config';
import { CacheModule } from '../../infrastructure/cache/cache.module';
import { ROLE_PERMISSIONS_CACHE_KEY } from './permissions.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [redisConfig], envFilePath: ['.env'] }), CacheModule],
})
class ClearPermissionCacheModule {}

/** 发布时在执行 migration 后运行，使新的角色权限立即生效 */
const clearPermissionCache = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(ClearPermissionCacheModule);
  await app.get<Cache>(CACHE_MANAGER).del(ROLE_PERMISSIONS_CACHE_KEY);
  await app.close();
};

void clearPermissionCache();

import { registerAs } from '@nestjs/config';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RedisConfig } from './redis-config.type';
import validateConfig from '../../../common/validate-config';
import { Transform } from 'class-transformer';

class EnvironmentVariablesValidator {
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  REDIS_ENABLED: boolean;

  @IsString()
  @IsOptional()
  REDIS_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  REDIS_PORT: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string;

  @IsInt()
  @Min(0)
  @Max(15)
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  REDIS_DB: number;
}

/** 是否启用 Redis，供配置加载前就需要判断的模块注册使用 */
export const isRedisEnabled = (env: NodeJS.ProcessEnv): boolean => env.REDIS_ENABLED === 'true';

export function assertRedisEnabledInProduction(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && !isRedisEnabled(env)) {
    throw new Error('REDIS_ENABLED=true is required when NODE_ENV=production');
  }
}

export default registerAs<RedisConfig>('redis', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);
  assertRedisEnabledInProduction(process.env);

  return {
    enabled: isRedisEnabled(process.env),
    host: process.env.REDIS_HOST ?? 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : 0,
  };
});

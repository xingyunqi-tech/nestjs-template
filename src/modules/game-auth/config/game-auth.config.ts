import { registerAs } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import ms from 'ms';
import validateConfig from '../../../common/validate-config';
import { GameAuthConfig } from './game-auth-config.type';

const PRODUCTION_SECRET_MIN_LENGTH = 32;

const SECRET_NAMES = ['GAME_AUTH_JWT_SECRET', 'GAME_AUTH_REFRESH_SECRET'] as const;

/** 生产环境已配置的密钥需足够长，且不能与用户端 JWT 密钥相同 */
function validateProductionSecrets(): void {
  const secrets = SECRET_NAMES.map((name) => process.env[name]).filter(Boolean);
  if (secrets.length === 0) return;
  if (secrets.length !== SECRET_NAMES.length) {
    throw new Error(`${SECRET_NAMES.join(', ')} must be set together`);
  }
  const short = SECRET_NAMES.filter((name) => (process.env[name] ?? '').length < PRODUCTION_SECRET_MIN_LENGTH);
  if (short.length > 0) {
    throw new Error(`${short.join(', ')} must be at least ${PRODUCTION_SECRET_MIN_LENGTH} characters in production`);
  }
  const all = [...secrets, process.env.AUTH_JWT_SECRET, process.env.AUTH_REFRESH_SECRET];
  if (new Set(all).size !== all.length) {
    throw new Error(`${SECRET_NAMES.join(', ')} must differ from each other and from AUTH_* secrets in production`);
  }
}

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  GAME_AUTH_JWT_SECRET: string;

  @IsString()
  @IsOptional()
  GAME_AUTH_JWT_TOKEN_EXPIRES_IN: string;

  @IsString()
  @IsOptional()
  GAME_AUTH_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  GAME_AUTH_REFRESH_TOKEN_EXPIRES_IN: string;
}

export default registerAs<GameAuthConfig>('gameAuth', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);
  if (process.env.NODE_ENV === 'production') {
    validateProductionSecrets();
  }

  return {
    secret: process.env.GAME_AUTH_JWT_SECRET,
    expires: (process.env.GAME_AUTH_JWT_TOKEN_EXPIRES_IN ?? '2h') as ms.StringValue,
    refreshSecret: process.env.GAME_AUTH_REFRESH_SECRET,
    refreshExpires: (process.env.GAME_AUTH_REFRESH_TOKEN_EXPIRES_IN ?? '365d') as ms.StringValue,
  };
});

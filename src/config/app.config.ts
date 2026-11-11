import { registerAs } from '@nestjs/config';
import { AppConfig } from './app-config.type';
import validateConfig from '../common/validate-config';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariablesValidator {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  APP_PORT: number;

  // 支持逗号分隔的多个域名，用于 CORS 配置
  @Matches(/^https?:\/\/[^,\s]+(,\s*https?:\/\/[^,\s]+)*$/, {
    message: 'FRONTEND_DOMAIN must be a URL or comma-separated list of URLs (e.g. https://a.com,https://b.com)',
  })
  @IsOptional()
  FRONTEND_DOMAIN: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  BACKEND_DOMAIN: string;

  @IsString()
  @IsOptional()
  API_PREFIX: string;

  @IsString()
  @IsOptional()
  APP_FALLBACK_LANGUAGE: string;

  // 应用前的反向代理层数，用于从 X-Forwarded-For 取客户端 IP
  @IsInt()
  @Min(0)
  @IsOptional()
  TRUST_PROXY: number;

  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED: boolean;
}

export default registerAs<AppConfig>('app', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    name: process.env.APP_NAME ?? 'app',
    workingDirectory: process.env.PWD ?? process.cwd(),
    frontendDomain: process.env.FRONTEND_DOMAIN,
    backendDomain: process.env.BACKEND_DOMAIN ?? 'http://localhost',
    port: process.env.APP_PORT
      ? parseInt(process.env.APP_PORT, 10)
      : process.env.PORT
        ? parseInt(process.env.PORT, 10)
        : 3000,
    apiPrefix: process.env.API_PREFIX ?? 'api',
    fallbackLanguage: process.env.APP_FALLBACK_LANGUAGE ?? 'en',
    trustProxy: process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : 0,
    swaggerEnabled: process.env.SWAGGER_ENABLED
      ? process.env.SWAGGER_ENABLED === 'true'
      : process.env.NODE_ENV !== 'production',
  };
});

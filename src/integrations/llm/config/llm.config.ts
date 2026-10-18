import { registerAs } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import validateConfig from '../../../common/validate-config';
import { LlmConfig } from './llm-config.type';

const emptyToUndefined = ({
  value,
  obj,
  key,
}: {
  value: unknown;
  obj: Record<string, unknown>;
  key: string;
}): unknown => (obj[key] === '' ? undefined : value);

class EnvironmentVariablesValidator {
  @Transform(emptyToUndefined)
  @IsUrl({ require_tld: false })
  @IsOptional()
  LLM_BASE_URL?: string;

  @IsString()
  @IsOptional()
  LLM_API_KEY?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  LLM_MODEL?: string;

  @Transform(emptyToUndefined)
  @IsInt()
  @Min(1000)
  @Max(240_000)
  @IsOptional()
  LLM_TIMEOUT_MS?: number;
}

export default registerAs<LlmConfig>('llm', () => {
  const env = validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    baseUrl: env.LLM_BASE_URL ?? 'https://api.deepseek.com',
    apiKey: env.LLM_API_KEY ?? '',
    model: env.LLM_MODEL ?? 'deepseek-chat',
    timeoutMs: env.LLM_TIMEOUT_MS ?? 120_000,
  };
});

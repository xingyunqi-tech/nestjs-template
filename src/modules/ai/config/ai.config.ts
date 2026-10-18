import { registerAs } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';
import validateConfig from '../../../common/validate-config';
import { AiConfig } from './ai-config.type';

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
  @IsNumber()
  @Min(0)
  @IsOptional()
  AI_PRICE_INPUT_CACHE_HIT?: number;

  @Transform(emptyToUndefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  AI_PRICE_INPUT_CACHE_MISS?: number;

  @Transform(emptyToUndefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  AI_PRICE_OUTPUT?: number;
}

export default registerAs<AiConfig>('ai', () => {
  const env = validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    priceInputCacheHit: env.AI_PRICE_INPUT_CACHE_HIT ?? 0.2,
    priceInputCacheMiss: env.AI_PRICE_INPUT_CACHE_MISS ?? 2,
    priceOutput: env.AI_PRICE_OUTPUT ?? 3,
  };
});

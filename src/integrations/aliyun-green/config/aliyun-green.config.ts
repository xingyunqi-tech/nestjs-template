import { registerAs } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import validateConfig from '../../../common/validate-config';
import { AliyunGreenConfig } from './aliyun-green-config.type';

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
  @IsString()
  @IsOptional()
  ALIYUN_GREEN_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  ALIYUN_GREEN_ACCESS_KEY_SECRET?: string;

  @Transform(emptyToUndefined)
  @Matches(/^[a-z]+(-[a-z0-9]+)+$/)
  @IsOptional()
  ALIYUN_GREEN_REGION?: string;
}

export default registerAs<AliyunGreenConfig>('aliyunGreen', () => {
  const env = validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    accessKeyId: env.ALIYUN_GREEN_ACCESS_KEY_ID?.trim() ?? '',
    accessKeySecret: env.ALIYUN_GREEN_ACCESS_KEY_SECRET?.trim() ?? '',
    region: env.ALIYUN_GREEN_REGION ?? 'cn-shanghai',
  };
});

import { registerAs } from '@nestjs/config';

import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import validateConfig from '../../../common/validate-config';
import { FileDriver, FileConfig } from './file-config.type';
import { FilePurpose } from '../domain/file-purpose';

const MB = 1024 * 1024;

const MAX_SIZE_ENV: Record<FilePurpose, [env: string, defaultBytes: number]> = {
  [FilePurpose.IMAGE]: ['FILE_IMAGE_MAX_SIZE', 5 * MB],
  [FilePurpose.PRIVATE_IMAGE]: ['FILE_PRIVATE_IMAGE_MAX_SIZE', 10 * MB],
  [FilePurpose.CONTENT_IMAGE]: ['FILE_CONTENT_IMAGE_MAX_SIZE', 5 * MB],
  [FilePurpose.AUDIO]: ['FILE_AUDIO_MAX_SIZE', 20 * MB],
  [FilePurpose.IMPORT]: ['FILE_IMPORT_MAX_SIZE', 50 * MB],
  [FilePurpose.EXPORT]: ['FILE_EXPORT_MAX_SIZE', 20 * MB],
};

class EnvironmentVariablesValidator {
  @IsEnum(FileDriver)
  FILE_DRIVER: FileDriver;

  @ValidateIf((envValues) => [FileDriver.S3, FileDriver.S3_PRESIGNED].includes(envValues.FILE_DRIVER))
  @IsString()
  ACCESS_KEY_ID: string;

  @ValidateIf((envValues) => [FileDriver.S3, FileDriver.S3_PRESIGNED].includes(envValues.FILE_DRIVER))
  @IsString()
  SECRET_ACCESS_KEY: string;

  @ValidateIf((envValues) => [FileDriver.S3, FileDriver.S3_PRESIGNED].includes(envValues.FILE_DRIVER))
  @IsString()
  AWS_DEFAULT_S3_BUCKET: string;

  @ValidateIf((envValues) => [FileDriver.S3, FileDriver.S3_PRESIGNED].includes(envValues.FILE_DRIVER))
  @IsString()
  AWS_S3_REGION: string;

  @ValidateIf((envValues) => [FileDriver.S3, FileDriver.S3_PRESIGNED].includes(envValues.FILE_DRIVER))
  @IsOptional()
  @IsString()
  AWS_S3_ENDPOINT: string;

  @IsOptional()
  @IsBoolean()
  AWS_S3_FORCE_PATH_STYLE: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_IMAGE_MAX_SIZE: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_PRIVATE_IMAGE_MAX_SIZE: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_CONTENT_IMAGE_MAX_SIZE: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_AUDIO_MAX_SIZE: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_IMPORT_MAX_SIZE: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  FILE_EXPORT_MAX_SIZE: number;
}

export default registerAs<FileConfig>('file', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  const maxSizes = Object.fromEntries(
    Object.entries(MAX_SIZE_ENV).map(([purpose, [env, defaultBytes]]) => [
      purpose,
      process.env[env] ? parseInt(process.env[env], 10) : defaultBytes,
    ]),
  ) as Record<FilePurpose, number>;

  return {
    driver: (process.env.FILE_DRIVER as FileDriver | undefined) ?? FileDriver.LOCAL,
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    awsDefaultS3Bucket: process.env.AWS_DEFAULT_S3_BUCKET,
    awsS3Region: process.env.AWS_S3_REGION,
    awsS3Endpoint: process.env.AWS_S3_ENDPOINT,
    awsS3ForcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE !== 'false',
    maxSizes,
    maxFileSize: Math.max(...Object.values(maxSizes)),
  };
});

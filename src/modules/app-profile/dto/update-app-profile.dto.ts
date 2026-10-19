import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { APP_PROFILE_MAX_LENGTH, SERVICE_PHONE_PATTERN } from '../domain/app-profile';

const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

const isPresent = (_: object, value: unknown): boolean => value !== undefined && value !== null;

/** 未传、null 或空白字符串均保存为未配置 */
export class UpdateAppProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.appName })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.appName)
  appName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.slogan })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.slogan)
  slogan?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.companyName })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.companyName)
  companyName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.copyright })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.copyright)
  copyright?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.icpLicense })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.icpLicense)
  icpLicense?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: APP_PROFILE_MAX_LENGTH.servicePhone,
    description: '只允许数字、-、+ 与空格',
  })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @Matches(SERVICE_PHONE_PATTERN)
  @MaxLength(APP_PROFILE_MAX_LENGTH.servicePhone)
  servicePhone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.serviceHours })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.serviceHours)
  serviceHours?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'email',
    maxLength: APP_PROFILE_MAX_LENGTH.serviceEmail,
  })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsEmail()
  @MaxLength(APP_PROFILE_MAX_LENGTH.serviceEmail)
  serviceEmail?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: APP_PROFILE_MAX_LENGTH.shareTitle })
  @Transform(trimToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(APP_PROFILE_MAX_LENGTH.shareTitle)
  shareTitle?: string | null;
}

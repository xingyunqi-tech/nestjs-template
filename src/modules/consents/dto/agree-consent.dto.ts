import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ConsentType } from '../domain/consent-type';

export class AgreeConsentDto {
  @ApiProperty({ enum: ConsentType, enumName: 'ConsentType' })
  @IsEnum(ConsentType)
  type: ConsentType;

  @ApiProperty({ type: String, example: '2026-10-01', description: '须为该协议的当前版本' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  version: string;
}

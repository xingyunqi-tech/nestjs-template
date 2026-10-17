import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FilePurpose } from '../domain/file-purpose';

export class UploadFileQueryDto {
  @ApiPropertyOptional({
    enum: FilePurpose,
    default: FilePurpose.IMAGE,
    description: '上传用途，决定允许的文件类型、大小上限与可见性',
  })
  @IsOptional()
  @IsEnum(FilePurpose)
  purpose?: FilePurpose;
}

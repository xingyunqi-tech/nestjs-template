import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

const PUBLISH_ON_IMPORT_PROPERTY = {
  type: Boolean,
  default: false,
  description: '导入成功的内容直接发布，仅管理员可用',
};

export class CreateImportDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: '已上传的导入包（purpose=import），与 file 二选一',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional(PUBLISH_ON_IMPORT_PROPERTY)
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  publishOnImport?: boolean;
}

export class CreateImportUploadBodyDto {
  @ApiProperty({ type: 'string', format: 'binary', description: '导入包（zip / xlsx / json）' })
  file: unknown;

  @ApiPropertyOptional(PUBLISH_ON_IMPORT_PROPERTY)
  publishOnImport?: boolean;
}

export class CreateImportFileIdBodyDto {
  @ApiProperty({ type: String, format: 'uuid', description: '已上传的导入包（purpose=import）' })
  fileId: string;

  @ApiPropertyOptional(PUBLISH_ON_IMPORT_PROPERTY)
  publishOnImport?: boolean;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

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

  @ApiPropertyOptional({ type: Boolean, default: false, description: '导入成功的内容直接发布，需 content:review' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  publishOnImport?: boolean;
}

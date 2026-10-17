import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { Exclude, Transform } from 'class-transformer';
import { FileVisibility } from './file-visibility';
import { buildFileUrl } from '../file-url';

export class FileType {
  @ApiProperty({
    type: String,
    example: 'cbcfa8b8-3a25-4adb-a9c6-e325f0d0f3ae',
  })
  @Allow()
  id: string;

  @ApiProperty({
    type: String,
    example: 'https://example.com/path/to/file.jpg',
  })
  @Transform(
    ({ value, obj }: { value: string; obj: FileType }) =>
      buildFileUrl({ id: obj.id, path: value, visibility: obj.visibility }),
    {
      toPlainOnly: true,
    },
  )
  path: string;

  /** 上传者，系统生成的文件为 null */
  @Exclude({ toPlainOnly: true })
  ownerUserId?: number | null;

  @ApiPropertyOptional({ enum: FileVisibility, example: FileVisibility.PUBLIC })
  visibility?: FileVisibility;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'image/png' })
  mimeType?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: '字节数' })
  size?: number | null;

  @Exclude({ toPlainOnly: true })
  sha256?: string | null;
}

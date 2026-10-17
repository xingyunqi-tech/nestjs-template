import { ApiProperty } from '@nestjs/swagger';
import { ImportJobStatus } from './import-job-status';

export class ImportJob {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid', description: '导入包文件' })
  fileId: string;

  @ApiProperty({ enum: ImportJobStatus, enumName: 'ImportJobStatus' })
  status: ImportJobStatus;

  @ApiProperty({ type: Boolean, description: '导入成功的内容是否直接发布' })
  publishOnImport: boolean;

  @ApiProperty({
    type: Number,
    description: '导入单元总数：知识点行、材料组、独立题、试卷；succeeded + failed + skipped 为已处理数',
  })
  total: number;

  @ApiProperty({ type: Number })
  succeeded: number;

  @ApiProperty({ type: Number })
  failed: number;

  @ApiProperty({ type: Number, description: '内容已存在而未写入的单元数，不计入失败' })
  skipped: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '错误行报告文件' })
  errorReportFileId: string | null;

  @ApiProperty({ type: String, nullable: true, description: '任务整体失败的错误键' })
  failureReason: string | null;

  @ApiProperty({ type: Number, nullable: true, description: '命令行导入为空' })
  createdBy: number | null;

  @ApiProperty({ type: Date, nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  finishedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

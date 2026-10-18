import { ApiProperty } from '@nestjs/swagger';

export enum ErrataStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export const ACTIVE_ERRATA_STATUSES = [ErrataStatus.PENDING, ErrataStatus.RUNNING];

export class Errata {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: Number, description: '勘误前的当前版本' })
  fromVersion: number;

  @ApiProperty({ type: Number, description: '勘误生成的 ERRATA 版本' })
  toVersion: number;

  @ApiProperty({ type: Boolean, description: '是否修改了答案；只改解析时为 false' })
  answerChanged: boolean;

  @ApiProperty({ enum: ErrataStatus, enumName: 'ErrataStatus' })
  status: ErrataStatus;

  @ApiProperty({ type: Number, description: '受影响用户数' })
  affectedUsers: number;

  @ApiProperty({ type: Number, description: '已处理用户数' })
  processedUsers: number;

  @ApiProperty({ type: String, description: '完成后写入关联纠错单的回复' })
  reply: string;

  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty({ type: Number, nullable: true })
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

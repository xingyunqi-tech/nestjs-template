import { ApiProperty } from '@nestjs/swagger';

export class QueueStatsDto {
  @ApiProperty({ type: String, example: 'notification' })
  name: string;

  @ApiProperty({ type: Boolean, description: '为 false 时统计查询失败或超时，计数均为 0' })
  available: boolean;

  @ApiProperty({ type: Number })
  waiting: number;

  @ApiProperty({ type: Number })
  active: number;

  @ApiProperty({ type: Number })
  delayed: number;

  @ApiProperty({ type: Number })
  failed: number;

  @ApiProperty({ type: Number })
  completed: number;

  @ApiProperty({ type: Number })
  prioritized: number;
}

export class QueuesOverviewDto {
  @ApiProperty({ type: Boolean, description: 'Redis 未启用时队列不可用，列表为空' })
  enabled: boolean;

  @ApiProperty({ type: [QueueStatsDto] })
  queues: QueueStatsDto[];
}

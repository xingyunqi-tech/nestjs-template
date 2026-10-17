import { ApiProperty } from '@nestjs/swagger';
import { AlertLevel } from '../../../common/enums/alert-level.enum';

export { AlertLevel };

export class AdminAlert {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty({ type: String, example: 'auto-submit' })
  type: string;

  @ApiProperty({ enum: AlertLevel, example: AlertLevel.WARN })
  level: AlertLevel;

  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({ type: Object, nullable: true })
  payload: Record<string, unknown> | null;

  @ApiProperty({ type: String, description: '同一 dedupKey 只保留一条未确认告警' })
  dedupKey: string;

  @ApiProperty({ type: Date, nullable: true })
  acknowledgedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

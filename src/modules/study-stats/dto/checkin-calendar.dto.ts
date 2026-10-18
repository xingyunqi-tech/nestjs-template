import { ApiProperty } from '@nestjs/swagger';
import { CheckinReason } from '../domain/study-checkin';

export class CheckinDayDto {
  @ApiProperty({ type: String, format: 'date' })
  date: string;

  @ApiProperty({ enum: CheckinReason, enumName: 'CheckinReason' })
  reason: CheckinReason;
}

export class CheckinCalendarDto {
  @ApiProperty({ type: String, example: '2026-10' })
  month: string;

  @ApiProperty({ type: () => [CheckinDayDto] })
  days: CheckinDayDto[];

  @ApiProperty({ type: Number, description: '连续打卡天数（今天未打卡则从昨天起算）' })
  streakDays: number;

  @ApiProperty({ type: Boolean })
  checkedInToday: boolean;
}

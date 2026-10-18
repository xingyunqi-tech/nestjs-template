import { ApiProperty } from '@nestjs/swagger';

export class StudyOverviewDto {
  @ApiProperty({ type: String, format: 'date', description: '今天（Asia/Shanghai）' })
  date: string;

  @ApiProperty({ type: Number, description: '今日做题数；有当前考试时只统计该考试下的科目' })
  todayAnswered: number;

  @ApiProperty({ type: Number })
  todayCorrect: number;

  @ApiProperty({ type: Number })
  todayDurationSec: number;

  @ApiProperty({ type: Number, nullable: true, description: '当前考试的每日目标，没有当前考试时为 null' })
  dailyGoal: number | null;

  @ApiProperty({ type: Boolean })
  checkedInToday: boolean;

  @ApiProperty({ type: Number, description: '连续打卡天数（今天未打卡则从昨天起算）' })
  streakDays: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  examId: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  examDate: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '距考试天数，考试当天为 0，已过为负数；未设置考试日期为 null',
  })
  daysUntilExam: number | null;

  @ApiProperty({ type: Number, description: '累计做题数；有当前考试时只统计该考试下的科目' })
  totalAnswered: number;
}

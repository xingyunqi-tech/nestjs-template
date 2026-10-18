import { ApiProperty } from '@nestjs/swagger';

export class DailySubjectStatDto {
  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: Number })
  answered: number;

  @ApiProperty({ type: Number })
  correct: number;

  @ApiProperty({ type: Number })
  durationSec: number;
}

export class DailyStatDto {
  @ApiProperty({ type: String, format: 'date' })
  date: string;

  @ApiProperty({ type: Number })
  answered: number;

  @ApiProperty({ type: Number })
  correct: number;

  @ApiProperty({ type: Number })
  durationSec: number;

  @ApiProperty({ type: () => [DailySubjectStatDto] })
  subjects: DailySubjectStatDto[];
}

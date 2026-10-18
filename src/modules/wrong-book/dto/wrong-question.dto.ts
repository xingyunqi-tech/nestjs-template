import { ApiProperty } from '@nestjs/swagger';
import { WrongQuestion, WrongQuestionStatus } from '../domain/wrong-question';
import { PublicQuestionDto } from '../../questions/dto/public-question.dto';
import { HiddenReason } from '../../practice/domain/hidden-reason';

export class WrongQuestionStateDto {
  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: Number })
  wrongCount: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '进入当前 ACTIVE 状态后的连续答对次数；hiddenReason 非空时为 null',
  })
  consecutiveCorrect: number | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'hiddenReason 非空时为 null' })
  lastCorrectDate: string | null;

  @ApiProperty({ type: Object, nullable: true, description: '最近一次错误答案；hiddenReason 非空时为 null' })
  lastWrongAnswer: Record<string, unknown> | null;

  @ApiProperty({ type: Date })
  firstWrongAt: Date;

  @ApiProperty({ type: Date })
  lastWrongAt: Date;

  @ApiProperty({ enum: WrongQuestionStatus, enumName: 'WrongQuestionStatus' })
  status: WrongQuestionStatus;

  @ApiProperty({ type: Date, nullable: true })
  masteredAt: Date | null;
}

export class WrongQuestionDto extends WrongQuestionStateDto {
  @ApiProperty({ type: () => PublicQuestionDto, nullable: true, description: '题目摘要，不含答案与解析' })
  question: PublicQuestionDto | null;

  @ApiProperty({ type: Boolean, description: '题目或所属材料已下架' })
  isOffline: boolean;

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

export function toWrongQuestionState(item: WrongQuestion): WrongQuestionStateDto {
  return Object.assign(new WrongQuestionStateDto(), {
    questionId: item.questionId,
    subjectId: item.subjectId,
    wrongCount: item.wrongCount,
    consecutiveCorrect: item.consecutiveCorrect,
    lastCorrectDate: item.lastCorrectDate,
    lastWrongAnswer: item.lastWrongAnswer,
    firstWrongAt: item.firstWrongAt,
    lastWrongAt: item.lastWrongAt,
    status: item.status,
    masteredAt: item.masteredAt,
  });
}

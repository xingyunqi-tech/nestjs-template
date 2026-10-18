import { ApiProperty } from '@nestjs/swagger';
import { Feedback } from '../domain/feedback';
import { PublicQuestionUnitDto } from '../../questions/dto/public-question.dto';
import { QuestionType } from '../../questions/domain/question-type';
import { Errata } from '../../errata/domain/errata';

export class QuestionReportItemDto extends Feedback {
  @ApiProperty({
    type: () => PublicQuestionUnitDto,
    nullable: true,
    description: '题目摘要，不含答案与解析；材料小题为材料连同该小题',
  })
  question: PublicQuestionUnitDto | null;
}

export class QuestionReportQuestionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: String, description: '当前版本题干原文' })
  stem: string;
}

export class AdminQuestionReportDto extends Feedback {
  @ApiProperty({ type: () => QuestionReportQuestionDto, nullable: true })
  question: QuestionReportQuestionDto | null;
}

export class AdminQuestionReportDetailDto extends AdminQuestionReportDto {
  @ApiProperty({ type: () => Errata, nullable: true, description: '关联的勘误任务' })
  errata: Errata | null;
}

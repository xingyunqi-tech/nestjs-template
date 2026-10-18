import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicQuestionDto } from '../../questions/dto/public-question.dto';
import { QuestionSolutionDto } from '../../questions/dto/question-solution.dto';
import { HiddenReason } from '../domain/hidden-reason';

export class QuestionContentItemDto extends PublicQuestionDto {
  @ApiProperty({
    type: QuestionSolutionDto,
    nullable: true,
    description: '题目在错题本、收藏或笔记中且不在进行中的模考时返回；材料为 null',
  })
  solution: QuestionSolutionDto | null;
}

/** 单题内容；材料只含与用户有关联的小题 */
export class QuestionContentDto extends QuestionContentItemDto {
  @ApiPropertyOptional({ type: () => [QuestionContentItemDto], description: '材料题的小题，按顺序' })
  children?: QuestionContentItemDto[];

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

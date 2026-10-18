import { ApiProperty } from '@nestjs/swagger';
import { PublicQuestionUnitDto } from '../../questions/dto/public-question.dto';
import { HiddenReason } from '../domain/hidden-reason';

/** 单题内容，不含答案与解析；材料只含与用户有关联的小题 */
export class QuestionContentDto extends PublicQuestionUnitDto {
  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

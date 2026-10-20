import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Question } from '../domain/question';
import { QuestionVersion } from '../domain/question-version';
import { QuestionOperatorDto } from './question-operator.dto';
import { FILE_URLS_PROPERTY } from '../../../common/swagger/file-urls.property';

export class AdminQuestionDto extends Question {
  @ApiProperty({ type: String, nullable: true, description: '音频访问地址' })
  audioUrl: string | null;

  @ApiProperty(FILE_URLS_PROPERTY)
  fileUrls: Record<string, string>;

  @ApiProperty({ type: () => QuestionOperatorDto, nullable: true, description: '创建人' })
  creator: QuestionOperatorDto | null;

  @ApiProperty({ type: () => QuestionOperatorDto, nullable: true, description: '最近一次提交审核的人' })
  submitter: QuestionOperatorDto | null;

  @ApiProperty({ type: () => QuestionOperatorDto, nullable: true, description: '最近一次发布、驳回或下架的人' })
  reviewer: QuestionOperatorDto | null;

  @ApiPropertyOptional({ type: () => [AdminQuestionDto], description: '材料题的小题，按顺序' })
  children?: AdminQuestionDto[];
}

export class AdminQuestionVersionDto extends QuestionVersion {
  @ApiProperty({ type: String, nullable: true, description: '音频访问地址' })
  audioUrl: string | null;

  @ApiProperty(FILE_URLS_PROPERTY)
  fileUrls: Record<string, string>;
}

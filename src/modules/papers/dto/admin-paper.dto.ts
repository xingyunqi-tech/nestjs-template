import { ApiProperty } from '@nestjs/swagger';
import { Paper } from '../domain/paper';
import { PaperQuestion } from '../domain/paper-question';
import { QuestionType } from '../../questions/domain/question-type';
import { QuestionStatus } from '../../questions/domain/question-status';
import { FILE_URLS_PROPERTY } from '../../../common/swagger/file-urls.property';

export class AdminPaperQuestionDto extends PaperQuestion {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '所属材料' })
  parentId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ enum: QuestionStatus, enumName: 'QuestionStatus', description: '题目当前状态' })
  status: QuestionStatus;

  @ApiProperty({ type: Number, description: '题目当前版本' })
  currentVersion: number;

  @ApiProperty({ type: String, description: '当前版本题干' })
  stem: string;

  @ApiProperty(FILE_URLS_PROPERTY)
  fileUrls: Record<string, string>;
}

export class AdminPaperDto extends Paper {
  @ApiProperty({ type: [AdminPaperQuestionDto] })
  questions: AdminPaperQuestionDto[];
}

import { Paper } from './domain/paper';
import { CreatePaperDto } from './dto/create-paper.dto';
import { SetPaperQuestionsDto } from './dto/set-paper-questions.dto';

export interface PaperImportInput {
  /** 已有草稿试卷 ID，填写时更新该试卷 */
  id: Paper['id'] | null;
  subjectId: Paper['subjectId'];
  fields: Omit<CreatePaperDto, 'subjectId'>;
  questions: SetPaperQuestionsDto;
  publish: boolean;
}

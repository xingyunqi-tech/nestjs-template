import { QuestionNote } from '../../../../domain/question-note';
import { QuestionNoteEntity } from '../entities/question-note.entity';

export class QuestionNoteMapper {
  static toDomain(raw: QuestionNoteEntity): QuestionNote {
    const domain = new QuestionNote();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.questionId = raw.questionId;
    domain.subjectId = raw.subjectId;
    domain.content = raw.content;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

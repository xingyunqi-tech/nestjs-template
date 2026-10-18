import { WrongQuestion } from '../../../../domain/wrong-question';
import { WrongQuestionEntity } from '../entities/wrong-question.entity';

export class WrongQuestionMapper {
  static toDomain(raw: WrongQuestionEntity): WrongQuestion {
    const domain = new WrongQuestion();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.questionId = raw.questionId;
    domain.subjectId = raw.subjectId;
    domain.wrongCount = raw.wrongCount;
    domain.consecutiveCorrect = raw.consecutiveCorrect;
    domain.lastCorrectDate = raw.lastCorrectDate;
    domain.lastWrongAnswer = raw.lastWrongAnswer;
    domain.firstWrongAt = raw.firstWrongAt;
    domain.lastWrongAt = raw.lastWrongAt;
    domain.status = raw.status;
    domain.masteredAt = raw.masteredAt;
    domain.aiAnalysis = raw.aiAnalysis;
    domain.aiAnalysisVersion = raw.aiAnalysisVersion;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

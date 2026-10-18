import { AnswerRecord } from '../../../../domain/answer-record';
import { AnswerRecordEntity } from '../entities/answer-record.entity';

export class AnswerRecordMapper {
  static toDomain(raw: AnswerRecordEntity): AnswerRecord {
    const domain = new AnswerRecord();
    domain.id = raw.id;
    domain.sessionId = raw.sessionId;
    domain.userId = raw.userId;
    domain.questionId = raw.questionId;
    domain.questionVersion = raw.questionVersion;
    domain.answer = raw.answer;
    domain.isCorrect = raw.isCorrect;
    domain.isPartial = raw.isPartial;
    domain.score = raw.score === null ? null : Number(raw.score);
    domain.selfAssessment = raw.selfAssessment;
    domain.gradingStatus = raw.gradingStatus;
    domain.gradingTaskId = raw.gradingTaskId;
    domain.durationSec = raw.durationSec;
    domain.markedForReview = raw.markedForReview;
    domain.deviceId = raw.deviceId;
    domain.clientSeq = raw.clientSeq;
    domain.clientAnsweredAt = raw.clientAnsweredAt;
    domain.answeredAt = raw.answeredAt;
    domain.gradedAt = raw.gradedAt;
    domain.statDate = raw.statDate;
    domain.statsAppliedAt = raw.statsAppliedAt;
    domain.firstForQuestion = raw.firstForQuestion;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

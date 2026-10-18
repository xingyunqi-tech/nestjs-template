import { PracticeSession } from '../../../../domain/practice-session';
import { PracticeSessionEntity } from '../entities/practice-session.entity';
import { CreatePracticeSessionData } from '../../practice-session.repository';

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));
const toNumeric = (value: number | null): string | null => (value === null ? null : value.toFixed(2));

export class PracticeSessionMapper {
  static toDomain(raw: PracticeSessionEntity): PracticeSession {
    const domain = new PracticeSession();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.subjectId = raw.subjectId;
    domain.mode = raw.mode;
    domain.paperId = raw.paperId;
    domain.dailyDate = raw.dailyDate;
    domain.scope = { ...raw.scope };
    domain.questionIds = [...raw.questionIds];
    domain.questionVersions = { ...raw.questionVersions };
    domain.status = raw.status;
    domain.activeDeviceId = raw.activeDeviceId;
    domain.startedAt = raw.startedAt;
    domain.deadlineAt = raw.deadlineAt;
    domain.autoSubmitAt = raw.autoSubmitAt;
    domain.submittedAt = raw.submittedAt;
    domain.submitType = raw.submitType;
    domain.lastActiveAt = raw.lastActiveAt;
    domain.isFirstAttempt = raw.isFirstAttempt;
    domain.scoringScheme = raw.scoringScheme;
    domain.score = toNumber(raw.score);
    domain.totalScore = toNumber(raw.totalScore);
    domain.correctCount = raw.correctCount;
    domain.answeredCount = raw.answeredCount;
    domain.durationSec = raw.durationSec;
    domain.lastIndex = raw.lastIndex;
    domain.pendingGrading = raw.pendingGrading;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(domain: CreatePracticeSessionData): PracticeSessionEntity {
    const entity = new PracticeSessionEntity();
    entity.userId = domain.userId;
    entity.subjectId = domain.subjectId;
    entity.mode = domain.mode;
    entity.paperId = domain.paperId;
    entity.dailyDate = domain.dailyDate;
    entity.scope = domain.scope;
    entity.questionIds = domain.questionIds;
    entity.questionVersions = domain.questionVersions;
    entity.activeDeviceId = domain.activeDeviceId;
    entity.deadlineAt = domain.deadlineAt;
    entity.autoSubmitAt = domain.autoSubmitAt;
    entity.scoringScheme = domain.scoringScheme;
    entity.totalScore = toNumeric(domain.totalScore);
    return entity;
  }
}

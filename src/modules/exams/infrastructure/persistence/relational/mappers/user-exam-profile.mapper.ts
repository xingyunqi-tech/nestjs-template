import { UserExamProfile } from '../../../../domain/user-exam-profile';
import { UserExamProfileEntity } from '../entities/user-exam-profile.entity';
import { ExamMapper } from './exam.mapper';

export class UserExamProfileMapper {
  static toDomain(raw: UserExamProfileEntity): UserExamProfile {
    const domain = new UserExamProfile();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.examId = raw.examId;
    domain.isCurrent = raw.isCurrent;
    domain.examDate = raw.examDate;
    domain.dailyGoal = raw.dailyGoal;
    if (raw.exam) {
      domain.exam = ExamMapper.toDomain(raw.exam);
    }
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }

  static toPersistence(
    domain: Pick<UserExamProfile, 'userId' | 'examId' | 'isCurrent' | 'examDate' | 'dailyGoal'>,
  ): UserExamProfileEntity {
    const entity = new UserExamProfileEntity();
    entity.userId = Number(domain.userId);
    entity.examId = domain.examId;
    entity.isCurrent = domain.isCurrent;
    entity.examDate = domain.examDate;
    entity.dailyGoal = domain.dailyGoal;
    return entity;
  }
}

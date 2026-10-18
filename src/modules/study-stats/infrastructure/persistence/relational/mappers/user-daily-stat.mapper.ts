import { UserDailyStat } from '../../../../domain/user-daily-stat';
import { UserDailyStatEntity } from '../entities/user-daily-stat.entity';

export class UserDailyStatMapper {
  static toDomain(raw: UserDailyStatEntity): UserDailyStat {
    const domain = new UserDailyStat();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.date = raw.date;
    domain.subjectId = raw.subjectId;
    domain.answered = raw.answered;
    domain.correct = raw.correct;
    domain.durationSec = raw.durationSec;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

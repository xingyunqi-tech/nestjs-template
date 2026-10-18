import { StudyCheckin } from '../../../../domain/study-checkin';
import { StudyCheckinEntity } from '../entities/study-checkin.entity';

export class StudyCheckinMapper {
  static toDomain(raw: StudyCheckinEntity): StudyCheckin {
    const domain = new StudyCheckin();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.date = raw.date;
    domain.reason = raw.reason;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

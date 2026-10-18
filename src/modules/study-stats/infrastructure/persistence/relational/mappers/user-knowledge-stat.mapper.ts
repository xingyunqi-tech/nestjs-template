import { UserKnowledgeStat } from '../../../../domain/user-knowledge-stat';
import { UserKnowledgeStatEntity } from '../entities/user-knowledge-stat.entity';

export class UserKnowledgeStatMapper {
  static toDomain(raw: UserKnowledgeStatEntity): UserKnowledgeStat {
    const domain = new UserKnowledgeStat();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.knowledgePointId = raw.knowledgePointId;
    domain.answered = raw.answered;
    domain.correct = raw.correct;
    domain.recentResults = (raw.recentResults ?? []).map(Number);
    domain.lastAnsweredAt = raw.lastAnsweredAt;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}

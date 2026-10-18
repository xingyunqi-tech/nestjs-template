import { Errata } from '../../../../domain/errata';
import { ErrataEntity } from '../entities/errata.entity';
import { CreateErrataData } from '../../errata.repository';

export class ErrataMapper {
  static toDomain(entity: ErrataEntity): Errata {
    return Object.assign(new Errata(), {
      id: entity.id,
      questionId: entity.questionId,
      fromVersion: entity.fromVersion,
      toVersion: entity.toVersion,
      answerChanged: entity.answerChanged,
      status: entity.status,
      affectedUsers: entity.affectedUsers,
      processedUsers: entity.processedUsers,
      reply: entity.reply,
      failureReason: entity.failureReason,
      createdBy: entity.createdBy,
      startedAt: entity.startedAt,
      finishedAt: entity.finishedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  static toPersistence(data: CreateErrataData): Partial<ErrataEntity> {
    return {
      questionId: data.questionId,
      fromVersion: data.fromVersion,
      toVersion: data.toVersion,
      answerChanged: data.answerChanged,
      reply: data.reply,
      createdBy: data.createdBy,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { SessionEntity } from '../entities/session.entity';
import { NullableType } from '../../../../../../common/types/nullable.type';

import { SessionRepository } from '../../session.repository';
import { Session } from '../../../../domain/session';

import { SessionMapper } from '../mappers/session.mapper';
import { User } from '../../../../../users/domain/user';

@Injectable()
export class SessionRelationalRepository implements SessionRepository {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
  ) {}

  async findById(id: Session['id']): Promise<NullableType<Session>> {
    const entity = await this.sessionRepository.findOne({
      where: {
        id: Number(id),
      },
      relations: { user: true },
    });

    return entity ? SessionMapper.toDomain(entity) : null;
  }

  async create(data: Session): Promise<Session> {
    const persistenceModel = SessionMapper.toPersistence(data);
    return this.sessionRepository.save(this.sessionRepository.create(persistenceModel));
  }

  async rotateHash(id: Session['id'], currentHash: string, nextHash: string): Promise<boolean> {
    const result = await this.sessionRepository.update(
      { id: Number(id), hash: currentHash, deletedAt: IsNull() },
      { hash: nextHash, lastActiveAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async findActiveByUserId(userId: User['id']): Promise<Session[]> {
    const entities = await this.sessionRepository.find({
      where: { user: { id: Number(userId) } },
      order: { lastActiveAt: { direction: 'DESC', nulls: 'LAST' }, id: 'DESC' },
    });
    return entities.map((entity) => SessionMapper.toDomain(entity));
  }

  async touch(id: Session['id'], at: Date, staleBefore: Date): Promise<void> {
    await this.sessionRepository
      .createQueryBuilder()
      .update()
      .set({ lastActiveAt: at })
      .where('id = :id', { id: Number(id) })
      .andWhere('("lastActiveAt" IS NULL OR "lastActiveAt" < :staleBefore)', { staleBefore })
      .execute();
  }

  async deleteByIdForUser(id: Session['id'], userId: User['id']): Promise<boolean> {
    const result = await this.sessionRepository
      .createQueryBuilder()
      .softDelete()
      .where('id = :id', { id: Number(id) })
      .andWhere('"userId" = :userId', { userId: Number(userId) })
      .andWhere('"deletedAt" IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async deleteById(id: Session['id']): Promise<void> {
    await this.sessionRepository.softDelete({
      id: Number(id),
    });
  }

  async deleteByUserId(conditions: { userId: User['id'] }): Promise<Session['id'][]> {
    return this.softDeleteWhere({
      user: {
        id: Number(conditions.userId),
      },
    });
  }

  async deleteByUserIdWithExclude(conditions: {
    userId: User['id'];
    excludeSessionId: Session['id'];
  }): Promise<Session['id'][]> {
    return this.softDeleteWhere({
      user: {
        id: Number(conditions.userId),
      },
      id: Not(Number(conditions.excludeSessionId)),
    });
  }

  private async softDeleteWhere(where: FindOptionsWhere<SessionEntity>): Promise<Session['id'][]> {
    const sessions = await this.sessionRepository.find({ select: { id: true }, where });
    const ids = sessions.map((session) => session.id);
    if (ids.length > 0) {
      await this.sessionRepository.softDelete({ id: In(ids) });
    }
    return ids;
  }
}

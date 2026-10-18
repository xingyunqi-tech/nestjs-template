import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserConsentEntity } from '../entities/user-consent.entity';
import { UserConsentMapper } from '../mappers/user-consent.mapper';
import { UserConsentRepository } from '../../user-consent.repository';
import { UserConsent } from '../../../../domain/user-consent';
import { ConsentType } from '../../../../domain/consent-type';
import { NullableType } from '../../../../../../common/types/nullable.type';

@Injectable()
export class UserConsentRelationalRepository implements UserConsentRepository {
  constructor(
    @InjectRepository(UserConsentEntity)
    private readonly repository: Repository<UserConsentEntity>,
  ) {}

  async insertIfAbsent(data: Pick<UserConsent, 'userId' | 'type' | 'version' | 'ip'>): Promise<void> {
    await this.repository.query(
      `INSERT INTO "user_consent" ("userId", "type", "version", "ip") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "type", "version") DO NOTHING`,
      [data.userId, data.type, data.version, data.ip],
    );
  }

  async findLatestByUser(userId: number): Promise<UserConsent[]> {
    const entities = await this.repository
      .createQueryBuilder('c')
      .distinctOn(['c.type'])
      .where('c.userId = :userId', { userId })
      .orderBy('c.type')
      .addOrderBy('c.agreedAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .getMany();
    return entities.map((entity) => UserConsentMapper.toDomain(entity));
  }

  exists(userId: number, type: ConsentType, version: string): Promise<boolean> {
    return this.repository.exists({ where: { userId, type, version } });
  }

  async findOne(userId: number, type: ConsentType, version: string): Promise<NullableType<UserConsent>> {
    const entity = await this.repository.findOne({ where: { userId, type, version } });
    return entity ? UserConsentMapper.toDomain(entity) : null;
  }
}

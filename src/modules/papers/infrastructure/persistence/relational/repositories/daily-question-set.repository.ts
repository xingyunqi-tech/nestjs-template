import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { DailyQuestionSetEntity } from '../entities/daily-question-set.entity';
import { DailyQuestionSetMapper } from '../mappers/daily-question-set.mapper';
import { DailyQuestionSetRepository } from '../../daily-question-set.repository';
import { DailyQuestionSet } from '../../../../domain/daily-question-set';
import { NullableType } from '../../../../../../common/types/nullable.type';

@Injectable()
export class DailyQuestionSetRelationalRepository implements DailyQuestionSetRepository {
  constructor(
    @InjectRepository(DailyQuestionSetEntity)
    private readonly dailyQuestionSetRepository: Repository<DailyQuestionSetEntity>,
  ) {}

  async findOne(subjectId: string, date: string): Promise<NullableType<DailyQuestionSet>> {
    const entity = await this.dailyQuestionSetRepository.findOne({ where: { subjectId, date } });
    return entity ? DailyQuestionSetMapper.toDomain(entity) : null;
  }

  async insertIfAbsent(subjectId: string, date: string, questionIds: string[]): Promise<DailyQuestionSet> {
    await this.dailyQuestionSetRepository
      .createQueryBuilder()
      .insert()
      .into(DailyQuestionSetEntity)
      .values({ subjectId, date, questionIds })
      .orIgnore()
      .execute();
    return (await this.findOne(subjectId, date))!;
  }

  async findRange(subjectId: string, from: string, to: string): Promise<DailyQuestionSet[]> {
    const entities = await this.dailyQuestionSetRepository.find({
      where: { subjectId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
    return entities.map((entity) => DailyQuestionSetMapper.toDomain(entity));
  }
}

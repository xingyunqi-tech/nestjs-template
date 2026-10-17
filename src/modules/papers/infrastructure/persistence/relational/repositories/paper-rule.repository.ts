import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PaperRuleEntity } from '../entities/paper-rule.entity';
import { PaperRuleMapper } from '../mappers/paper-rule.mapper';
import { CreatePaperRuleData, PaperRuleChanges, PaperRuleRepository } from '../../paper-rule.repository';
import { PaperRule } from '../../../../domain/paper-rule';
import { PaperRuleFilterOptions } from '../../../../dto/query-admin-paper-rule.dto';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const UPDATABLE_COLUMNS = ['name', 'durationMin', 'multiScoringRule', 'items', 'status'] as const;

@Injectable()
export class PaperRuleRelationalRepository implements PaperRuleRepository {
  constructor(
    @InjectRepository(PaperRuleEntity)
    private readonly paperRuleRepository: Repository<PaperRuleEntity>,
  ) {}

  async create(data: CreatePaperRuleData): Promise<PaperRule> {
    const entity = await this.paperRuleRepository.save(
      this.paperRuleRepository.create(PaperRuleMapper.toPersistence(data)),
    );
    return PaperRuleMapper.toDomain(entity);
  }

  async findById(id: PaperRule['id']): Promise<NullableType<PaperRule>> {
    const entity = await this.paperRuleRepository.findOne({ where: { id } });
    return entity ? PaperRuleMapper.toDomain(entity) : null;
  }

  async findManyWithPaginationAndCount({
    filterOptions,
    paginationOptions,
  }: {
    filterOptions?: PaperRuleFilterOptions | null;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: PaperRule[]; total: number }> {
    const where: FindOptionsWhere<PaperRuleEntity> = {};
    if (filterOptions?.keyword) {
      where.name = ILike(`%${escapeLike(filterOptions.keyword)}%`);
    }
    if (filterOptions?.subjectId) {
      where.subjectId = filterOptions.subjectId;
    }
    if (filterOptions?.status) {
      where.status = filterOptions.status;
    }
    const [entities, total] = await this.paperRuleRepository.findAndCount({
      where,
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    return { data: entities.map((entity) => PaperRuleMapper.toDomain(entity)), total };
  }

  async update(id: PaperRule['id'], changes: PaperRuleChanges): Promise<NullableType<PaperRule>> {
    const values = Object.fromEntries(
      UPDATABLE_COLUMNS.filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]]),
    ) as QueryDeepPartialEntity<PaperRuleEntity>;
    if (Object.keys(values).length > 0) {
      await this.paperRuleRepository.update({ id }, values);
    }
    return this.findById(id);
  }

  async remove(id: PaperRule['id']): Promise<boolean> {
    const result = await this.paperRuleRepository.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}

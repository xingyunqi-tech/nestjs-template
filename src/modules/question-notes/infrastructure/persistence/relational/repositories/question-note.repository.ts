import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionNoteEntity } from '../entities/question-note.entity';
import { QuestionNoteMapper } from '../mappers/question-note.mapper';
import { QuestionNoteFilter, QuestionNoteRepository } from '../../question-note.repository';
import { QuestionNote } from '../../../../domain/question-note';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

@Injectable()
export class QuestionNoteRelationalRepository implements QuestionNoteRepository {
  constructor(
    @InjectRepository(QuestionNoteEntity)
    private readonly repository: Repository<QuestionNoteEntity>,
  ) {}

  async upsert(data: Pick<QuestionNote, 'userId' | 'questionId' | 'subjectId' | 'content'>): Promise<QuestionNote> {
    const rows: QuestionNoteEntity[] = await this.repository.query(
      `INSERT INTO "question_note" ("userId", "questionId", "subjectId", "content")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "questionId")
       DO UPDATE SET "content" = EXCLUDED."content", "subjectId" = EXCLUDED."subjectId", "updatedAt" = now()
       RETURNING *`,
      [data.userId, data.questionId, data.subjectId, data.content],
    );
    return QuestionNoteMapper.toDomain(rows[0]);
  }

  async findOne(userId: number, questionId: string): Promise<NullableType<QuestionNote>> {
    const entity = await this.repository.findOne({ where: { userId, questionId } });
    return entity ? QuestionNoteMapper.toDomain(entity) : null;
  }

  async remove(userId: number, questionId: string): Promise<boolean> {
    const result = await this.repository.delete({ userId, questionId });
    return (result.affected ?? 0) > 0;
  }

  async findManyWithPaginationAndCount(
    filter: QuestionNoteFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: QuestionNote[]; total: number }> {
    const [entities, total] = await this.repository.findAndCount({
      where: {
        userId: filter.userId,
        ...(filter.subjectId && { subjectId: filter.subjectId }),
        ...(filter.questionId && { questionId: filter.questionId }),
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map((entity) => QuestionNoteMapper.toDomain(entity)), total };
  }

  async findQuestionIdsWithNote(userId: number, questionIds: string[]): Promise<string[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const rows: { questionId: string }[] = await this.repository.query(
      `SELECT "questionId" FROM "question_note" WHERE "userId" = $1 AND "questionId" = ANY($2::uuid[])`,
      [userId, questionIds],
    );
    return rows.map((row) => row.questionId);
  }
}

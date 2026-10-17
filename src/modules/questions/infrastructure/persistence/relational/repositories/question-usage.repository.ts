import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuestionUsageRepository } from '../../question-usage.repository';
import { Question } from '../../../../domain/question';

/** 仅检查试卷引用，不含作答记录 */
@Injectable()
export class QuestionUsageRelationalRepository implements QuestionUsageRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isUsed(questionIds: Question['id'][]): Promise<boolean> {
    if (questionIds.length === 0) {
      return false;
    }
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "paper_question" WHERE "questionId" = ANY($1::uuid[]) LIMIT 1`,
      [questionIds],
    );
    return rows.length > 0;
  }
}

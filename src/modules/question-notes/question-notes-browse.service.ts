import { Injectable } from '@nestjs/common';
import { QuestionNotesService } from './question-notes.service';
import { QueryQuestionNoteDto } from './dto/query-question-note.dto';
import { QuestionNoteDto, QuestionNoteItemDto, toQuestionNoteDto } from './dto/question-note.dto';
import { QuestionAssociationPrerequisiteService } from '../practice/question-association-prerequisite.service';
import { QuestionsService } from '../questions/questions.service';
import { IPaginationOptions } from '../../common/types/pagination-options';

/** 笔记的保存、删除与列表：保存前校验建立关联的前提，列表附带题目摘要 */
@Injectable()
export class QuestionNotesBrowseService {
  constructor(
    private readonly questionNotesService: QuestionNotesService,
    private readonly questionAssociationPrerequisiteService: QuestionAssociationPrerequisiteService,
    private readonly questionsService: QuestionsService,
  ) {}

  async save(userId: number, questionId: string, content: string): Promise<QuestionNoteDto> {
    const question = await this.questionAssociationPrerequisiteService.assertEligible(userId, questionId);
    return toQuestionNoteDto(await this.questionNotesService.save(userId, question, content));
  }

  remove(userId: number, questionId: string): Promise<void> {
    return this.questionNotesService.remove(userId, questionId);
  }

  async findPage(
    userId: number,
    query: QueryQuestionNoteDto,
  ): Promise<{ data: QuestionNoteItemDto[]; total: number; paginationOptions: IPaginationOptions }> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.questionNotesService.findManyWithPaginationAndCount(
      { userId, subjectId: query.subjectId, questionId: query.questionId },
      paginationOptions,
    );
    const units = await this.questionsService.findUnitsByQuestionIds(data.map((note) => note.questionId));
    const noteUnits = units.flatMap((unit) =>
      unit.questions.map((question) => ({ root: unit.root, questions: [question] })),
    );
    const summaries = await this.questionsService.toPublicUnits(noteUnits, userId);
    const byId = new Map(noteUnits.map((unit, index) => [unit.questions[0].id, summaries[index]]));
    return {
      data: data.map((note) =>
        Object.assign(new QuestionNoteItemDto(), toQuestionNoteDto(note), {
          question: byId.get(note.questionId) ?? null,
        }),
      ),
      total,
      paginationOptions,
    };
  }
}

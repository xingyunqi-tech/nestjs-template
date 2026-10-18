import type { Mocked } from 'vitest';
import { WrongBookBrowseService } from './wrong-book-browse.service';
import { WrongBookService } from './wrong-book.service';
import { WrongQuestion, WrongQuestionStatus } from './domain/wrong-question';
import { WrongBookSortField } from './infrastructure/persistence/wrong-question.repository';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionStatus } from '../questions/domain/question-status';
import { QuestionType } from '../questions/domain/question-type';
import { PublicQuestionUnitDto } from '../questions/dto/public-question.dto';
import { InProgressMockQuestionsService } from '../practice/in-progress-mock-questions.service';
import { HiddenReason } from '../practice/domain/hidden-reason';

const wrong = (questionId: string): WrongQuestion =>
  Object.assign(new WrongQuestion(), {
    id: `w-${questionId}`,
    userId: 7,
    questionId,
    subjectId: 'sub1',
    wrongCount: 2,
    consecutiveCorrect: 0,
    lastCorrectDate: null,
    lastWrongAnswer: { keys: ['A'] },
    firstWrongAt: new Date('2026-10-12T02:00:00Z'),
    lastWrongAt: new Date('2026-10-15T02:00:00Z'),
    status: WrongQuestionStatus.ACTIVE,
    masteredAt: null,
  });

const question = (id: string, status: QuestionStatus, parentId: string | null = null): Question =>
  ({ id, parentId, status, type: QuestionType.SINGLE }) as Question;

describe('WrongBookBrowseService', () => {
  let wrongBook: Mocked<Pick<WrongBookService, 'findManyWithPaginationAndCount' | 'summarize'>>;
  let questions: Mocked<Pick<QuestionsService, 'findByIds' | 'toPublicUnits'>>;
  let mockQuestions: Mocked<Pick<InProgressMockQuestionsService, 'findQuestionIds'>>;
  let service: WrongBookBrowseService;

  beforeEach(() => {
    const all = new Map(
      [
        question('q1', QuestionStatus.PUBLISHED),
        question('q2', QuestionStatus.OFFLINE),
        question('q3', QuestionStatus.PUBLISHED, 'm1'),
        question('m1', QuestionStatus.OFFLINE),
      ].map((item) => [item.id, item]),
    );
    wrongBook = {
      findManyWithPaginationAndCount: vi.fn().mockResolvedValue({ data: ['q1', 'q2', 'q3'].map(wrong), total: 3 }),
      summarize: vi.fn(),
    };
    questions = {
      findByIds: vi.fn((ids: string[]) => Promise.resolve(ids.flatMap((id) => all.get(id) ?? []))),
      toPublicUnits: vi.fn((units: { root: Question }[]) =>
        Promise.resolve(units.map((unit) => Object.assign(new PublicQuestionUnitDto(), { id: unit.root.id }))),
      ),
    };
    mockQuestions = { findQuestionIds: vi.fn().mockResolvedValue(new Set(['q1'])) };
    service = new WrongBookBrowseService(
      wrongBook as unknown as WrongBookService,
      questions as unknown as QuestionsService,
      mockQuestions as unknown as InProgressMockQuestionsService,
    );
  });

  it('should list active wrong questions by the latest wrong time by default', async () => {
    await service.findPage(7, {});

    expect(wrongBook.findManyWithPaginationAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        status: WrongQuestionStatus.ACTIVE,
        sortBy: WrongBookSortField.LAST_WRONG_AT,
        order: 'DESC',
      }),
      { page: 1, limit: 20 },
    );
  });

  it('should pass filters with time bounds as dates', async () => {
    await service.findPage(7, {
      subjectId: 'sub1',
      knowledgePointId: 'kp1',
      status: WrongQuestionStatus.MASTERED,
      minWrongCount: 2,
      lastWrongFrom: '2026-10-01T00:00:00+08:00',
      sortBy: WrongBookSortField.WRONG_COUNT,
      order: 'ASC',
      page: 2,
      limit: 10,
    });

    expect(wrongBook.findManyWithPaginationAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'sub1',
        knowledgePointId: 'kp1',
        status: WrongQuestionStatus.MASTERED,
        minWrongCount: 2,
        lastWrongFrom: new Date('2026-09-30T16:00:00Z'),
        lastWrongTo: undefined,
        sortBy: WrongBookSortField.WRONG_COUNT,
        order: 'ASC',
      }),
      { page: 2, limit: 10 },
    );
  });

  it('should attach question summaries, offline marks and the mock hidden reason', async () => {
    const { data, total } = await service.findPage(7, {});

    expect(total).toBe(3);
    expect(data.map((item) => [item.questionId, item.question?.id, item.isOffline, item.hiddenReason])).toEqual([
      ['q1', 'q1', false, HiddenReason.MOCK_IN_PROGRESS],
      ['q2', 'q2', true, null],
      ['q3', 'q3', true, null],
    ]);
    expect(data[1]).toMatchObject({
      wrongCount: 2,
      consecutiveCorrect: 0,
      lastWrongAnswer: { keys: ['A'] },
      status: 'ACTIVE',
    });
  });

  it('should drop the wrong answer and correct streak of questions hidden by an ongoing mock', async () => {
    const { data } = await service.findPage(7, {});

    expect(data[0]).toMatchObject({
      hiddenReason: HiddenReason.MOCK_IN_PROGRESS,
      lastWrongAnswer: null,
      consecutiveCorrect: null,
      lastCorrectDate: null,
      wrongCount: 2,
    });
  });

  it('should skip question lookups for an empty page', async () => {
    wrongBook.findManyWithPaginationAndCount.mockResolvedValue({ data: [], total: 0 });

    await expect(service.findPage(7, {})).resolves.toMatchObject({ data: [], total: 0 });
    expect(questions.findByIds).not.toHaveBeenCalled();
  });
});

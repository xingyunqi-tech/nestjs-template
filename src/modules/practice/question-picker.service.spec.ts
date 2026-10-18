import type { Mocked } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { QuestionPickerService, PickRequest } from './question-picker.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { WrongBookReader } from './ports/wrong-book.reader';
import { WeakPointReader } from './ports/weak-point.reader';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus } from './domain/practice-session';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionStatus } from '../questions/domain/question-status';
import { QuestionUnit } from '../questions/domain/question-unit';
import { DailyQuestionSetsService } from '../papers/daily-question-sets.service';
import { PapersService } from '../papers/papers.service';
import { DailyQuestionSet } from '../papers/domain/daily-question-set';

const USER = 1;
const SUBJECT = 's1';

const question = (id: string, overrides: Partial<Question> = {}): Question =>
  Object.assign(new Question(), {
    id,
    subjectId: SUBJECT,
    parentId: null,
    type: QuestionType.SINGLE,
    status: QuestionStatus.PUBLISHED,
    currentVersion: 1,
    ...overrides,
  });

const single = (id: string, overrides: Partial<Question> = {}): QuestionUnit => {
  const root = question(id, overrides);
  return { root, questions: [root] };
};

const material = (id: string, childIds: string[], status = QuestionStatus.PUBLISHED): QuestionUnit => ({
  root: question(id, { type: QuestionType.MATERIAL, status }),
  questions: childIds.map((childId) => question(childId, { parentId: id, status })),
});

describe('QuestionPickerService', () => {
  let questionsService: Mocked<Pick<QuestionsService, 'drawUnits' | 'findUnitsByQuestionIds' | 'findSummariesByIds'>>;
  let dailyService: Mocked<Pick<DailyQuestionSetsService, 'ensure'>>;
  let papersService: Mocked<Pick<PapersService, 'findQuestions'>>;
  let repository: Mocked<Pick<PracticeSessionRepository, 'findAnsweredRootIds' | 'findById' | 'findWrongQuestionIds'>>;
  let mockQuestions: Mocked<Pick<InProgressMockQuestionsService, 'findQuestionIds'>>;
  let wrongBook: Mocked<WrongBookReader>;
  let weakPoints: Mocked<WeakPointReader>;
  let service: QuestionPickerService;

  const request = (overrides: Partial<PickRequest>): PickRequest => ({
    userId: USER,
    subjectId: SUBJECT,
    mode: PracticeMode.RANDOM,
    scope: {},
    count: 3,
    ...overrides,
  });

  beforeEach(() => {
    questionsService = {
      drawUnits: vi.fn().mockResolvedValue([]),
      findUnitsByQuestionIds: vi.fn().mockResolvedValue([]),
      findSummariesByIds: vi.fn().mockResolvedValue([]),
    };
    dailyService = { ensure: vi.fn().mockResolvedValue(null) };
    papersService = { findQuestions: vi.fn().mockResolvedValue([]) };
    repository = {
      findAnsweredRootIds: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findWrongQuestionIds: vi.fn().mockResolvedValue([]),
    };
    mockQuestions = { findQuestionIds: vi.fn().mockResolvedValue(new Set()) };
    wrongBook = { findActiveQuestionIds: vi.fn().mockResolvedValue([]) };
    weakPoints = { findWeakKnowledgePointIds: vi.fn().mockResolvedValue([]) };
    service = new QuestionPickerService(
      questionsService as unknown as QuestionsService,
      dailyService as unknown as DailyQuestionSetsService,
      papersService as unknown as PapersService,
      repository as unknown as PracticeSessionRepository,
      mockQuestions as unknown as InProgressMockQuestionsService,
      wrongBook,
      weakPoints,
    );
  });

  it('should prefer unanswered questions in chapter practice and fill up with answered ones', async () => {
    repository.findAnsweredRootIds.mockResolvedValue(['done']);
    questionsService.drawUnits
      .mockResolvedValueOnce([single('a'), material('m', ['m1'])])
      .mockResolvedValueOnce([single('done')]);

    const result = await service.pick(request({ mode: PracticeMode.CHAPTER, scope: { knowledgePointId: 'kp' } }));

    expect(questionsService.drawUnits).toHaveBeenNthCalledWith(
      1,
      { subjectId: SUBJECT, knowledgePointIds: ['kp'], excludeRootIds: ['done'] },
      3,
    );
    expect(questionsService.drawUnits).toHaveBeenNthCalledWith(
      2,
      { subjectId: SUBJECT, knowledgePointIds: ['kp'], excludeRootIds: ['a', 'm'] },
      1,
    );
    expect(result).toEqual({
      questionIds: ['a', 'm1', 'done'],
      questionVersions: { a: 1, m1: 1, done: 1 },
      insufficient: false,
    });
  });

  it('should exclude the materials of questions in an ongoing mock and report insufficient', async () => {
    mockQuestions.findQuestionIds.mockResolvedValue(new Set(['m1', 'x']));
    questionsService.findSummariesByIds.mockResolvedValue([
      { id: 'm1', parentId: 'm', type: QuestionType.SINGLE, stem: '' },
      { id: 'x', parentId: null, type: QuestionType.SINGLE, stem: '' },
    ]);
    questionsService.drawUnits.mockResolvedValueOnce([single('a')]).mockResolvedValueOnce([]);

    const result = await service.pick(
      request({ mode: PracticeMode.TYPE, scope: { questionType: QuestionType.JUDGE } }),
    );

    expect(questionsService.drawUnits).toHaveBeenCalledWith(
      { subjectId: SUBJECT, type: QuestionType.JUDGE, excludeRootIds: ['m', 'x'] },
      3,
    );
    expect(result).toMatchObject({ questionIds: ['a'], insufficient: true });
  });

  it('should fall back to unanswered questions in smart practice without weak points or wrong questions', async () => {
    repository.findAnsweredRootIds.mockResolvedValue(['done']);
    questionsService.drawUnits.mockResolvedValueOnce([single('a'), single('b'), single('c')]);

    const result = await service.pick(request({ mode: PracticeMode.SMART }));

    expect(questionsService.drawUnits).toHaveBeenCalledTimes(1);
    expect(questionsService.drawUnits).toHaveBeenCalledWith({ subjectId: SUBJECT, excludeRootIds: ['done'] }, 3);
    expect(result).toMatchObject({ questionIds: ['a', 'b', 'c'], insufficient: false });
  });

  it('should mix weak point and wrong book questions in smart practice', async () => {
    weakPoints.findWeakKnowledgePointIds.mockResolvedValue(['weak']);
    wrongBook.findActiveQuestionIds.mockResolvedValue(['w']);
    questionsService.drawUnits
      .mockResolvedValueOnce([single('k1'), single('k2'), single('k3')])
      .mockResolvedValueOnce([single('n1'), single('n2')]);
    questionsService.findUnitsByQuestionIds.mockResolvedValue([single('w')]);

    const result = await service.pick(request({ mode: PracticeMode.SMART, count: 6 }));

    expect(questionsService.drawUnits).toHaveBeenNthCalledWith(
      1,
      { subjectId: SUBJECT, knowledgePointIds: ['weak'], excludeRootIds: [] },
      4,
    );
    expect(result.questionIds).toEqual(['k1', 'k2', 'k3', 'w', 'n1', 'n2']);
  });

  it('should use the daily set and drop offline questions', async () => {
    dailyService.ensure.mockResolvedValue(Object.assign(new DailyQuestionSet(), { questionIds: ['a', 'b'] }));
    questionsService.findUnitsByQuestionIds.mockResolvedValue([
      single('a'),
      single('b', { status: QuestionStatus.OFFLINE }),
    ]);

    const result = await service.pick(request({ mode: PracticeMode.DAILY, dailyDate: '2026-10-17', count: 1 }));

    expect(dailyService.ensure).toHaveBeenCalledWith(SUBJECT, '2026-10-17');
    expect(result).toEqual({ questionIds: ['a'], questionVersions: { a: 1 }, insufficient: false });
  });

  it('should return no daily questions when the set cannot be generated', async () => {
    expect(await service.pick(request({ mode: PracticeMode.DAILY, dailyDate: '2026-10-17' }))).toEqual({
      questionIds: [],
      questionVersions: {},
      insufficient: false,
    });
  });

  it('should redo wrong questions of an own session and skip questions in an ongoing mock', async () => {
    const source = Object.assign(new PracticeSession(), {
      id: 'src',
      userId: USER,
      subjectId: SUBJECT,
      mode: PracticeMode.CHAPTER,
      status: PracticeSessionStatus.SUBMITTED,
    });
    repository.findById.mockResolvedValue(source);
    repository.findWrongQuestionIds.mockResolvedValue(['a', 'm1', 'b']);
    mockQuestions.findQuestionIds.mockResolvedValue(new Set(['b']));
    questionsService.findUnitsByQuestionIds.mockResolvedValue([single('a'), material('m', ['m1'])]);

    const result = await service.pick(request({ mode: PracticeMode.WRONG, scope: { fromSessionId: 'src' }, count: 1 }));

    expect(questionsService.findUnitsByQuestionIds).toHaveBeenCalledWith(['a', 'm1']);
    expect(result).toMatchObject({ questionIds: ['a', 'm1'], insufficient: false });
  });

  it('should keep sub-questions of a material contiguous at its first position', async () => {
    repository.findById.mockResolvedValue(
      Object.assign(new PracticeSession(), {
        userId: USER,
        subjectId: SUBJECT,
        mode: PracticeMode.CHAPTER,
        status: PracticeSessionStatus.SUBMITTED,
      }),
    );
    repository.findWrongQuestionIds.mockResolvedValue(['m1', 'a', 'm2']);
    questionsService.findUnitsByQuestionIds.mockResolvedValue([
      material('m', ['m1']),
      single('a'),
      material('m', ['m2']),
    ]);

    const result = await service.pick(request({ mode: PracticeMode.WRONG, scope: { fromSessionId: 'src' } }));

    expect(result.questionIds).toEqual(['m1', 'm2', 'a']);
  });

  it('should reject redoing a session of another user or an ongoing mock', async () => {
    repository.findById.mockResolvedValue(
      Object.assign(new PracticeSession(), { userId: 2, subjectId: SUBJECT, mode: PracticeMode.CHAPTER }),
    );
    await expect(
      service.pick(request({ mode: PracticeMode.WRONG, scope: { fromSessionId: 'src' } })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    repository.findById.mockResolvedValue(
      Object.assign(new PracticeSession(), {
        userId: USER,
        subjectId: SUBJECT,
        mode: PracticeMode.MOCK,
        status: PracticeSessionStatus.IN_PROGRESS,
      }),
    );
    await expect(
      service.pick(request({ mode: PracticeMode.WRONG, scope: { fromSessionId: 'src' } })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should return no wrong questions while the wrong book is empty', async () => {
    expect(await service.pick(request({ mode: PracticeMode.WRONG }))).toMatchObject({
      questionIds: [],
      insufficient: true,
    });
  });

  it('should take paper questions in order with the frozen versions', async () => {
    papersService.findQuestions.mockResolvedValue([
      { paperId: 'p', sectionIndex: 0, questionId: 'a', questionVersion: 1, sort: 0, score: 1 },
      { paperId: 'p', sectionIndex: 1, questionId: 'm1', questionVersion: 2, sort: 1, score: 1 },
    ]);
    questionsService.findUnitsByQuestionIds.mockResolvedValue([
      single('a', { status: QuestionStatus.OFFLINE, currentVersion: 3 }),
      material('m', ['m1']),
    ]);

    expect(await service.pickFromPaper('p')).toEqual({
      questionIds: ['a', 'm1'],
      questionVersions: { a: 1, m1: 2 },
      insufficient: false,
    });
  });

  it('should reject modes without a picker', async () => {
    await expect(service.pick(request({ mode: PracticeMode.FAVORITE }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

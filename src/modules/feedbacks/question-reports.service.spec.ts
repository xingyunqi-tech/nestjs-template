import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { QuestionReportsService } from './question-reports.service';
import { FeedbacksService } from './feedbacks.service';
import { Feedback, FeedbackStatus, FeedbackType, QuestionReportReason } from './domain/feedback';
import { QuestionAccessService } from '../practice/question-access.service';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { ErrataService } from '../errata/errata.service';
import { Errata, ErrataStatus } from '../errata/domain/errata';

const report = (overrides: Partial<Feedback> = {}): Feedback =>
  Object.assign(new Feedback(), {
    id: 9,
    userId: 7,
    type: FeedbackType.QUESTION_ERROR,
    content: '答案应为 C',
    status: FeedbackStatus.PENDING,
    questionId: 'q1',
    questionVersion: 1,
    reason: QuestionReportReason.ANSWER_WRONG,
    errataId: null,
    createdAt: new Date(),
    ...overrides,
  });

const errata = (overrides: Partial<Errata> = {}): Errata =>
  Object.assign(new Errata(), {
    id: 'e1',
    questionId: 'q1',
    status: ErrataStatus.RUNNING,
    reply: '已勘误',
    ...overrides,
  });

describe('QuestionReportsService', () => {
  let feedbacks: Mocked<
    Pick<FeedbacksService, 'createQuestionReport' | 'findPage' | 'findQuestionReport' | 'update' | 'resolveByErrata'>
  >;
  let access: Mocked<Pick<QuestionAccessService, 'assertAccessible'>>;
  let questions: Mocked<Pick<QuestionsService, 'findSummariesByIds' | 'findByIds' | 'toPublicUnits'>>;
  let errataService: Mocked<Pick<ErrataService, 'findById'>>;
  let service: QuestionReportsService;

  beforeEach(() => {
    feedbacks = {
      createQuestionReport: vi.fn().mockResolvedValue(report()),
      findPage: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findQuestionReport: vi.fn().mockResolvedValue(report()),
      update: vi.fn().mockResolvedValue(report()),
      resolveByErrata: vi.fn().mockResolvedValue(1),
    };
    access = {
      assertAccessible: vi.fn().mockResolvedValue(Object.assign(new Question(), { id: 'q1', currentVersion: 3 })),
    };
    questions = {
      findSummariesByIds: vi.fn().mockResolvedValue([]),
      findByIds: vi.fn().mockResolvedValue([]),
      toPublicUnits: vi.fn().mockResolvedValue([]),
    };
    errataService = { findById: vi.fn().mockResolvedValue(errata()) };
    service = new QuestionReportsService(
      feedbacks as unknown as FeedbacksService,
      access as unknown as QuestionAccessService,
      questions as unknown as QuestionsService,
      errataService as unknown as ErrataService,
    );
  });

  it('should record the current version of an accessible question', async () => {
    await service.create(7, 'q1', { reason: QuestionReportReason.STEM_TYPO });

    expect(access.assertAccessible).toHaveBeenCalledWith(7, 'q1');
    expect(feedbacks.createQuestionReport).toHaveBeenCalledWith(7, {
      questionId: 'q1',
      questionVersion: 3,
      reason: QuestionReportReason.STEM_TYPO,
      content: '',
      images: undefined,
      contact: undefined,
    });
  });

  it('should list only question error reports of the user with question summaries', async () => {
    const sub = Object.assign(new Question(), { id: 'q1', parentId: 'm1', type: QuestionType.SINGLE });
    const material = Object.assign(new Question(), { id: 'm1', parentId: null, type: QuestionType.MATERIAL });
    feedbacks.findPage.mockResolvedValue({ data: [report()], total: 1 });
    questions.findByIds.mockResolvedValueOnce([sub]).mockResolvedValueOnce([material]);
    questions.toPublicUnits.mockResolvedValue([{ id: 'm1' } as never]);

    const page = await service.findMine(7, { status: FeedbackStatus.RESOLVED });

    expect(feedbacks.findPage).toHaveBeenCalledWith(
      { userId: 7, types: [FeedbackType.QUESTION_ERROR], status: FeedbackStatus.RESOLVED },
      { page: 1, limit: 20 },
    );
    expect(questions.toPublicUnits).toHaveBeenCalledWith([{ root: material, questions: [sub] }], 7);
    expect(page.data[0].question).toEqual({ id: 'm1' });
  });

  it('should filter admin reports by type and status', async () => {
    await service.findAdminPage({ type: FeedbackType.AI_CONTENT, status: FeedbackStatus.PENDING });
    await service.findAdminPage({});

    expect(feedbacks.findPage.mock.calls.map(([filter]) => filter.types)).toEqual([
      [FeedbackType.AI_CONTENT],
      [FeedbackType.QUESTION_ERROR, FeedbackType.AI_CONTENT],
    ]);
  });

  it('should update the status and reply of a report', async () => {
    await service.update(9, { status: FeedbackStatus.CLOSED, reply: '答案无误' });

    expect(feedbacks.update).toHaveBeenCalledWith(9, { status: FeedbackStatus.CLOSED, reply: '答案无误' });
  });

  it('should resolve reports of an errata found finished after linking', async () => {
    errataService.findById
      .mockResolvedValueOnce(errata())
      .mockResolvedValueOnce(errata({ status: ErrataStatus.DONE }))
      .mockResolvedValue(errata({ status: ErrataStatus.DONE }));

    await service.update(9, { errataId: 'e1' });

    expect(feedbacks.update).toHaveBeenCalledWith(9, { errataId: 'e1' });
    expect(feedbacks.update.mock.invocationCallOrder[0]).toBeLessThan(
      feedbacks.resolveByErrata.mock.invocationCallOrder[0],
    );
    expect(feedbacks.resolveByErrata).toHaveBeenCalledWith('e1', '已勘误');
  });

  it('should link a running errata without resolving', async () => {
    await service.update(9, { errataId: 'e1' });

    expect(feedbacks.update).toHaveBeenCalledWith(9, { errataId: 'e1' });
    expect(feedbacks.resolveByErrata).not.toHaveBeenCalled();
  });

  it('should unlink the errata', async () => {
    await service.update(9, { errataId: null });

    expect(errataService.findById).not.toHaveBeenCalled();
    expect(feedbacks.update).toHaveBeenCalledWith(9, { errataId: null });
  });

  it('should reject linking an errata of another question or a missing errata', async () => {
    errataService.findById.mockResolvedValueOnce(errata({ questionId: 'q2' }));
    await expect(service.update(9, { errataId: 'e1' })).rejects.toBeInstanceOf(UnprocessableEntityException);

    errataService.findById.mockRejectedValueOnce(new NotFoundException());
    await expect(service.update(9, { errataId: 'e2' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(feedbacks.update).not.toHaveBeenCalled();
  });

  it('should reject linking an errata to an AI content report', async () => {
    feedbacks.findQuestionReport.mockResolvedValue(report({ type: FeedbackType.AI_CONTENT, questionId: null }));

    await expect(service.update(9, { errataId: 'e1' })).rejects.toMatchObject({
      response: { errors: { errataId: 'errataNotLinkable' } },
    });
  });
});

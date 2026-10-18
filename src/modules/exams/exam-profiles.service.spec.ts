import type { Mocked } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ExamProfilesService } from './exam-profiles.service';
import { UserExamProfileRepository } from './infrastructure/persistence/user-exam-profile.repository';
import { ExamsService } from './exams.service';
import { UserExamProfile } from './domain/user-exam-profile';
import { Exam } from './domain/exam';
import { ContentStatus } from './domain/content-status';

const profile = (overrides: Partial<UserExamProfile> = {}): UserExamProfile =>
  Object.assign(new UserExamProfile(), {
    id: 'p1',
    userId: 7,
    examId: 'e1',
    isCurrent: false,
    examDate: null,
    dailyGoal: 30,
    exam: Object.assign(new Exam(), { id: 'e1', status: ContentStatus.PUBLISHED, icon: null }),
    ...overrides,
  });

describe('ExamProfilesService', () => {
  let repository: Mocked<UserExamProfileRepository>;
  let examsService: { getPublishedExam: ReturnType<typeof vi.fn>; withResolvedIcons: ReturnType<typeof vi.fn> };
  let service: ExamProfilesService;

  beforeEach(() => {
    repository = {
      findManyByUserId: vi.fn(),
      findCurrentByUserId: vi.fn(),
      findByUserIdAndExamId: vi.fn(),
      upsert: vi.fn(),
      markCurrent: vi.fn(),
      remove: vi.fn(),
    };
    examsService = {
      getPublishedExam: vi.fn(),
      withResolvedIcons: vi.fn((exams: Exam[]) => Promise.resolve(exams)),
    };
    service = new ExamProfilesService(repository, examsService as unknown as ExamsService);
  });

  describe('upsert', () => {
    it('should require a published exam for a new follow', async () => {
      repository.findByUserIdAndExamId.mockResolvedValue(null);
      examsService.getPublishedExam.mockRejectedValue(new NotFoundException({ error: 'examNotFound' }));

      await expect(service.upsert(7, 'e1', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('should update an existing follow without checking the exam status', async () => {
      repository.findByUserIdAndExamId.mockResolvedValue(profile());
      repository.upsert.mockResolvedValue(profile({ dailyGoal: 50 }));

      await expect(service.upsert(7, 'e1', { dailyGoal: 50, examDate: '2026-11-29' })).resolves.toMatchObject({
        dailyGoal: 50,
      });
      expect(examsService.getPublishedExam).not.toHaveBeenCalled();
      expect(repository.upsert).toHaveBeenCalledWith(7, 'e1', { examDate: '2026-11-29', dailyGoal: 50 });
    });
  });

  describe('setCurrent', () => {
    it('should throw 404 when the exam is not followed', async () => {
      repository.findByUserIdAndExamId.mockResolvedValue(null);

      await expect(service.setCurrent(7, 'e1')).rejects.toMatchObject({ response: { error: 'examProfileNotFound' } });
    });

    it('should reject an exam that is no longer published', async () => {
      repository.findByUserIdAndExamId.mockResolvedValue(
        profile({ exam: Object.assign(new Exam(), { status: ContentStatus.OFFLINE }) }),
      );

      await expect(service.setCurrent(7, 'e1')).rejects.toMatchObject({ response: { error: 'examNotFound' } });
      expect(repository.markCurrent).not.toHaveBeenCalled();
    });

    it('should mark the followed exam as current', async () => {
      repository.findByUserIdAndExamId
        .mockResolvedValueOnce(profile())
        .mockResolvedValueOnce(profile({ isCurrent: true }));
      repository.markCurrent.mockResolvedValue(true);

      await expect(service.setCurrent(7, 'e1')).resolves.toMatchObject({ isCurrent: true });
      expect(repository.markCurrent).toHaveBeenCalledWith(7, 'e1');
    });
  });

  describe('remove', () => {
    it('should throw 404 when the exam is not followed', async () => {
      repository.remove.mockResolvedValue(false);

      await expect(service.remove(7, 'e1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

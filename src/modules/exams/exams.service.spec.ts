import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExamsService } from './exams.service';
import { ExamRepository } from './infrastructure/persistence/exam.repository';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { FileUrlResolver } from '../files/file-url.resolver';
import { Exam } from './domain/exam';
import { ExamCategory } from './domain/exam-category';
import { ContentStatus } from './domain/content-status';

function exam(overrides: Partial<Exam> = {}): Exam {
  return Object.assign(new Exam(), {
    id: 'e1',
    name: '国考',
    category: ExamCategory.CIVIL_SERVICE,
    icon: null,
    description: null,
    sort: 0,
    status: ContentStatus.PUBLISHED,
    ...overrides,
  });
}

describe('ExamsService', () => {
  let examRepository: Mocked<ExamRepository>;
  let subjectRepository: Mocked<Pick<SubjectRepository, 'countByExamId'>>;
  let fileUrlResolver: { resolveMany: ReturnType<typeof vi.fn> };
  let service: ExamsService;

  beforeEach(() => {
    examRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findManyWithPaginationAndCount: vi.fn(),
      findManyByStatus: vi.fn(),
      update: vi.fn(),
      transitionStatus: vi.fn(),
      removeDraftWithoutSubjects: vi.fn(),
    };
    subjectRepository = { countByExamId: vi.fn() };
    fileUrlResolver = { resolveMany: vi.fn((contents: string[]) => Promise.resolve(contents.map((c) => `url:${c}`))) };
    service = new ExamsService(
      examRepository,
      subjectRepository as unknown as SubjectRepository,
      fileUrlResolver as unknown as FileUrlResolver,
    );
  });

  describe('findPublishedGroups', () => {
    it('should group published exams by category in category order and resolve icons', async () => {
      examRepository.findManyByStatus.mockResolvedValue([
        exam({ id: 'english', category: ExamCategory.COLLEGE_ENGLISH }),
        exam({ id: 'gk', icon: 'file:x' }),
        exam({ id: 'sk' }),
      ]);

      const groups = await service.findPublishedGroups();

      expect(examRepository.findManyByStatus).toHaveBeenCalledWith(ContentStatus.PUBLISHED);
      expect(groups.map((group) => [group.category, group.exams.map((e) => e.id)])).toEqual([
        [ExamCategory.CIVIL_SERVICE, ['gk', 'sk']],
        [ExamCategory.COLLEGE_ENGLISH, ['english']],
      ]);
      expect(groups[0].exams[0].icon).toBe('url:file:x');
      expect(fileUrlResolver.resolveMany).toHaveBeenCalledWith(['file:x']);
    });
  });

  describe('getPublishedExam', () => {
    it('should throw 404 for an exam that is not published', async () => {
      examRepository.findById.mockResolvedValue(exam({ status: ContentStatus.OFFLINE }));

      await expect(service.getPublishedExam('e1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a draft with default sort', async () => {
      examRepository.create.mockResolvedValue(exam({ status: ContentStatus.DRAFT }));

      await service.create({ name: '国考', category: ExamCategory.CIVIL_SERVICE });

      expect(examRepository.create).toHaveBeenCalledWith({
        name: '国考',
        category: ExamCategory.CIVIL_SERVICE,
        icon: null,
        description: null,
        sort: 0,
        status: ContentStatus.DRAFT,
      });
    });
  });

  describe('changeStatus', () => {
    it('should publish from draft or offline', async () => {
      examRepository.transitionStatus.mockResolvedValue(true);
      examRepository.findById.mockResolvedValue(exam());

      await expect(service.changeStatus('e1', ContentStatus.PUBLISHED)).resolves.toMatchObject({
        status: ContentStatus.PUBLISHED,
      });
      expect(examRepository.transitionStatus).toHaveBeenCalledWith(
        'e1',
        [ContentStatus.DRAFT, ContentStatus.OFFLINE],
        ContentStatus.PUBLISHED,
      );
    });

    it('should reject taking a draft offline', async () => {
      examRepository.transitionStatus.mockResolvedValue(false);
      examRepository.findById.mockResolvedValue(exam({ status: ContentStatus.DRAFT }));

      await expect(service.changeStatus('e1', ContentStatus.OFFLINE)).rejects.toBeInstanceOf(ConflictException);
    });

    it('should throw 404 for a missing exam', async () => {
      examRepository.transitionStatus.mockResolvedValue(false);
      examRepository.findById.mockResolvedValue(null);

      await expect(service.changeStatus('e1', ContentStatus.OFFLINE)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should reject a published exam', async () => {
      examRepository.findById.mockResolvedValue(exam());

      await expect(service.remove('e1')).rejects.toMatchObject({ response: { error: 'onlyDraftDeletable' } });
      expect(examRepository.removeDraftWithoutSubjects).not.toHaveBeenCalled();
    });

    it('should reject a draft with subjects', async () => {
      examRepository.findById.mockResolvedValue(exam({ status: ContentStatus.DRAFT }));
      subjectRepository.countByExamId.mockResolvedValue(1);

      await expect(service.remove('e1')).rejects.toMatchObject({ response: { error: 'examHasSubjects' } });
    });

    it('should delete a draft without subjects', async () => {
      examRepository.findById.mockResolvedValue(exam({ status: ContentStatus.DRAFT }));
      subjectRepository.countByExamId.mockResolvedValue(0);
      examRepository.removeDraftWithoutSubjects.mockResolvedValue(true);

      await expect(service.remove('e1')).resolves.toBeUndefined();
    });
  });
});

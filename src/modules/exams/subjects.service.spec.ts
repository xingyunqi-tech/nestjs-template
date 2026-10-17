import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { ExamRepository } from './infrastructure/persistence/exam.repository';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { Subject } from './domain/subject';
import { Exam } from './domain/exam';
import { ContentStatus } from './domain/content-status';

const subject = (overrides: Partial<Subject> = {}): Subject =>
  Object.assign(new Subject(), { id: 's1', examId: 'e1', status: ContentStatus.PUBLISHED, ...overrides });
const exam = (status: ContentStatus): Exam => Object.assign(new Exam(), { id: 'e1', status });

describe('SubjectsService', () => {
  let subjectRepository: Mocked<SubjectRepository>;
  let examRepository: Mocked<Pick<ExamRepository, 'findById'>>;
  let knowledgePointRepository: Mocked<Pick<KnowledgePointRepository, 'countBySubjectId'>>;
  let service: SubjectsService;

  beforeEach(() => {
    subjectRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findManyWithPaginationAndCount: vi.fn(),
      findManyByExamIdAndStatus: vi.fn(),
      countByExamId: vi.fn(),
      update: vi.fn(),
      transitionStatus: vi.fn(),
      removeDraftWithoutKnowledgePoints: vi.fn(),
    };
    examRepository = { findById: vi.fn() };
    knowledgePointRepository = { countBySubjectId: vi.fn() };
    service = new SubjectsService(
      subjectRepository,
      examRepository as unknown as ExamRepository,
      knowledgePointRepository as unknown as KnowledgePointRepository,
    );
  });

  describe('findPublishedByExamId', () => {
    it('should list published subjects of a published exam', async () => {
      examRepository.findById.mockResolvedValue(exam(ContentStatus.PUBLISHED));
      subjectRepository.findManyByExamIdAndStatus.mockResolvedValue([subject()]);

      await expect(service.findPublishedByExamId('e1')).resolves.toHaveLength(1);
      expect(subjectRepository.findManyByExamIdAndStatus).toHaveBeenCalledWith('e1', ContentStatus.PUBLISHED);
    });

    it('should throw 404 when the exam is offline', async () => {
      examRepository.findById.mockResolvedValue(exam(ContentStatus.OFFLINE));

      await expect(service.findPublishedByExamId('e1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPublishedSubject', () => {
    it('should throw 404 when the subject is offline', async () => {
      subjectRepository.findById.mockResolvedValue(subject({ status: ContentStatus.OFFLINE }));

      await expect(service.getPublishedSubject('s1')).rejects.toBeInstanceOf(NotFoundException);
      expect(examRepository.findById).not.toHaveBeenCalled();
    });

    it('should throw 404 when the exam of the subject is not published', async () => {
      subjectRepository.findById.mockResolvedValue(subject());
      examRepository.findById.mockResolvedValue(exam(ContentStatus.DRAFT));

      await expect(service.getPublishedSubject('s1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should return a published subject of a published exam', async () => {
      subjectRepository.findById.mockResolvedValue(subject());
      examRepository.findById.mockResolvedValue(exam(ContentStatus.PUBLISHED));

      await expect(service.getPublishedSubject('s1')).resolves.toMatchObject({ id: 's1' });
    });
  });

  describe('create', () => {
    it('should reject an unknown exam', async () => {
      examRepository.findById.mockResolvedValue(null);

      await expect(service.create({ examId: 'e1', name: '行测' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should create a draft subject', async () => {
      examRepository.findById.mockResolvedValue(exam(ContentStatus.DRAFT));
      subjectRepository.create.mockResolvedValue(subject({ status: ContentStatus.DRAFT }));

      await service.create({ examId: 'e1', name: '行测' });

      expect(subjectRepository.create).toHaveBeenCalledWith({
        examId: 'e1',
        name: '行测',
        sort: 0,
        hasSubjective: false,
        status: ContentStatus.DRAFT,
      });
    });
  });

  describe('remove', () => {
    it('should reject a draft subject with knowledge points', async () => {
      subjectRepository.findById.mockResolvedValue(subject({ status: ContentStatus.DRAFT }));
      knowledgePointRepository.countBySubjectId.mockResolvedValue(2);

      await expect(service.remove('s1')).rejects.toMatchObject({ response: { error: 'subjectHasKnowledgePoints' } });
    });

    it('should reject an offline subject', async () => {
      subjectRepository.findById.mockResolvedValue(subject({ status: ContentStatus.OFFLINE }));

      await expect(service.remove('s1')).rejects.toMatchObject({ response: { error: 'onlyDraftDeletable' } });
    });
  });
});

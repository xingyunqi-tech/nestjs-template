import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { KnowledgePointsService } from './knowledge-points.service';
import { KnowledgePointRepository } from './infrastructure/persistence/knowledge-point.repository';
import { SubjectRepository } from './infrastructure/persistence/subject.repository';
import { SubjectsService } from './subjects.service';
import { KnowledgePoint } from './domain/knowledge-point';
import { KnowledgePointViolation } from './domain/knowledge-point-rules';
import { Subject } from './domain/subject';

const point = (overrides: Partial<KnowledgePoint> = {}): KnowledgePoint =>
  Object.assign(new KnowledgePoint(), {
    id: 'k1',
    subjectId: 's1',
    parentId: null,
    name: 'K',
    level: 1,
    sort: 0,
    path: '/k1/',
    isLeaf: true,
    questionCount: 0,
    ...overrides,
  });

describe('KnowledgePointsService', () => {
  let repository: Mocked<KnowledgePointRepository>;
  let subjectRepository: Mocked<Pick<SubjectRepository, 'findById'>>;
  let subjectsService: { getPublishedSubject: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let service: KnowledgePointsService;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findByIds: vi.fn(),
      findManyBySubjectId: vi.fn(),
      countBySubjectId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      remove: vi.fn(),
      adjustQuestionCounts: vi.fn(),
      migrateQuestions: vi.fn(),
    };
    subjectRepository = { findById: vi.fn() };
    subjectsService = { getPublishedSubject: vi.fn(), findById: vi.fn() };
    service = new KnowledgePointsService(
      repository,
      subjectRepository as unknown as SubjectRepository,
      subjectsService as unknown as SubjectsService,
    );
  });

  describe('getPublishedTree', () => {
    it('should return the tree of a published subject with empty progress', async () => {
      subjectsService.getPublishedSubject.mockResolvedValue({ id: 's1' });
      repository.findManyBySubjectId.mockResolvedValue([
        point(),
        point({ id: 'k2', parentId: 'k1', level: 2, path: '/k1/k2/' }),
      ]);

      const tree = await service.getPublishedTree('s1');

      expect(tree).toHaveLength(1);
      expect(tree[0]).toMatchObject({ id: 'k1', progress: null, children: [{ id: 'k2', progress: null }] });
    });

    it('should propagate 404 for an unpublished subject', async () => {
      subjectsService.getPublishedSubject.mockRejectedValue(new NotFoundException());

      await expect(service.getPublishedTree('s1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findManyBySubjectId).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    beforeEach(() => {
      subjectRepository.findById.mockResolvedValue(Object.assign(new Subject(), { id: 's1' }));
    });

    it('should reject an unknown subject', async () => {
      subjectRepository.findById.mockResolvedValue(null);

      await expect(service.create({ subjectId: 's1', name: 'K' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should create a root node by default', async () => {
      repository.create.mockResolvedValue({ ok: true, value: point() });

      await expect(service.create({ subjectId: 's1', name: 'K' })).resolves.toMatchObject({ id: 'k1' });
      expect(repository.create).toHaveBeenCalledWith({ subjectId: 's1', parentId: null, name: 'K', sort: 0 });
    });

    it('should reject a child under a node with questions with 409', async () => {
      repository.create.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.HAS_QUESTIONS });

      await expect(service.create({ subjectId: 's1', parentId: 'k1', name: 'K' })).rejects.toMatchObject({
        status: 409,
        response: { error: 'knowledgePointHasQuestions' },
      });
    });

    it('should reject a fourth level with 422 on parentId', async () => {
      repository.create.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.TOO_DEEP });

      await expect(service.create({ subjectId: 's1', parentId: 'k3', name: 'K' })).rejects.toMatchObject({
        status: 422,
        response: { errors: { parentId: 'knowledgePointTooDeep' } },
      });
    });
  });

  describe('move', () => {
    it('should throw 404 for a missing node', async () => {
      repository.move.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.NOT_FOUND });

      await expect(service.move('k1', { parentId: null })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should pass the target parent and sort to the repository', async () => {
      repository.move.mockResolvedValue({ ok: true, value: point({ parentId: 'k2' }) });

      await service.move('k1', { parentId: 'k2', sort: 3 });

      expect(repository.move).toHaveBeenCalledWith('k1', 'k2', 3);
    });
  });

  describe('remove', () => {
    it('should reject a node with questions with 409', async () => {
      repository.remove.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.HAS_QUESTIONS });

      await expect(service.remove('k1')).rejects.toBeInstanceOf(ConflictException);
      expect(repository.remove).toHaveBeenCalledWith('k1');
    });

    it('should reject a node with children with 409', async () => {
      repository.remove.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.HAS_CHILDREN });

      await expect(service.remove('k1')).rejects.toMatchObject({ response: { error: 'knowledgePointHasChildren' } });
    });
  });

  describe('migrateQuestions', () => {
    it.each([KnowledgePointViolation.INVALID_MIGRATION_TARGET, KnowledgePointViolation.MIGRATION_TARGET_NOT_LEAF])(
      'should report %s on targetId with 422',
      async (violation) => {
        repository.migrateQuestions.mockResolvedValue({ ok: false, violation });

        await expect(service.migrateQuestions('k1', { targetId: 'k2' })).rejects.toMatchObject({
          status: 422,
          response: { errors: { targetId: violation } },
        });
      },
    );

    it('should throw 404 for a missing source', async () => {
      repository.migrateQuestions.mockResolvedValue({ ok: false, violation: KnowledgePointViolation.NOT_FOUND });

      await expect(service.migrateQuestions('k1', { targetId: 'k2' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should return the migration result', async () => {
      const value = { migrated: 5, source: point(), target: point({ id: 'k2' }) };
      repository.migrateQuestions.mockResolvedValue({ ok: true, value });

      await expect(service.migrateQuestions('k1', { targetId: 'k2' })).resolves.toBe(value);
      expect(repository.migrateQuestions).toHaveBeenCalledWith('k1', 'k2');
    });
  });

  describe('foreign key races', () => {
    it('should map a foreign key violation on create to 409', async () => {
      subjectRepository.findById.mockResolvedValue(Object.assign(new Subject(), { id: 's1' }));
      repository.create.mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));

      await expect(service.create({ subjectId: 's1', name: 'K' })).rejects.toMatchObject({
        status: 409,
        response: { error: 'conflict' },
      });
    });
  });
});

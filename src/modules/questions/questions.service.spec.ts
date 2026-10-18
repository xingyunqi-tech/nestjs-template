import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import {
  CreateQuestionData,
  CreateQuestionVersionData,
  KnowledgePointCountDelta,
  QuestionChanges,
  QuestionRepository,
  QuestionTransaction,
  TaggableKnowledgePoint,
} from './infrastructure/persistence/question.repository';
import { QuestionUsageRepository } from './infrastructure/persistence/question-usage.repository';
import { Question } from './domain/question';
import { QuestionType } from './domain/question-type';
import { QuestionAction, QuestionStatus } from './domain/question-status';
import { QuestionSource } from './domain/question-source';
import { QuestionChangeType, QuestionVersion } from './domain/question-version';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QuestionImportItem, QuestionImportItemError } from './question-import';
import { SubjectsService } from '../exams/subjects.service';
import { FilesService } from '../files/files.service';
import { FileUrlResolver } from '../files/file-url.resolver';
import { FileVisibility } from '../files/domain/file-visibility';
import { BusinessException } from '../../common/exceptions/business.exception';

const SUBJECT = 's1';
const PUBLIC_FILE = '11111111-1111-4111-8111-111111111111';
const PRIVATE_FILE = '22222222-2222-4222-8222-222222222222';
const MISSING_FILE = '33333333-3333-4333-8333-333333333333';
const PUBLIC_URL = 'https://cdn.example.com/p.png';
const FILES = [
  { id: PUBLIC_FILE, path: '/p.png', visibility: FileVisibility.PUBLIC },
  { id: PRIVATE_FILE, path: '/q.png', visibility: FileVisibility.PRIVATE },
];
const OPTIONS = [
  { key: 'A', content: '甲' },
  { key: 'B', content: '乙' },
];

class FakeStore implements QuestionTransaction {
  questions = new Map<string, Question>();
  points: TaggableKnowledgePoint[] = [
    { id: 'leaf1', subjectId: SUBJECT, isLeaf: true },
    { id: 'leaf2', subjectId: SUBJECT, isLeaf: true },
    { id: 'branch', subjectId: SUBJECT, isLeaf: false },
  ];
  versions: CreateQuestionVersionData[] = [];
  deltas: KnowledgePointCountDelta[] = [];
  removed: string[] = [];
  private sequence = 0;

  async atomically<T>(work: () => Promise<T>): Promise<T> {
    const backup = {
      questions: structuredClone(this.questions),
      versions: structuredClone(this.versions),
      deltas: structuredClone(this.deltas),
    };
    try {
      return await work();
    } catch (error) {
      Object.assign(this, backup);
      throw error;
    }
  }

  snapshot(id: string): Question {
    return Object.assign(new Question(), structuredClone(this.questions.get(id)));
  }

  findForUpdate(ids: string[]): Promise<Question[]> {
    return Promise.resolve(ids.filter((id) => this.questions.has(id)).map((id) => this.snapshot(id)));
  }

  findChildrenForUpdate(parentIds: string[]): Promise<Question[]> {
    return Promise.resolve(
      [...this.questions.values()]
        .filter((question) => question.parentId !== null && parentIds.includes(question.parentId))
        .sort((a, b) => a.sort - b.sort)
        .map((question) => this.snapshot(question.id)),
    );
  }

  findKnowledgePointsForUpdate(ids: string[]): Promise<TaggableKnowledgePoint[]> {
    return Promise.resolve(this.points.filter((point) => ids.includes(point.id)));
  }

  findIdByContentHash(subjectId: string, contentHash: string, excludeIds: string[]): Promise<string | null> {
    const found = [...this.questions.values()].find(
      (question) =>
        question.subjectId === subjectId && question.contentHash === contentHash && !excludeIds.includes(question.id),
    );
    return Promise.resolve(found?.id ?? null);
  }

  maxChildSort(parentId: string): Promise<number | null> {
    const sorts = [...this.questions.values()].filter((q) => q.parentId === parentId).map((q) => q.sort);
    return Promise.resolve(sorts.length > 0 ? Math.max(...sorts) : null);
  }

  insert(data: CreateQuestionData): Promise<Question> {
    const id = `q${++this.sequence}`;
    const question = Object.assign(new Question(), {
      ...structuredClone(data),
      id,
      currentVersion: 0,
      knowledgePointIds: [],
      statAnswered: 0,
      statCorrect: 0,
    });
    this.questions.set(id, question);
    return Promise.resolve(this.snapshot(id));
  }

  update(ids: string[], changes: QuestionChanges): Promise<void> {
    for (const id of ids) {
      Object.assign(this.questions.get(id)!, structuredClone(changes));
    }
    return Promise.resolve();
  }

  replaceKnowledgePoints(questionId: string, knowledgePointIds: string[]): Promise<void> {
    this.questions.get(questionId)!.knowledgePointIds = [...knowledgePointIds];
    return Promise.resolve();
  }

  insertVersion(data: CreateQuestionVersionData): Promise<void> {
    this.versions.push(structuredClone(data));
    return Promise.resolve();
  }

  adjustQuestionCounts(deltas: KnowledgePointCountDelta[]): Promise<void> {
    this.deltas.push(...deltas);
    return Promise.resolve();
  }

  remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.questions.delete(id);
      this.removed.push(id);
    }
    return Promise.resolve();
  }
}

const singleDto = (overrides: Partial<CreateQuestionDto> = {}): CreateQuestionDto => ({
  subjectId: SUBJECT,
  type: QuestionType.SINGLE,
  stem: '下列说法正确的是',
  options: OPTIONS,
  answer: { keys: ['B'] },
  analysis: '解析',
  knowledgePointIds: ['leaf1'],
  ...overrides,
});

const materialDto = (material = '资料内容'): CreateQuestionDto => ({
  subjectId: SUBJECT,
  type: QuestionType.MATERIAL,
  stem: '根据资料回答问题',
  material,
});

describe('QuestionsService', () => {
  let store: FakeStore;
  let usage: Mocked<QuestionUsageRepository>;
  let findDrawCandidates: Mocked<QuestionRepository>['findDrawCandidates'];
  let subjectsService: Mocked<Pick<SubjectsService, 'findById'>>;
  let filesService: Mocked<Pick<FilesService, 'findByIds' | 'canAccess'>>;
  let repository: QuestionRepository;
  let fileUrlResolver: Mocked<Pick<FileUrlResolver, 'resolveUrls'>>;
  let service: QuestionsService;

  beforeEach(() => {
    store = new FakeStore();
    findDrawCandidates = vi.fn();
    repository = {
      findById: (id) => Promise.resolve(store.questions.has(id) ? store.snapshot(id) : null),
      findByIds: (ids) => store.findForUpdate(ids),
      findSummariesByIds: (ids) =>
        store
          .findForUpdate(ids)
          .then((found) => found.map(({ id, parentId, type, stem }) => ({ id, parentId, type, stem }))),
      findChildren: (parentId) => store.findChildrenForUpdate([parentId]),
      findChildrenByParentIds: (parentIds) => store.findChildrenForUpdate(parentIds),
      findDrawCandidates,
      findManyWithPaginationAndCount: vi.fn(),
      findVersions: vi.fn(),
      transaction: (_subjectIds, work) => store.atomically(() => work(store)),
    };
    usage = { isUsed: vi.fn().mockResolvedValue(false) };
    subjectsService = { findById: vi.fn().mockResolvedValue({ id: SUBJECT }) };
    filesService = {
      findByIds: vi.fn((ids: string[]) => Promise.resolve(FILES.filter((file) => ids.includes(file.id)))),
      canAccess: vi.fn((file: { visibility?: FileVisibility }) => file.visibility !== FileVisibility.PRIVATE),
    };
    fileUrlResolver = {
      resolveUrls: vi.fn((ids: string[]) =>
        Promise.resolve<Record<string, string>>(ids.includes(PUBLIC_FILE) ? { [PUBLIC_FILE]: PUBLIC_URL } : {}),
      ),
    };
    service = new QuestionsService(
      repository,
      usage,
      subjectsService as unknown as SubjectsService,
      filesService as unknown as FilesService,
      fileUrlResolver as unknown as FileUrlResolver,
    );
  });

  const create = (dto: CreateQuestionDto) => service.create(dto, 1);
  const act = (id: string, action: QuestionAction) => service.changeStatus(id, action, 1);
  const publish = async (id: string) => {
    await act(id, QuestionAction.SUBMIT);
    return act(id, QuestionAction.PUBLISH);
  };

  describe('create', () => {
    it('should create a draft without versions', async () => {
      const created = await create(singleDto({ source: QuestionSource.PUBLIC }));

      expect(created).toMatchObject({
        status: QuestionStatus.DRAFT,
        currentVersion: 0,
        knowledgePointIds: ['leaf1'],
        source: QuestionSource.PUBLIC,
        difficulty: 3,
      });
      expect(store.versions).toHaveLength(0);
    });

    it('should reject a duplicate standalone question', async () => {
      const first = await create(singleDto());

      await expect(create(singleDto({ stem: ' 下列说法正确的是 ' }))).rejects.toMatchObject({
        response: { error: 'duplicateQuestion', errors: { duplicateQuestionId: first.id } },
      });
    });

    it('should accept the same sub-question stem under different materials', async () => {
      const first = await create(materialDto('第一段听力'));
      const second = await create(materialDto('第二段听力'));
      const stem = { stem: 'What does the man mean?', knowledgePointIds: [] };

      await create(singleDto({ ...stem, parentId: first.id }));
      await expect(create(singleDto({ ...stem, parentId: second.id }))).resolves.toMatchObject({
        parentId: second.id,
      });
      await expect(create(singleDto({ ...stem, parentId: first.id }))).rejects.toBeInstanceOf(ConflictException);
    });

    it('should append sub-questions in order and inherit isFree from the material', async () => {
      const material = await create({ ...materialDto(), isFree: false });
      const a = await create(singleDto({ parentId: material.id, stem: '第一题', isFree: true }));
      const b = await create(singleDto({ parentId: material.id, stem: '第二题' }));

      expect([a.sort, b.sort]).toEqual([0, 1]);
      expect([a.isFree, b.isFree]).toEqual([false, false]);
    });

    it('should only tag leaf knowledge points of the same subject', async () => {
      await expect(create(singleDto({ knowledgePointIds: ['branch'] }))).rejects.toMatchObject({
        response: { errors: { knowledgePointIds: 'questionKnowledgePointNotLeaf' } },
      });
      await expect(create(singleDto({ knowledgePointIds: ['missing'] }))).rejects.toMatchObject({
        response: { errors: { knowledgePointIds: 'invalidKnowledgePoint' } },
      });
    });

    it('should reject sub-questions under a material that is not a draft', async () => {
      const material = await create(materialDto());
      await create(singleDto({ parentId: material.id }));
      await act(material.id, QuestionAction.SUBMIT);

      await expect(create(singleDto({ parentId: material.id, stem: '新小题' }))).rejects.toMatchObject({
        response: { error: 'materialNotDraft' },
      });
    });

    it('should accept existing public file references', async () => {
      await expect(
        create({ ...materialDto(), material: `![](file:${PUBLIC_FILE})`, audioFileId: PUBLIC_FILE }),
      ).resolves.toMatchObject({ audioFileId: PUBLIC_FILE });
    });

    it('should reject missing or private file references with the field name', async () => {
      await expect(create(singleDto({ stem: `看图 file:${MISSING_FILE}` }))).rejects.toMatchObject({
        response: { errors: { stem: 'fileNotFound' } },
      });
      await expect(
        create(singleDto({ options: [{ key: 'A', content: `file:${PRIVATE_FILE}` }, OPTIONS[1]] })),
      ).rejects.toMatchObject({ response: { errors: { options: 'fileNotAccessible' } } });
      await expect(create(singleDto({ analysis: `file:${PRIVATE_FILE}` }))).rejects.toMatchObject({
        response: { errors: { analysis: 'fileNotAccessible' } },
      });
      await expect(create({ ...materialDto(), audioFileId: MISSING_FILE })).rejects.toMatchObject({
        response: { errors: { audioFileId: 'fileNotFound' } },
      });
    });

    it('should only check file references of the fields being updated', async () => {
      const { id } = await create(singleDto());

      await expect(service.update(id, { analysis: `file:${MISSING_FILE}` }, 1)).rejects.toMatchObject({
        response: { errors: { analysis: 'fileNotFound' } },
      });
      await service.update(id, { difficulty: 4 }, 1);
      expect(filesService.findByIds).toHaveBeenCalledTimes(1);
    });

    it('should map a missing subject to 422', async () => {
      subjectsService.findById.mockRejectedValue(new NotFoundException({ error: 'subjectNotFound' }));

      await expect(create(singleDto())).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('status transitions', () => {
    it('should write v1 and count knowledge points on first publish', async () => {
      const { id } = await create(singleDto({ knowledgePointIds: ['leaf1', 'leaf2'] }));

      const published = await publish(id);

      expect(published).toMatchObject({ status: QuestionStatus.PUBLISHED, currentVersion: 1 });
      expect(store.versions).toEqual([
        expect.objectContaining({ questionId: id, version: 1, changeType: QuestionChangeType.PUBLISH }),
      ]);
      expect(store.deltas).toEqual([
        { knowledgePointId: 'leaf1', delta: 1 },
        { knowledgePointId: 'leaf2', delta: 1 },
      ]);
    });

    it('should not write a new version when republishing an offline question', async () => {
      const { id } = await create(singleDto());
      await publish(id);
      await act(id, QuestionAction.OFFLINE);
      await act(id, QuestionAction.PUBLISH);

      expect(store.versions).toHaveLength(1);
      expect(store.deltas.map((d) => d.delta)).toEqual([1, -1, 1]);
    });

    it('should reject invalid transitions', async () => {
      const { id } = await create(singleDto());

      await expect(act(id, QuestionAction.PUBLISH)).rejects.toMatchObject({
        response: { error: 'invalidStatusTransition' },
      });
      await act(id, QuestionAction.SUBMIT);
      await act(id, QuestionAction.REJECT);
      expect(store.questions.get(id)!.status).toBe(QuestionStatus.DRAFT);
    });

    it('should move a material and all sub-questions together', async () => {
      const material = await create(materialDto());
      const a = await create(singleDto({ parentId: material.id, stem: '第一题', knowledgePointIds: ['leaf1'] }));
      const b = await create(singleDto({ parentId: material.id, stem: '第二题', knowledgePointIds: ['leaf2'] }));

      const published = await publish(material.id);

      expect(published.children?.map((child) => child.status)).toEqual([
        QuestionStatus.PUBLISHED,
        QuestionStatus.PUBLISHED,
      ]);
      expect(store.versions.map((version) => version.questionId).sort()).toEqual([material.id, a.id, b.id].sort());
      expect(store.deltas).toEqual([
        { knowledgePointId: 'leaf1', delta: 1 },
        { knowledgePointId: 'leaf2', delta: 1 },
      ]);

      await act(material.id, QuestionAction.OFFLINE);
      expect([a.id, b.id].map((id) => store.questions.get(id)!.status)).toEqual([
        QuestionStatus.OFFLINE,
        QuestionStatus.OFFLINE,
      ]);
    });

    it('should reject changing the status of a single sub-question', async () => {
      const material = await create(materialDto());
      const sub = await create(singleDto({ parentId: material.id }));

      await expect(act(sub.id, QuestionAction.SUBMIT)).rejects.toMatchObject({
        response: { error: 'subQuestionStatusLocked' },
      });
    });

    it('should reject submitting a material without sub-questions', async () => {
      const material = await create(materialDto());

      await expect(act(material.id, QuestionAction.SUBMIT)).rejects.toMatchObject({
        response: { error: 'materialHasNoSubQuestions' },
      });
    });

    it('should batch publish whole material groups when given a sub-question', async () => {
      const material = await create(materialDto());
      const sub = await create(singleDto({ parentId: material.id }));
      const standalone = await create(singleDto({ stem: '独立题' }));
      await act(material.id, QuestionAction.SUBMIT);
      await act(standalone.id, QuestionAction.SUBMIT);

      await expect(service.batchPublish({ ids: [sub.id, standalone.id] })).resolves.toEqual({ count: 3 });
      expect(store.questions.get(material.id)!.status).toBe(QuestionStatus.PUBLISHED);
    });

    it('should publish nothing when any question in the batch is not under review', async () => {
      const reviewing = await create(singleDto());
      const draft = await create(singleDto({ stem: '草稿' }));
      await act(reviewing.id, QuestionAction.SUBMIT);

      await expect(service.batchPublish({ ids: [reviewing.id, draft.id] })).rejects.toBeInstanceOf(ConflictException);
      await expect(service.batchPublish({ ids: [reviewing.id, 'missing'] })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a draft directly without versions', async () => {
      const { id } = await create(singleDto());

      const updated = await service.update(
        id,
        { answer: { keys: ['A'] }, type: QuestionType.SINGLE, stem: '新题干' },
        1,
      );

      expect(updated).toMatchObject({ stem: '新题干', answer: { keys: ['A'] }, currentVersion: 0 });
      expect(store.versions).toHaveLength(0);
    });

    it('should create an EDIT version when a published question is edited', async () => {
      const { id } = await create(singleDto());
      await publish(id);

      const updated = await service.update(id, { stem: '下列说法正确的是（修订）' }, 1);

      expect(updated.currentVersion).toBe(2);
      expect(store.versions.map((version) => [version.version, version.changeType, version.stem])).toEqual([
        [1, QuestionChangeType.PUBLISH, '下列说法正确的是'],
        [2, QuestionChangeType.EDIT, '下列说法正确的是（修订）'],
      ]);
    });

    it('should not create a version when only metadata changes', async () => {
      const { id } = await create(singleDto());
      await publish(id);

      await expect(service.update(id, { difficulty: 5 }, 1)).resolves.toMatchObject({
        difficulty: 5,
        currentVersion: 1,
      });
      expect(store.versions).toHaveLength(1);
    });

    it('should reject answer, type and option key changes after publishing', async () => {
      const { id } = await create(singleDto());
      await publish(id);

      for (const dto of [
        { answer: { keys: ['A'] } },
        { type: QuestionType.MULTIPLE },
        { options: [...OPTIONS, { key: 'C', content: '丙' }] },
      ]) {
        await expect(service.update(id, dto, 1)).rejects.toBeInstanceOf(BusinessException);
      }
      await expect(service.update(id, { answer: { keys: ['A'] } }, 1)).rejects.toMatchObject({
        errorKey: 'answerChangeNotAllowed',
      });
    });

    it('should reject changing the number of blanks of a published fill question', async () => {
      const { id } = await create(
        singleDto({ type: QuestionType.FILL, options: null, answer: { blanks: [['一'], ['二']] }, stem: '填空' }),
      );
      await publish(id);

      await expect(service.update(id, { answer: { blanks: [['一']] } }, 1)).rejects.toMatchObject({
        errorKey: 'answerChangeNotAllowed',
      });
    });

    it('should record the material version in sub-question snapshots', async () => {
      const material = await create(materialDto('资料'));
      const sub = await create(singleDto({ parentId: material.id }));
      await publish(material.id);

      expect(store.versions.map((v) => [v.questionId, v.version, v.materialVersion])).toEqual([
        [material.id, 1, null],
        [sub.id, 1, 1],
      ]);

      await service.update(material.id, { material: '资料（修订）' }, 1);
      expect(store.versions.filter((v) => v.questionId === sub.id)).toHaveLength(1);
      expect(store.versions.at(-1)).toMatchObject({ questionId: material.id, version: 2, materialVersion: null });

      await service.update(sub.id, { stem: '小题（修订）' }, 1);
      expect(store.versions.at(-1)).toMatchObject({ questionId: sub.id, version: 2, materialVersion: 2 });
    });

    it('should move knowledge point counts when the tags of a published question change', async () => {
      const { id } = await create(singleDto({ knowledgePointIds: ['leaf1'] }));
      await publish(id);
      store.deltas = [];

      await service.update(id, { knowledgePointIds: ['leaf2'] }, 1);

      expect(store.deltas).toEqual([
        { knowledgePointId: 'leaf1', delta: -1 },
        { knowledgePointId: 'leaf2', delta: 1 },
      ]);
      expect(store.versions.at(-1)).toMatchObject({ version: 2, knowledgePointIds: ['leaf2'] });
    });

    it('should not touch counts when the tags of a draft change', async () => {
      const { id } = await create(singleDto());

      await service.update(id, { knowledgePointIds: ['leaf2'] }, 1);

      expect(store.deltas).toEqual([]);
    });

    it('should reject editing a question under review', async () => {
      const { id } = await create(singleDto());
      await act(id, QuestionAction.SUBMIT);

      await expect(service.update(id, { stem: 'x' }, 1)).rejects.toMatchObject({
        response: { error: 'questionUnderReview' },
      });
    });

    it('should reject an edit that duplicates another question', async () => {
      await create(singleDto({ stem: '甲题' }));
      const { id } = await create(singleDto({ stem: '乙题' }));

      await expect(service.update(id, { stem: '甲题' }, 1)).rejects.toMatchObject({
        response: { error: 'duplicateQuestion' },
      });
    });

    it('should propagate material hash and isFree to sub-questions', async () => {
      const material = await create(materialDto('旧资料'));
      const sub = await create(singleDto({ parentId: material.id }));
      const oldHash = store.questions.get(sub.id)!.contentHash;

      await service.update(material.id, { material: '新资料', isFree: false }, 1);

      expect(store.questions.get(sub.id)).toMatchObject({ isFree: false });
      expect(store.questions.get(sub.id)!.contentHash).not.toBe(oldHash);
    });

    it('should reject converting between material and other types', async () => {
      const { id } = await create(singleDto());

      await expect(
        service.update(id, { type: QuestionType.MATERIAL, options: null, answer: null, material: '资料' }, 1),
      ).rejects.toMatchObject({ response: { errors: { type: 'materialTypeImmutable' } } });
    });
  });

  describe('remove', () => {
    it('should delete a draft material together with its sub-questions', async () => {
      const material = await create(materialDto());
      const sub = await create(singleDto({ parentId: material.id }));

      await service.remove(material.id);

      expect(store.removed).toEqual([material.id, sub.id]);
    });

    it('should reject deleting questions that are not drafts', async () => {
      const { id } = await create(singleDto());
      await act(id, QuestionAction.SUBMIT);

      await expect(service.remove(id)).rejects.toMatchObject({ response: { error: 'onlyDraftDeletable' } });
    });

    it('should reject deleting questions in use', async () => {
      const { id } = await create(singleDto());
      usage.isUsed.mockResolvedValue(true);

      await expect(service.remove(id)).rejects.toMatchObject({ response: { error: 'questionInUse' } });
      expect(usage.isUsed).toHaveBeenCalledWith([id]);
    });
  });

  describe('question units', () => {
    const createMaterial = async (): Promise<{ materialId: string; childIds: string[] }> => {
      const material = await create(materialDto());
      const first = await create(singleDto({ parentId: material.id, stem: '第一小题', sort: 0 }));
      const second = await create(singleDto({ parentId: material.id, stem: '第二小题', sort: 1 }));
      await publish(material.id);
      return { materialId: material.id, childIds: [first.id, second.id] };
    };

    it('should return summaries in the given order and skip missing ids', async () => {
      const single = await create(singleDto());
      const { materialId, childIds } = await createMaterial();

      await expect(service.findSummariesByIds([childIds[1], 'missing', single.id, childIds[1]])).resolves.toEqual([
        { id: childIds[1], parentId: materialId, type: QuestionType.SINGLE, stem: '第二小题' },
        { id: single.id, parentId: null, type: QuestionType.SINGLE, stem: '下列说法正确的是' },
        { id: childIds[1], parentId: materialId, type: QuestionType.SINGLE, stem: '第二小题' },
      ]);
    });

    it('should build units in the given order and skip sub-questions', async () => {
      const single = await create(singleDto());
      const { materialId, childIds } = await createMaterial();

      const units = await service.findUnits([materialId, childIds[0], single.id, 'missing']);

      expect(units.map((unit) => [unit.root.id, unit.questions.map((question) => question.id)])).toEqual([
        [materialId, childIds],
        [single.id, [single.id]],
      ]);
    });

    it('should rebuild units from answerable question ids', async () => {
      const single = await create(singleDto());
      const { materialId, childIds } = await createMaterial();

      const units = await service.findUnitsByQuestionIds([single.id, ...childIds]);

      expect(units.map((unit) => unit.root.id)).toEqual([single.id, materialId]);
      expect(units[1].questions.map((question) => question.id)).toEqual(childIds);
    });

    it('should draw units packed to the target size', async () => {
      const single = await create(singleDto());
      const { materialId } = await createMaterial();
      findDrawCandidates.mockResolvedValue([
        { id: materialId, size: 2 },
        { id: single.id, size: 1 },
      ]);

      const units = await service.drawUnits({ subjectId: SUBJECT }, 2);

      expect(units.map((unit) => unit.root.id)).toEqual([materialId]);
      expect(findDrawCandidates).toHaveBeenCalledWith({ subjectId: SUBJECT }, 20);
      await expect(service.drawUnits({ subjectId: SUBJECT }, 0)).resolves.toEqual([]);
    });

    it('should expose units without answers or analysis', async () => {
      const { materialId } = await createMaterial();
      const units = await service.findUnits([materialId]);

      const [dto] = await service.toPublicUnits(units, null);

      expect(dto.id).toBe(materialId);
      expect(dto.children?.map((child) => child.stem)).toEqual(['第一小题', '第二小题']);
      expect(dto.children?.[0]).not.toHaveProperty('answer');
      expect(dto).not.toHaveProperty('analysis');
      expect(units[0].questions[0].answer).toEqual({ keys: ['B'] });
    });
  });

  describe('file references', () => {
    const image = `![](file:${PUBLIC_FILE})`;

    it('should keep raw references in admin detail and attach file and audio urls', async () => {
      const material = await create({ ...materialDto(`资料 ${image}`), audioFileId: PUBLIC_FILE });
      await create(singleDto({ parentId: material.id, options: [{ key: 'A', content: image }, OPTIONS[1]] }));

      const detail = await service.getAdminDetail(material.id, 1);

      expect(detail).toMatchObject({
        material: `资料 ${image}`,
        audioUrl: PUBLIC_URL,
        fileUrls: { [PUBLIC_FILE]: PUBLIC_URL },
      });
      expect(detail.children?.[0]).toMatchObject({
        options: [{ key: 'A', content: image }, OPTIONS[1]],
        audioUrl: null,
        fileUrls: { [PUBLIC_FILE]: PUBLIC_URL },
      });
    });

    it('should leave file urls empty when nothing is referenced', async () => {
      const created = await create(singleDto());

      expect(created).toMatchObject({ audioUrl: null, fileUrls: {} });
    });

    it('should attach the audio url to admin versions', async () => {
      const material = await create({ ...materialDto(), audioFileId: PUBLIC_FILE });
      vi.mocked(repository.findVersions).mockResolvedValue([
        { ...store.snapshot(material.id), questionId: material.id, version: 1 } as unknown as QuestionVersion,
      ]);

      const [version] = await service.findVersions(material.id, 1);

      expect(version).toMatchObject({ audioUrl: PUBLIC_URL, fileUrls: { [PUBLIC_FILE]: PUBLIC_URL } });
    });

    it('should keep raw references in admin lists and versions', async () => {
      const created = await create(singleDto({ stem: `看图 ${image}` }));
      vi.mocked(repository.findManyWithPaginationAndCount).mockResolvedValue({
        data: [store.snapshot(created.id)],
        total: 1,
      });
      vi.mocked(repository.findVersions).mockResolvedValue([
        { ...store.snapshot(created.id), questionId: created.id, version: 1 } as unknown as QuestionVersion,
      ]);

      const { data } = await service.findManyWithPaginationAndCount({ paginationOptions: { page: 1, limit: 20 } }, 1);
      const [version] = await service.findVersions(created.id, 1);

      expect(data[0]).toMatchObject({ stem: `看图 ${image}`, fileUrls: { [PUBLIC_FILE]: PUBLIC_URL } });
      expect(version).toMatchObject({ stem: `看图 ${image}`, audioUrl: null, fileUrls: { [PUBLIC_FILE]: PUBLIC_URL } });
    });

    it('should resolve references to urls in public units', async () => {
      const created = await create(singleDto({ stem: `看图 ${image}` }));

      const [dto] = await service.toPublicUnits(await service.findUnits([created.id]), null);

      expect(dto.stem).toBe(`看图 ![](${PUBLIC_URL})`);
      expect(store.snapshot(created.id).stem).toBe(`看图 ${image}`);
    });

    it('should resolve material audio and stem references with one lookup in public units', async () => {
      const material = await create({ ...materialDto(`资料 ${image}`), audioFileId: PUBLIC_FILE });
      await create(
        singleDto({
          parentId: material.id,
          type: QuestionType.FILL,
          options: null,
          answer: { blanks: [['一'], ['二']] },
          stem: '填空',
        }),
      );
      await publish(material.id);
      const units = await service.findUnits([material.id]);
      fileUrlResolver.resolveUrls.mockClear();

      const [dto] = await service.toPublicUnits(units, null);

      expect(dto).toMatchObject({ material: `资料 ![](${PUBLIC_URL})`, audioUrl: PUBLIC_URL, blankCount: null });
      expect(dto.children?.[0]).toMatchObject({ audioUrl: null, blankCount: 2 });
      expect(JSON.stringify(dto)).not.toMatch(/"answer"|blanks|"一"/);
      expect(fileUrlResolver.resolveUrls).toHaveBeenCalledTimes(1);
      expect(fileUrlResolver.resolveUrls).toHaveBeenCalledWith([PUBLIC_FILE, PUBLIC_FILE], null);
    });
  });

  describe('importUnit', () => {
    const item = (
      ref: string,
      fields: Partial<CreateQuestionDto> = {},
      id: string | null = null,
    ): QuestionImportItem => {
      const { subjectId: _subjectId, parentId: _parentId, ...rest } = singleDto(fields);
      return { ref, id, fields: rest };
    };
    const materialItem = (ref: string, material = '导入资料'): QuestionImportItem => {
      const { subjectId: _subjectId, ...rest } = materialDto(material);
      return { ref, id: null, fields: rest };
    };

    it('should create a material with its sub-questions in order as drafts', async () => {
      const result = await service.importUnit({
        subjectId: SUBJECT,
        root: materialItem('m'),
        children: [item('c1', { stem: '小题一', sort: 1 }), item('c2', { stem: '小题二', sort: 2 })],
        publish: false,
      });

      const children = await store.findChildrenForUpdate([result.rootId]);
      expect(children.map((child) => [child.id, child.stem, child.status])).toEqual([
        [result.ids.c1, '小题一', QuestionStatus.DRAFT],
        [result.ids.c2, '小题二', QuestionStatus.DRAFT],
      ]);
      expect(result.ids.m).toBe(result.rootId);
    });

    it('should write nothing when any sub-question fails and report its ref', async () => {
      const error = await service
        .importUnit({
          subjectId: SUBJECT,
          root: materialItem('m'),
          children: [item('c1', { stem: '小题一' }), item('c2', { stem: '小题二', knowledgePointIds: ['branch'] })],
          publish: false,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(QuestionImportItemError);
      expect((error as QuestionImportItemError).ref).toBe('c2');
      expect((error as QuestionImportItemError).cause).toBeInstanceOf(UnprocessableEntityException);
      expect(store.questions.size).toBe(0);
    });

    it('should validate content before opening the transaction', async () => {
      const error = await service
        .importUnit({ subjectId: SUBJECT, root: item('q', { answer: { keys: ['Z'] } }), children: [], publish: false })
        .catch((caught: unknown) => caught);

      expect((error as QuestionImportItemError).ref).toBe('q');
      expect(store.questions.size).toBe(0);
    });

    it('should publish a new unit with first versions when requested', async () => {
      const result = await service.importUnit({
        subjectId: SUBJECT,
        root: materialItem('m'),
        children: [item('c1')],
        publish: true,
      });

      expect(store.snapshot(result.rootId)).toMatchObject({ status: QuestionStatus.PUBLISHED, currentVersion: 1 });
      expect(store.snapshot(result.ids.c1)).toMatchObject({ status: QuestionStatus.PUBLISHED, currentVersion: 1 });
      expect(store.deltas).toEqual([{ knowledgePointId: 'leaf1', delta: 1 }]);
    });

    it('should update a published question with an EDIT version', async () => {
      const { id } = await create(singleDto());
      await publish(id);

      await service.importUnit({
        subjectId: SUBJECT,
        root: item('q', { analysis: '新解析' }, id),
        children: [],
        publish: true,
      });

      expect(store.snapshot(id)).toMatchObject({ analysis: '新解析', currentVersion: 2 });
      expect(store.versions.at(-1)).toMatchObject({ version: 2, changeType: QuestionChangeType.EDIT });
    });

    it('should reject an answer change of a published question', async () => {
      const { id } = await create(singleDto());
      await publish(id);

      const error = await service
        .importUnit({
          subjectId: SUBJECT,
          root: item('q', { answer: { keys: ['A'] } }, id),
          children: [],
          publish: false,
        })
        .catch((caught: unknown) => caught);

      expect((error as QuestionImportItemError).cause).toMatchObject({ errorKey: 'answerChangeNotAllowed' });
      expect(store.snapshot(id).answer).toEqual({ keys: ['B'] });
    });

    it('should reject an id from another subject or with a different parent', async () => {
      const { id } = await create(singleDto());
      store.questions.get(id)!.subjectId = 'other';

      const otherSubject = await service
        .importUnit({ subjectId: SUBJECT, root: item('q', {}, id), children: [], publish: false })
        .catch((caught: unknown) => caught);
      expect((otherSubject as QuestionImportItemError).cause).toBeInstanceOf(UnprocessableEntityException);

      store.questions.get(id)!.subjectId = SUBJECT;
      const asChild = await service
        .importUnit({ subjectId: SUBJECT, root: materialItem('m'), children: [item('c', {}, id)], publish: false })
        .catch((caught: unknown) => caught);
      expect((asChild as QuestionImportItemError).ref).toBe('c');
      expect(store.questions.size).toBe(1);
    });
  });
});

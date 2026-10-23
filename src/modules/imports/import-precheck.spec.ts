import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ContentImporter } from './content-importer';
import { ImportPackage } from './package/import-package';
import { ImportSheetName, emptySheets } from './package/sheet-row';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionStatus } from '../questions/domain/question-status';
import { computeContentHash } from '../questions/domain/content-hash';
import { PapersService } from '../papers/papers.service';
import { FileStorageService } from '../files/file-storage.service';
import { FilePurpose } from '../files/domain/file-purpose';
import { PNG_BYTES } from '../../../test/utils/import-package';

type Values = Record<string, string | number>;

function pkg(sheets: Partial<Record<ImportSheetName, Values[]>>, assets: Record<string, Buffer> = {}): ImportPackage {
  const result = emptySheets();
  for (const [name, rows] of Object.entries(sheets)) {
    result[name as ImportSheetName] = rows.map((values, index) => ({
      sheet: name as ImportSheetName,
      row: index + 2,
      values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
    }));
  }
  return { sheets: result, assets: new Map(Object.entries(assets)) };
}

const SUBJECT = { exam: '国考', subject: '行测' };
const SUBJECT_ID = '5b1ec700-0000-4000-8000-000000000001';
const ROOT_ID = '5b1ec700-0000-4000-8000-0000000000a1';
const LEAF_ID = '5b1ec700-0000-4000-8000-0000000000b2';
const EXISTING_ID = '5b1ec700-0000-4000-8000-0000000000c3';

const point = (overrides: Partial<KnowledgePoint>): KnowledgePoint =>
  Object.assign(new KnowledgePoint(), { subjectId: SUBJECT_ID, sort: 0, questionCount: 0, ...overrides });

const single = (stem: string, overrides: Values = {}): Values => ({
  ...SUBJECT,
  type: 'SINGLE',
  stem,
  optionA: '甲',
  optionB: '乙',
  answer: 'A',
  ...overrides,
});

const existingQuestion = (overrides: Partial<Question> = {}): Question => {
  const content = {
    type: QuestionType.SINGLE,
    stem: '已有题',
    options: [
      { key: 'A', content: '甲' },
      { key: 'B', content: '乙' },
    ],
    material: null,
    audioFileId: null,
  };
  return Object.assign(new Question(), {
    ...content,
    id: EXISTING_ID,
    subjectId: SUBJECT_ID,
    parentId: null,
    answer: { keys: ['A'] },
    analysis: null,
    knowledgePointIds: [],
    status: QuestionStatus.PUBLISHED,
    currentVersion: 1,
    isFree: true,
    sort: 0,
    contentHash: computeContentHash(content, null),
    ...overrides,
  });
};

describe('ContentImporter precheck', () => {
  let knowledgePointsService: Mocked<Pick<KnowledgePointsService, 'ensurePath' | 'create' | 'findBySubjectId'>>;
  let questionsService: Mocked<
    Pick<
      QuestionsService,
      | 'importUnit'
      | 'findByIds'
      | 'findUnits'
      | 'findIdsByContentHashes'
      | 'findManyWithPaginationAndCount'
      | 'assertFileReferences'
    >
  >;
  let papersService: Mocked<Pick<PapersService, 'importPaper' | 'findManyWithPaginationAndCount' | 'findByIds'>>;
  let fileStorageService: Mocked<Pick<FileStorageService, 'storeDeduplicated' | 'remove' | 'findDeduplicated'>>;
  let stored: Question[];
  let importer: ContentImporter;

  beforeEach(() => {
    stored = [];
    const subjectsService = {
      findByExamAndName: vi.fn((exam: string, subject: string) =>
        exam === SUBJECT.exam && subject === SUBJECT.subject
          ? Promise.resolve({ id: SUBJECT_ID } as never)
          : Promise.reject(new NotFoundException({ error: 'subjectNotFound' })),
      ),
    };
    knowledgePointsService = {
      ensurePath: vi.fn(),
      create: vi.fn(),
      findBySubjectId: vi.fn(() =>
        Promise.resolve([
          point({ id: ROOT_ID, parentId: null, name: '常识', level: 1, path: `/${ROOT_ID}/`, isLeaf: false }),
          point({
            id: LEAF_ID,
            parentId: ROOT_ID,
            name: '科技',
            level: 2,
            path: `/${ROOT_ID}/${LEAF_ID}/`,
            isLeaf: true,
          }),
        ]),
      ),
    };
    const find = (ids: string[]): Question[] => stored.filter((question) => ids.includes(question.id));
    questionsService = {
      importUnit: vi.fn(),
      findByIds: vi.fn((ids: string[]) => Promise.resolve(find(ids))),
      findUnits: vi.fn((ids: string[]) =>
        Promise.resolve(
          find(ids)
            .filter((question) => question.parentId === null)
            .map((root) => ({ root, questions: [root] })),
        ),
      ),
      findIdsByContentHashes: vi.fn((_subjectId: string, hashes: string[]) =>
        Promise.resolve(
          new Map(
            stored
              .filter((question) => hashes.includes(question.contentHash))
              .map((question) => [question.contentHash, question.id]),
          ),
        ),
      ),
      findManyWithPaginationAndCount: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      assertFileReferences: vi.fn().mockResolvedValue(undefined),
    };
    papersService = {
      importPaper: vi.fn(),
      findManyWithPaginationAndCount: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findByIds: vi.fn().mockResolvedValue([]),
    };
    fileStorageService = {
      storeDeduplicated: vi.fn(),
      remove: vi.fn(),
      findDeduplicated: vi.fn().mockResolvedValue(null),
    };
    importer = new ContentImporter(
      subjectsService as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
      papersService as unknown as PapersService,
      fileStorageService as unknown as FileStorageService,
    );
  });

  const precheck = (content: ImportPackage, publish = false) => importer.precheck(content, { publish, operatorId: 7 });

  const expectNoWrites = (): void => {
    expect(knowledgePointsService.ensurePath).not.toHaveBeenCalled();
    expect(knowledgePointsService.create).not.toHaveBeenCalled();
    expect(questionsService.importUnit).not.toHaveBeenCalled();
    expect(papersService.importPaper).not.toHaveBeenCalled();
    expect(fileStorageService.storeDeduplicated).not.toHaveBeenCalled();
    expect(fileStorageService.remove).not.toHaveBeenCalled();
  };

  it('should simulate new knowledge points, materials and questions referenced by a paper without writing', async () => {
    const outcome = await precheck(
      pkg(
        {
          knowledge_points: [{ ...SUBJECT, path: '常识/新增' }],
          materials: [{ materialKey: 'm1', ...SUBJECT, material: '资料 ![](assets/chart.png)' }],
          questions: [
            single('小题一', { materialKey: 'm1', order: 1, knowledgePath: '常识/新增' }),
            single('小题二', { materialKey: 'm1', order: 2 }),
            single('独立题', { questionKey: 'q1', knowledgePath: '常识/新增', analysis: '![](assets/chart.png)' }),
            single('独立题', { questionKey: 'q1-copy' }),
          ],
          papers: [{ paperKey: 'p1', ...SUBJECT, title: '预检卷', type: 'MOCK', durationMin: 60 }],
          paper_questions: [
            { paperKey: 'p1', sectionTitle: '单选', sectionType: 'SINGLE', sort: 1, questionKey: 'q1', score: 1 },
            { paperKey: 'p1', sectionTitle: '资料', sectionType: 'MATERIAL', sort: 2, materialKey: 'm1', score: 2 },
          ],
        },
        { 'chart.png': PNG_BYTES },
      ),
      true,
    );

    expect(outcome).toMatchObject({ total: 5, succeeded: 4, failed: 0, skipped: 1, errors: [] });
    expect(outcome.summary).toEqual({
      created: { knowledgePoints: 1, materials: 1, questions: 1, papers: 1 },
      updated: { knowledgePoints: 0, materials: 0, questions: 0, papers: 0 },
      skipped: { knowledgePoints: 0, materials: 0, questions: 1, papers: 0 },
    });
    expect(fileStorageService.findDeduplicated).toHaveBeenCalledWith(PNG_BYTES, 'chart.png', FilePurpose.IMAGE);
    const [fields, assumedPublic] = questionsService.assertFileReferences.mock.calls.find(([source]) =>
      source.analysis?.includes('file:'),
    )!;
    expect(fields.analysis).toBe(`![](file:${[...assumedPublic!][0]})`);
    expectNoWrites();
  });

  it('should report file references the real import would reject', async () => {
    const missingFileId = '5b1ec700-0000-4000-8000-0000000000d4';
    questionsService.assertFileReferences.mockImplementation((source) =>
      source.stem?.includes(missingFileId)
        ? Promise.reject(new UnprocessableEntityException({ errors: { stem: 'fileNotFound' } }))
        : Promise.resolve(),
    );

    const outcome = await precheck(pkg({ questions: [single(`引用 ![](file:${missingFileId})`)] }));

    expect(outcome.errors).toEqual([{ sheet: 'questions', row: 2, field: 'stem', reason: 'fileNotFound' }]);
    expect(outcome.summary.created.questions).toBe(0);
    expectNoWrites();
  });

  it('should report what the real writes would reject across units', async () => {
    questionsService.findManyWithPaginationAndCount.mockResolvedValue({ data: [], total: 1 });

    const outcome = await precheck(
      pkg(
        {
          knowledge_points: [
            { ...SUBJECT, path: '常识/科技/下级' },
            { ...SUBJECT, path: '常识/新领域/三级/四级' },
          ],
          questions: [
            single('打在非叶子上', { knowledgePath: '常识/新领域' }),
            single('打在新叶子上', { questionKey: 'q-new', knowledgePath: '常识/新领域/三级' }),
            single('缺图', { stem: '缺图 ![](assets/missing.png)' }),
            single('坏图', { stem: '坏图 ![](assets/evil.png)' }),
          ],
          papers: [{ paperKey: 'p1', ...SUBJECT, title: '未发布题目卷', type: 'MOCK', durationMin: 60 }],
          paper_questions: [
            { paperKey: 'p1', sectionTitle: '单选', sectionType: 'SINGLE', questionKey: 'q-new', score: 1 },
          ],
        },
        { 'evil.png': Buffer.from('MZ\x90\0') },
      ),
    );

    expect(outcome.errors).toEqual([
      { sheet: 'knowledge_points', row: 2, field: 'path', reason: 'knowledgePointHasQuestions' },
      { sheet: 'knowledge_points', row: 3, field: 'path', reason: 'knowledgePointTooDeep' },
      { sheet: 'questions', row: 2, field: 'knowledgePath', reason: 'questionKnowledgePointNotLeaf' },
      { sheet: 'questions', row: 4, field: 'stem', reason: 'importAssetNotFound', detail: 'missing.png' },
      { sheet: 'questions', row: 5, field: 'stem', reason: 'importAssetTypeNotAllowed', detail: 'evil.png' },
      { sheet: 'papers', row: 2, field: 'paper_questions', reason: 'paperQuestionNotPublished' },
    ]);
    expect(outcome.summary.created).toEqual({ knowledgePoints: 0, materials: 0, questions: 1, papers: 0 });
    expect(questionsService.findManyWithPaginationAndCount).toHaveBeenCalledWith(
      { filterOptions: { knowledgePointId: LEAF_ID }, paginationOptions: { page: 1, limit: 1 } },
      7,
    );
    expectNoWrites();
  });

  it('should skip content that already exists and let papers reference published questions', async () => {
    stored = [existingQuestion()];

    const outcome = await precheck(
      pkg({
        questions: [single('已有题', { questionKey: 'q-old' })],
        papers: [{ paperKey: 'p1', ...SUBJECT, title: '引用已有题', type: 'MOCK', durationMin: 60 }],
        paper_questions: [
          { paperKey: 'p1', sectionTitle: '单选', sectionType: 'SINGLE', questionKey: 'q-old', score: 1 },
        ],
      }),
    );

    expect(outcome).toMatchObject({ succeeded: 1, skipped: 1, failed: 0, errors: [] });
    expect(outcome.summary.skipped.questions).toBe(1);
    expect(outcome.summary.created.papers).toBe(1);
    expectNoWrites();
  });

  it('should count updates and reject answer changes of published questions', async () => {
    stored = [existingQuestion()];

    const outcome = await precheck(
      pkg({
        questions: [
          { id: EXISTING_ID, ...SUBJECT, analysis: '新解析' },
          { id: EXISTING_ID, ...SUBJECT, answer: 'B' },
        ],
      }),
    );

    expect(outcome.errors).toEqual([{ sheet: 'questions', row: 3, field: 'answer', reason: 'answerChangeNotAllowed' }]);
    expect(outcome.summary.updated.questions).toBe(1);
    expectNoWrites();
  });

  it('should treat a paper title used earlier in the package as existing', async () => {
    stored = [existingQuestion()];
    const paper = { ...SUBJECT, title: '同名卷', type: 'MOCK', durationMin: 60 };
    const item = { sectionTitle: '单选', sectionType: 'SINGLE', questionId: EXISTING_ID, score: 1 };

    const outcome = await precheck(
      pkg({
        papers: [
          { paperKey: 'p1', ...paper },
          { paperKey: 'p2', ...paper },
        ],
        paper_questions: [
          { paperKey: 'p1', ...item },
          { paperKey: 'p2', ...item },
        ],
      }),
    );

    expect(outcome.summary.created.papers).toBe(1);
    expect(outcome.summary.skipped.papers).toBe(1);
    expectNoWrites();
  });
});

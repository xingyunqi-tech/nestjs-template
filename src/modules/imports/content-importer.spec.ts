import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContentImporter } from './content-importer';
import { ImportPackage } from './package/import-package';
import { ImportSheetName, SheetRow, emptySheets } from './package/sheet-row';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { QuestionsService } from '../questions/questions.service';
import { QuestionImportItemError, QuestionImportUnit } from '../questions/question-import';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionSource } from '../questions/domain/question-source';
import { PapersService } from '../papers/papers.service';
import { FileStorageService } from '../files/file-storage.service';
import { FilePurpose } from '../files/domain/file-purpose';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PNG_BYTES } from '../../../test/utils/import-package';

type Values = Record<string, string | number>;

function sheet(name: ImportSheetName, rows: Values[]): SheetRow[] {
  return rows.map((values, index) => ({
    sheet: name,
    row: index + 2,
    values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  }));
}

function pkg(sheets: Partial<Record<ImportSheetName, Values[]>>, assets: Record<string, Buffer> = {}): ImportPackage {
  const result = emptySheets();
  for (const [name, rows] of Object.entries(sheets)) {
    result[name as ImportSheetName] = sheet(name as ImportSheetName, rows);
  }
  return { sheets: result, assets: new Map(Object.entries(assets)) };
}

const SUBJECT = { exam: '国考', subject: '行测' };
const SUBJECT_ID = '5b1ec700-0000-4000-8000-000000000001';
const LEAF_ID = '5b1ec700-0000-4000-8000-0000000000b2';

const idOf = (ref: string): string => {
  const [sheetName, row] = ref.split(':');
  const code = sheetName === 'materials' ? 1 : 4;
  return `00000000-0000-4000-8000-${String(code * 100 + Number(row)).padStart(12, '0')}`;
};

const single = (overrides: Values = {}): Values => ({
  ...SUBJECT,
  type: 'SINGLE',
  stem: '单选题干',
  optionA: '甲',
  optionB: '乙',
  answer: 'B',
  ...overrides,
});

describe('ContentImporter', () => {
  let subjectsService: Mocked<Pick<SubjectsService, 'findByExamAndName'>>;
  let knowledgePointsService: Mocked<Pick<KnowledgePointsService, 'ensurePath' | 'findBySubjectId'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'importUnit' | 'findByIds' | 'findUnits'>>;
  let papersService: Mocked<Pick<PapersService, 'importPaper' | 'findManyWithPaginationAndCount'>>;
  let fileStorageService: Mocked<Pick<FileStorageService, 'storeDeduplicated' | 'remove'>>;
  let importer: ContentImporter;

  beforeEach(() => {
    subjectsService = {
      findByExamAndName: vi.fn((exam: string, subject: string) =>
        exam === '国考' && subject === '行测'
          ? Promise.resolve({ id: SUBJECT_ID } as never)
          : Promise.reject(new NotFoundException({ error: 'subjectNotFound' })),
      ),
    };
    knowledgePointsService = {
      ensurePath: vi.fn().mockResolvedValue({ point: { id: 'k-new' }, created: true }),
      findBySubjectId: vi.fn().mockResolvedValue([
        { id: 'k1', parentId: null, name: '常识' },
        { id: LEAF_ID, parentId: 'k1', name: '科技' },
      ]),
    };
    questionsService = {
      importUnit: vi.fn((unit: QuestionImportUnit) =>
        Promise.resolve({
          rootId: idOf(unit.root.ref),
          ids: Object.fromEntries([unit.root, ...unit.children].map((item) => [item.ref, idOf(item.ref)])),
        }),
      ),
      findByIds: vi.fn().mockResolvedValue([]),
      findUnits: vi.fn().mockResolvedValue([]),
    };
    papersService = {
      importPaper: vi.fn().mockResolvedValue('paper-id'),
      findManyWithPaginationAndCount: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };
    fileStorageService = {
      storeDeduplicated: vi.fn((_content: Buffer, name: string) =>
        Promise.resolve({ file: { id: `file-${name}`, path: name } as never, reused: false }),
      ),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    importer = new ContentImporter(
      subjectsService as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
      papersService as unknown as PapersService,
      fileStorageService as unknown as FileStorageService,
    );
  });

  const run = (content: ImportPackage, publish = false) => importer.run(content, { publish });

  it('should import knowledge points, a material group, standalone questions and a paper', async () => {
    const progress: number[] = [];
    const outcome = await importer.run(
      pkg(
        {
          knowledge_points: [{ ...SUBJECT, path: ' 常识 / 科技 ' }],
          materials: [{ materialKey: 'm1', ...SUBJECT, material: '资料 ![](assets/chart.png)', source: 'public' }],
          questions: [
            single({ questionKey: 'm1-2', materialKey: 'm1', order: 2, stem: '第二小题 ![](assets/chart.png)' }),
            single({ questionKey: 'm1-1', materialKey: 'm1', order: 1, stem: '第一小题', knowledgePath: '常识/科技' }),
            { questionKey: 'q1', ...SUBJECT, type: 'fill', stem: '填空', answer: 'a\\|b||c', isFree: '否' },
          ],
          papers: [{ paperKey: 'p1', ...SUBJECT, title: '样卷', type: 'MOCK', durationMin: 60, year: 2024 }],
          paper_questions: [
            { paperKey: 'p1', sectionTitle: '资料分析', sectionType: 'MATERIAL', sort: 2, materialKey: 'm1', score: 2 },
            { paperKey: 'p1', sectionTitle: '填空', sectionType: 'FILL', sort: 1, questionKey: 'q1', score: 1.5 },
          ],
        },
        { 'chart.png': PNG_BYTES },
      ),
      { publish: true },
      (current) => {
        progress.push(current.succeeded + current.failed);
        return Promise.resolve();
      },
    );

    expect(outcome).toEqual({ total: 4, succeeded: 4, failed: 0, skipped: 0, errors: [] });
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(knowledgePointsService.ensurePath).toHaveBeenCalledWith(SUBJECT_ID, ['常识', '科技']);
    expect(fileStorageService.storeDeduplicated).toHaveBeenCalledTimes(1);
    expect(fileStorageService.storeDeduplicated).toHaveBeenCalledWith(PNG_BYTES, 'chart.png', FilePurpose.IMAGE, null);
    expect(fileStorageService.remove).not.toHaveBeenCalled();

    const [materialUnit, fillUnit] = questionsService.importUnit.mock.calls.map(([unit]) => unit);
    expect(materialUnit).toMatchObject({
      subjectId: SUBJECT_ID,
      publish: true,
      root: {
        ref: 'materials:2',
        id: null,
        fields: {
          type: QuestionType.MATERIAL,
          material: '资料 ![](file:file-chart.png)',
          source: QuestionSource.PUBLIC,
        },
      },
    });
    expect(materialUnit.children.map((child) => [child.ref, child.fields.stem, child.fields.sort])).toEqual([
      ['questions:3', '第一小题', 1],
      ['questions:2', '第二小题 ![](file:file-chart.png)', 2],
    ]);
    expect(materialUnit.children[0].fields).toMatchObject({
      knowledgePointIds: [LEAF_ID],
      answer: { keys: ['B'] },
      options: [
        { key: 'A', content: '甲' },
        { key: 'B', content: '乙' },
      ],
      source: QuestionSource.PUBLIC,
    });
    expect(materialUnit.children[0].fields).not.toHaveProperty('isFree');
    expect(fillUnit.root.fields).toMatchObject({ answer: { blanks: [['a|b'], ['c']] }, options: null, isFree: false });

    expect(papersService.importPaper).toHaveBeenCalledWith({
      id: null,
      subjectId: SUBJECT_ID,
      fields: expect.objectContaining({ title: '样卷', type: 'MOCK', year: 2024, durationMin: 60, isFree: true }),
      questions: {
        sections: [
          { title: '填空', questionType: QuestionType.FILL },
          { title: '资料分析', questionType: QuestionType.MATERIAL },
        ],
        questions: [
          expect.objectContaining({ questionId: idOf('questions:4'), sectionIndex: 0, score: 1.5 }),
          expect.objectContaining({ questionId: idOf('materials:2'), sectionIndex: 1, score: 2 }),
        ],
      },
      publish: true,
    });
  });

  it('should collect every row error of a unit and skip uploads and writes', async () => {
    const outcome = await run(
      pkg(
        {
          materials: [{ materialKey: 'm1', ...SUBJECT, material: '![](assets/chart.png)' }],
          questions: [
            single({ materialKey: 'm1', order: 1, answer: '甲' }),
            single({ materialKey: 'm1', type: 'CHOICE' }),
            single({ materialKey: 'm1', order: 'x', difficulty: 9, knowledgePath: '常识/未知' }),
          ],
        },
        { 'chart.png': PNG_BYTES },
      ),
    );

    expect(outcome).toMatchObject({ total: 1, succeeded: 0, failed: 1 });
    expect(outcome.errors).toEqual([
      { sheet: 'questions', row: 2, field: 'answer', reason: 'invalidQuestionAnswer' },
      { sheet: 'questions', row: 3, field: 'type', reason: 'invalidImportValue' },
      { sheet: 'questions', row: 4, field: 'order', reason: 'invalidImportValue' },
      { sheet: 'questions', row: 4, field: 'knowledgePath', reason: 'knowledgePointNotFound', detail: '常识/未知' },
      expect.objectContaining({ sheet: 'questions', row: 4, field: 'difficulty', reason: 'invalidImportValue' }),
    ]);
    expect(fileStorageService.storeDeduplicated).not.toHaveBeenCalled();
    expect(questionsService.importUnit).not.toHaveBeenCalled();
  });

  it('should attribute a service error to the failing row and fail papers that reference the unit', async () => {
    questionsService.importUnit.mockRejectedValueOnce(
      new QuestionImportItemError('questions:3', new BusinessException('answerChangeNotAllowed')),
    );

    const outcome = await run(
      pkg({
        materials: [{ materialKey: 'm1', ...SUBJECT, material: '资料' }],
        questions: [
          single({ materialKey: 'm1', order: 1 }),
          single({ materialKey: 'm1', order: 2, id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', stem: '第二题' }),
        ],
        papers: [{ paperKey: 'p1', ...SUBJECT, title: '样卷', type: 'MOCK', durationMin: 60 }],
        paper_questions: [
          { paperKey: 'p1', sectionTitle: '资料', sectionType: 'MATERIAL', materialKey: 'm1', score: 1 },
        ],
      }),
    );

    expect(questionsService.importUnit.mock.calls[0][0].children[1].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(outcome).toMatchObject({ total: 2, succeeded: 0, failed: 2 });
    expect(outcome.errors).toEqual([
      { sheet: 'questions', row: 3, field: 'answer', reason: 'answerChangeNotAllowed' },
      { sheet: 'paper_questions', row: 2, field: 'materialKey', reason: 'importQuestionFailed', detail: 'm1' },
    ]);
    expect(papersService.importPaper).not.toHaveBeenCalled();
  });

  it('should report duplicate content with the existing question id', async () => {
    questionsService.importUnit.mockRejectedValueOnce(
      new QuestionImportItemError(
        'questions:2',
        new ConflictException({ error: 'duplicateQuestion', errors: { duplicateQuestionId: 'q-old' } }),
      ),
    );

    const outcome = await run(pkg({ questions: [single()] }));

    expect(outcome.errors).toEqual([
      { sheet: 'questions', row: 2, field: '', reason: 'duplicateQuestion', detail: 'duplicateQuestionId=q-old' },
    ]);
  });

  it('should reject missing and disallowed assets', async () => {
    const outcome = await run(
      pkg(
        {
          questions: [
            single({ stem: '![](assets/missing.png)' }),
            single({ stem: '![](assets/evil.png)', optionA: '![](assets/chart.png)' }),
          ],
          materials: [{ materialKey: 'm1', ...SUBJECT, audio: 'assets/chart.png' }],
        },
        { 'evil.png': Buffer.from('MZ\x90\0'), 'chart.png': PNG_BYTES },
      ),
    );

    expect(outcome.errors).toEqual([
      { sheet: 'materials', row: 2, field: 'audio', reason: 'importAssetTypeNotAllowed', detail: 'chart.png' },
      { sheet: 'questions', row: 2, field: 'stem', reason: 'importAssetNotFound', detail: 'missing.png' },
      { sheet: 'questions', row: 3, field: 'stem', reason: 'importAssetTypeNotAllowed', detail: 'evil.png' },
    ]);
    expect(fileStorageService.storeDeduplicated).toHaveBeenCalledTimes(1);
    expect(questionsService.importUnit).not.toHaveBeenCalled();
  });

  it('should report unknown subjects, duplicate keys and dangling references', async () => {
    const outcome = await run(
      pkg({
        knowledge_points: [{ exam: '国考', subject: '不存在', path: 'A' }],
        materials: [
          { materialKey: 'dup', ...SUBJECT, material: '一' },
          { materialKey: 'dup', ...SUBJECT, material: '二' },
        ],
        questions: [
          single({ questionKey: 'q' }),
          single({ questionKey: 'q' }),
          single({ materialKey: 'none', order: 1 }),
        ],
        paper_questions: [{ paperKey: 'nope', questionKey: 'q', score: 1 }],
      }),
    );

    expect(outcome).toMatchObject({ total: 7, succeeded: 0, failed: 7 });
    expect(outcome.errors.map(({ sheet, row, field, reason }) => `${sheet}:${row}:${field}:${reason}`)).toEqual([
      'knowledge_points:2:subject:subjectNotFound',
      'materials:2:materialKey:importDuplicateKey',
      'materials:3:materialKey:importDuplicateKey',
      'questions:4:materialKey:importMaterialKeyNotFound',
      'questions:2:questionKey:importDuplicateKey',
      'questions:3:questionKey:importDuplicateKey',
      'paper_questions:2:paperKey:importPaperKeyNotFound',
    ]);
    expect(knowledgePointsService.ensurePath).not.toHaveBeenCalled();
  });

  it('should validate paper rows and sections before importing', async () => {
    const outcome = await run(
      pkg({
        papers: [{ paperKey: 'p1', ...SUBJECT, title: '样卷', type: 'GENERATED', durationMin: 0 }],
        paper_questions: [
          {
            paperKey: 'p1',
            sectionTitle: 'A',
            sectionType: 'SINGLE',
            questionId: '11111111-1111-4111-8111-111111111111',
            score: 1,
          },
          { paperKey: 'p1', sectionTitle: 'B', sectionType: 'SINGLE', questionKey: 'unknown', score: 1 },
          { paperKey: 'p1', sectionTitle: 'A', sectionType: 'FILL', questionId: 'not-a-uuid', score: 'x' },
        ],
      }),
    );

    expect(outcome.errors.map(({ sheet, row, field, reason }) => `${sheet}:${row}:${field}:${reason}`)).toEqual([
      'papers:2:type:invalidImportValue',
      'papers:2:durationMin:invalidImportValue',
      'paper_questions:3:questionKey:importQuestionKeyNotFound',
      'paper_questions:4:sectionType:paperSectionTypeConflict',
      'paper_questions:4:questionId:invalidImportValue',
      'paper_questions:4:score:invalidImportValue',
    ]);
    expect(papersService.importPaper).not.toHaveBeenCalled();
  });

  it('should abort the run on unexpected errors', async () => {
    questionsService.importUnit.mockRejectedValueOnce(new QuestionImportItemError('questions:2', new Error('db down')));

    await expect(run(pkg({ questions: [single()] }))).rejects.toThrow('db down');
  });

  describe('re-import', () => {
    const duplicate = (ref: string, id: string) =>
      new QuestionImportItemError(
        ref,
        new ConflictException({ error: 'duplicateQuestion', errors: { duplicateQuestionId: id } }),
      );

    it('should bind duplicated questions and materials to existing ones and skip them', async () => {
      const existingRoot = '00000000-0000-4000-8000-00000000e001';
      const existingChildren = ['00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e003'];
      const existingSingle = '00000000-0000-4000-8000-00000000e004';
      questionsService.importUnit
        .mockRejectedValueOnce(duplicate('materials:2', existingRoot))
        .mockRejectedValueOnce(duplicate('questions:4', existingSingle));
      questionsService.findUnits.mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids[0] === existingRoot
            ? [
                {
                  root: { id: existingRoot, type: QuestionType.MATERIAL },
                  questions: existingChildren.map((id) => ({ id })),
                } as never,
              ]
            : [{ root: { id: existingSingle, type: QuestionType.SINGLE }, questions: [] } as never],
        ),
      );
      knowledgePointsService.ensurePath.mockResolvedValue({ point: { id: 'k' } as never, created: false });
      papersService.findManyWithPaginationAndCount.mockResolvedValue({
        data: [{ title: '旧卷', type: 'MOCK' }] as never,
        total: 1,
      });

      const outcome = await run(
        pkg({
          knowledge_points: [{ ...SUBJECT, path: '常识/科技' }],
          materials: [{ materialKey: 'm1', ...SUBJECT, material: '资料' }],
          questions: [
            single({ questionKey: 'c1', materialKey: 'm1', order: 1 }),
            single({ questionKey: 'c2', materialKey: 'm1', order: 2, stem: '第二题' }),
            single({ questionKey: 'q1' }),
          ],
          papers: [
            { paperKey: 'old', ...SUBJECT, title: '旧卷', type: 'MOCK', durationMin: 60 },
            { paperKey: 'new', ...SUBJECT, title: '新卷', type: 'MOCK', durationMin: 60 },
          ],
          paper_questions: [
            { paperKey: 'old', sectionTitle: '单选', sectionType: 'SINGLE', questionKey: 'q1', score: 1 },
            { paperKey: 'new', sectionTitle: '单选', sectionType: 'SINGLE', questionKey: 'q1', score: 1 },
            { paperKey: 'new', sectionTitle: '资料', sectionType: 'MATERIAL', materialKey: 'm1', score: 1 },
            { paperKey: 'new', sectionTitle: '小题', sectionType: 'SINGLE', questionKey: 'c2', score: 1 },
          ],
        }),
      );

      expect(outcome).toMatchObject({ total: 5, succeeded: 1, failed: 0, skipped: 4, errors: [] });
      expect(papersService.importPaper).toHaveBeenCalledTimes(1);
      expect(papersService.importPaper.mock.calls[0][0].questions.questions.map((item) => item.questionId)).toEqual([
        existingSingle,
        existingRoot,
        existingChildren[1],
      ]);
    });

    it('should fail a duplicated material whose sub-question count differs', async () => {
      questionsService.importUnit.mockRejectedValueOnce(duplicate('materials:2', 'old'));
      questionsService.findUnits.mockResolvedValue([
        { root: { id: 'old', type: QuestionType.MATERIAL }, questions: [{ id: 'c' }] } as never,
      ]);

      const outcome = await run(
        pkg({
          materials: [{ materialKey: 'm1', ...SUBJECT, material: '资料' }],
          questions: [single({ materialKey: 'm1', order: 1 }), single({ materialKey: 'm1', order: 2, stem: '二' })],
        }),
      );

      expect(outcome).toMatchObject({ failed: 1, skipped: 0 });
      expect(outcome.errors[0]).toMatchObject({ sheet: 'materials', row: 2, reason: 'duplicateQuestion' });
    });
  });

  it('should keep existing values for blank cells of update rows', async () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    questionsService.findByIds.mockResolvedValue([{ id, type: QuestionType.MULTIPLE } as never]);

    const outcome = await run(
      pkg({
        questions: [{ id, ...SUBJECT, answer: 'AC' }],
        materials: [{ materialKey: 'm1', id: '00000000-0000-4000-8000-0000000000bb', ...SUBJECT, analysis: '新解析' }],
      }),
    );

    expect(outcome.errors).toEqual([]);
    const [material, question] = questionsService.importUnit.mock.calls.map(([unit]) => unit.root);
    expect(material).toMatchObject({ id: '00000000-0000-4000-8000-0000000000bb' });
    expect(material.fields).toEqual({ type: QuestionType.MATERIAL, analysis: '新解析' });
    expect(question.fields).toEqual({ answer: { keys: ['A', 'C'] } });
  });

  it('should require a type for new rows and for update rows that change the answer of an unknown question', async () => {
    const outcome = await run(
      pkg({
        questions: [
          { ...SUBJECT, stem: '题干', answer: 'A' },
          { id: '00000000-0000-4000-8000-0000000000cc', ...SUBJECT, answer: 'A' },
        ],
      }),
    );

    expect(outcome.errors.map(({ row, field, reason }) => `${row}:${field}:${reason}`)).toEqual([
      '2:type:importFieldRequired',
      '3:type:importFieldRequired',
    ]);
  });

  it('should delete files uploaded by a failed unit but keep reused ones', async () => {
    fileStorageService.storeDeduplicated.mockImplementation((_content: Buffer, name: string) =>
      Promise.resolve({ file: { id: `file-${name}` } as never, reused: name === 'old.png' }),
    );
    questionsService.importUnit.mockRejectedValueOnce(
      new QuestionImportItemError('questions:2', new BusinessException('answerChangeNotAllowed')),
    );

    const outcome = await run(
      pkg(
        {
          questions: [
            single({ stem: '![](assets/new.png) ![](assets/old.png)' }),
            single({ stem: '再用 ![](assets/new.png)' }),
          ],
        },
        { 'new.png': PNG_BYTES, 'old.png': PNG_BYTES },
      ),
    );

    expect(outcome).toMatchObject({ succeeded: 1, failed: 1 });
    expect(fileStorageService.remove).toHaveBeenCalledTimes(1);
    expect(fileStorageService.remove).toHaveBeenCalledWith({ id: 'file-new.png' });
    expect(fileStorageService.storeDeduplicated).toHaveBeenCalledTimes(3);
    expect(questionsService.importUnit.mock.calls[1][0].root.fields.stem).toBe('再用 ![](file:file-new.png)');
  });

  it('should fail every sub-question of a duplicated material key', async () => {
    const outcome = await run(
      pkg({
        materials: [
          { materialKey: 'm1', ...SUBJECT, material: '一' },
          { materialKey: 'm1', ...SUBJECT, material: '二' },
        ],
        questions: [single({ questionKey: 'c1', materialKey: 'm1', order: 1 })],
        paper_questions: [],
      }),
    );

    expect(outcome.errors.map(({ sheet, row, reason }) => `${sheet}:${row}:${reason}`)).toEqual([
      'materials:2:importDuplicateKey',
      'questions:2:importDuplicateKey',
      'materials:3:importDuplicateKey',
    ]);
    expect(outcome).toMatchObject({ total: 2, failed: 2 });
  });

  it('should replace asset links in the material stem', async () => {
    await run(
      pkg(
        { materials: [{ materialKey: 'm1', ...SUBJECT, stem: '看图 ![](assets/chart.png)', material: '资料' }] },
        { 'chart.png': PNG_BYTES },
      ),
    );

    expect(questionsService.importUnit.mock.calls[0][0].root.fields.stem).toBe('看图 ![](file:file-chart.png)');
  });

  it('should reject date cells', async () => {
    const content = pkg({ questions: [single()] });
    content.sheets.questions[0].dateColumns = ['answer'];

    const outcome = await run(content);

    expect(outcome.errors).toEqual([
      { sheet: 'questions', row: 2, field: 'answer', reason: 'invalidImportValue', detail: 'date' },
    ]);
    expect(questionsService.importUnit).not.toHaveBeenCalled();
  });
});

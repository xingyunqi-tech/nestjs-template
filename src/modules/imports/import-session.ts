import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionSource } from '../questions/domain/question-source';
import { QuestionOption } from '../questions/domain/question-answer';
import { validateQuestionContent } from '../questions/domain/question-content';
import { CreateQuestionDto } from '../questions/dto/create-question.dto';
import { UpdateQuestionDto } from '../questions/dto/update-question.dto';
import { QuestionImportFields, QuestionImportItem, QuestionImportItemError } from '../questions/question-import';
import { PapersService } from '../papers/papers.service';
import { CATALOG_PAPER_TYPES, CatalogPaperType, PaperType } from '../papers/domain/paper-type';
import { MultiScoringRule } from '../papers/domain/multi-scoring-rule';
import { CreatePaperDto } from '../papers/dto/create-paper.dto';
import { PaperQuestionItemDto, SetPaperQuestionsDto } from '../papers/dto/set-paper-questions.dto';
import { FileStorageService } from '../files/file-storage.service';
import { FilePurpose } from '../files/domain/file-purpose';
import { FileType } from '../files/domain/file';
import { ImportOutcome, ImportProgress } from './domain/import-outcome';
import { ImportRowError } from './domain/import-row-error';
import { parseAnswerNotation, splitLines } from './domain/answer-notation';
import { ImportPackage } from './package/import-package';
import { SheetRow } from './package/sheet-row';
import { AssetPurpose, isAllowedAsset } from './package/asset-kind';
import { assetNameOf, assetNamesIn, replaceAssetLinks } from './package/asset-references';
import {
  ErrorDescription,
  UnitFailure,
  UnitIssues,
  columnOf,
  describeException,
  describeValidationErrors,
} from './import-errors';

export interface ImportSessionDeps {
  subjectsService: SubjectsService;
  knowledgePointsService: KnowledgePointsService;
  questionsService: QuestionsService;
  papersService: PapersService;
  fileStorageService: FileStorageService;
}

export interface ImportRunOptions {
  publish: boolean;
}

export type ImportProgressListener = (progress: ImportProgress) => Promise<void>;

type UnitResult = 'written' | 'skipped';

const DEFAULT_MATERIAL_STEM = '根据以下材料回答问题。';
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const QUESTION_TYPES: readonly QuestionType[] = Object.values(QuestionType).filter(
  (type) => type !== QuestionType.MATERIAL,
);
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';
const TRUE_VALUES = new Set(['是', 'true', '1', 'y', 'yes']);
const FALSE_VALUES = new Set(['否', 'false', '0', 'n', 'no']);
const PAPER_TITLE_LOOKUP_LIMIT = 100;

interface AssetRequest {
  row: SheetRow;
  field: string;
  name: string;
  purpose: AssetPurpose;
}

interface QuestionDraft {
  row: SheetRow;
  item: QuestionImportItem;
  assets: AssetRequest[];
  audioAsset: string | null;
}

interface MaterialUnit {
  key: string;
  row: SheetRow;
  children: SheetRow[];
}

type WriteResult = { kind: 'written' | 'existing'; rootId: string; ids: Record<string, string> };

const refOf = (row: SheetRow): string => `${row.sheet}:${row.row}`;

function cell(row: SheetRow, column: string): string {
  return (row.values[column] ?? '').trim();
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

function pathNames(path: string): string[] {
  return path
    .split('/')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

function duplicateIdOf(error: unknown): string | null {
  if (!(error instanceof ConflictException)) {
    return null;
  }
  const response = error.getResponse() as { error?: unknown; errors?: { duplicateQuestionId?: unknown } };
  const id = response.errors?.duplicateQuestionId;
  return response.error === 'duplicateQuestion' && typeof id === 'string' ? id : null;
}

async function validated<T extends object>(
  type: new () => T,
  plain: object,
  nested = true,
): Promise<{ value: T; errors: ErrorDescription[] }> {
  const value = plainToInstance(type, plain);
  const errors = await validate(value, { forbidUnknownValues: false });
  return {
    value,
    errors: describeValidationErrors(nested ? errors : errors.filter((error) => !error.children?.length)),
  };
}

export class ImportSession {
  private readonly errors: ImportRowError[] = [];
  private readonly progress: ImportProgress = { total: 0, succeeded: 0, failed: 0, skipped: 0 };
  private readonly subjects = new Map<string, Promise<string | ErrorDescription>>();
  private readonly knowledgePaths = new Map<string, Promise<Map<string, KnowledgePoint>>>();
  private readonly assetFileIds = new Map<string, string>();
  private readonly questionKeys = new Map<string, string | null>();
  private readonly materialKeys = new Map<string, string | null>();
  private unitUploads: { cacheKey: string; file: FileType }[] = [];

  constructor(
    private readonly deps: ImportSessionDeps,
    private readonly pkg: ImportPackage,
    private readonly options: ImportRunOptions,
    private readonly onProgress?: ImportProgressListener,
  ) {}

  async run(): Promise<ImportOutcome> {
    const { knowledge_points, materials, questions, papers, paper_questions } = this.pkg.sheets;

    const materialUnits = new Map<string, MaterialUnit>();
    const materialsWithoutKey: SheetRow[] = [];
    for (const row of materials) {
      const key = cell(row, 'materialKey');
      if (!key) {
        materialsWithoutKey.push(row);
      } else if (!materialUnits.has(key)) {
        materialUnits.set(key, { key, row, children: [] });
      }
    }
    const materialKeyCounts = countBy(materials, (row) => cell(row, 'materialKey'));
    const standalone: SheetRow[] = [];
    const orphans: SheetRow[] = [];
    for (const row of questions) {
      const key = cell(row, 'materialKey');
      if (!key) {
        standalone.push(row);
      } else if (materialUnits.has(key)) {
        materialUnits.get(key)!.children.push(row);
      } else {
        orphans.push(row);
      }
    }
    const questionKeyCounts = countBy(questions, (row) => cell(row, 'questionKey'));
    const paperKeyCounts = countBy(papers, (row) => cell(row, 'paperKey'));
    const paperKeys = new Set(papers.map((row) => cell(row, 'paperKey')));
    const orphanPaperQuestions = paper_questions.filter((row) => !paperKeys.has(cell(row, 'paperKey')));

    this.progress.total =
      knowledge_points.length +
      materials.length +
      standalone.length +
      orphans.length +
      papers.length +
      orphanPaperQuestions.length;
    await this.onProgress?.({ ...this.progress });

    for (const row of knowledge_points) {
      await this.unit(() => this.importKnowledgePoint(row));
    }
    for (const row of materialsWithoutKey) {
      await this.unit(() => this.reject([[row, 'materialKey', 'importFieldRequired']]));
    }
    for (const row of materials) {
      const key = cell(row, 'materialKey');
      const unit = materialUnits.get(key);
      if (!unit) {
        continue;
      }
      if ((materialKeyCounts.get(key) ?? 0) > 1) {
        this.materialKeys.set(key, null);
        const rows = unit.row === row ? [row, ...unit.children] : [row];
        rows.forEach((item) => this.markFailedKey(cell(item, 'questionKey')));
        await this.unit(() => this.reject(rows.map((item) => [item, 'materialKey', 'importDuplicateKey', key])));
        continue;
      }
      await this.unit(() => this.importMaterial(unit, questionKeyCounts));
    }
    for (const row of orphans) {
      this.markFailedKey(cell(row, 'questionKey'));
      await this.unit(() => this.reject([[row, 'materialKey', 'importMaterialKeyNotFound', cell(row, 'materialKey')]]));
    }
    for (const row of standalone) {
      await this.unit(() => this.importStandalone(row, questionKeyCounts));
    }
    for (const row of papers) {
      const key = cell(row, 'paperKey');
      const items = paper_questions.filter((item) => cell(item, 'paperKey') === key);
      if (!key) {
        await this.unit(() => this.reject([[row, 'paperKey', 'importFieldRequired']]));
      } else if ((paperKeyCounts.get(key) ?? 0) > 1) {
        await this.unit(() => this.reject([[row, 'paperKey', 'importDuplicateKey', key]]));
      } else {
        await this.unit(() => this.importPaper(row, items));
      }
    }
    for (const row of orphanPaperQuestions) {
      await this.unit(() => this.reject([[row, 'paperKey', 'importPaperKeyNotFound', cell(row, 'paperKey')]]));
    }

    return { ...this.progress, errors: this.errors };
  }

  private markFailedKey(questionKey: string): void {
    if (questionKey && !this.questionKeys.has(questionKey)) {
      this.questionKeys.set(questionKey, null);
    }
  }

  private async unit(work: () => Promise<UnitResult>): Promise<void> {
    this.unitUploads = [];
    let result: UnitResult | 'failed';
    try {
      result = await work();
    } catch (error) {
      if (!(error instanceof UnitFailure)) {
        await this.discardUnitUploads();
        throw error;
      }
      result = 'failed';
    }
    if (result === 'written') {
      this.progress.succeeded++;
    } else {
      await this.discardUnitUploads();
      if (result === 'skipped') {
        this.progress.skipped++;
      } else {
        this.progress.failed++;
      }
    }
    this.unitUploads = [];
    await this.onProgress?.({ ...this.progress });
  }

  private async discardUnitUploads(): Promise<void> {
    for (const { cacheKey, file } of this.unitUploads) {
      this.assetFileIds.delete(cacheKey);
      await this.deps.fileStorageService.remove(file).catch(() => undefined);
    }
  }

  private settle(issues: UnitIssues): void {
    if (issues.failed) {
      this.errors.push(...issues.errors);
      throw new UnitFailure();
    }
  }

  private reject(errors: [SheetRow, string, string, string?][]): Promise<UnitResult> {
    const issues = new UnitIssues();
    for (const [row, field, reason, detail] of errors) {
      issues.add(row, field, reason, detail);
    }
    this.settle(issues);
    return Promise.resolve('skipped');
  }

  private failWith(issues: UnitIssues, row: SheetRow, error: unknown): never {
    const description = describeException(error);
    if (!description) {
      throw error;
    }
    issues.addDescription(row, description);
    this.settle(issues);
    throw new UnitFailure();
  }

  private rejectDateCells(row: SheetRow, issues: UnitIssues): void {
    for (const column of row.dateColumns ?? []) {
      issues.add(row, column, 'invalidImportValue', 'date');
    }
  }

  private async importKnowledgePoint(row: SheetRow): Promise<UnitResult> {
    const issues = new UnitIssues();
    this.rejectDateCells(row, issues);
    const subjectId = await this.resolveSubject(row, issues);
    const names = pathNames(cell(row, 'path'));
    if (names.length === 0) {
      issues.add(row, 'path', 'importFieldRequired');
    }
    this.settle(issues);
    try {
      const { created } = await this.deps.knowledgePointsService.ensurePath(subjectId!, names);
      return created ? 'written' : 'skipped';
    } catch (error) {
      const description = describeException(error);
      if (!description) {
        throw error;
      }
      issues.addDescription(row, { ...description, field: 'path' });
      this.settle(issues);
      throw new UnitFailure();
    } finally {
      this.knowledgePaths.delete(subjectId!);
    }
  }

  private async importMaterial(unit: MaterialUnit, questionKeyCounts: Map<string, number>): Promise<UnitResult> {
    const issues = new UnitIssues();
    const { row } = unit;
    this.materialKeys.set(unit.key, null);
    for (const child of unit.children) {
      this.markFailedKey(cell(child, 'questionKey'));
    }
    this.rejectDateCells(row, issues);
    const subjectId = await this.resolveSubject(row, issues);
    const id = this.parseId(row, issues);
    const audio = cell(row, 'audio');
    const optional = (column: string): string | null | undefined => cell(row, column) || (id ? undefined : null);
    const fields: UpdateQuestionDto = {
      type: QuestionType.MATERIAL,
      stem: cell(row, 'stem') || (id ? undefined : DEFAULT_MATERIAL_STEM),
      material: optional('material'),
      audioFileId: audio ? PLACEHOLDER_ID : id ? undefined : null,
      analysis: optional('analysis'),
      source: this.parseSource(row, issues),
      sourceNote: optional('sourceNote'),
      isFree: this.parseBoolean(row, 'isFree', issues) ?? (id ? undefined : true),
      ...(id ? {} : { options: null, answer: null }),
    };
    const root: QuestionDraft = {
      row,
      item: id
        ? { ref: refOf(row), id, fields }
        : { ref: refOf(row), id: null, fields: fields as QuestionImportFields },
      assets: this.textAssets(row, { stem: fields.stem, material: fields.material, analysis: fields.analysis }),
      audioAsset: audio ? assetNameOf(audio) : null,
    };
    if (subjectId) {
      await this.checkFields(root, subjectId, false, issues);
    }

    const existing = await this.existingQuestions(unit.children);
    const children: QuestionDraft[] = [];
    const orderOf = (child: SheetRow): number => {
      const order = cell(child, 'order') ? Number(cell(child, 'order')) : NaN;
      return Number.isFinite(order) ? order : Infinity;
    };
    const ordered = unit.children
      .map((child) => ({ child, order: orderOf(child) }))
      .sort((a, b) => a.order - b.order || a.child.row - b.child.row);
    for (const { child } of ordered) {
      if (subjectId && (cell(child, 'exam') || cell(child, 'subject'))) {
        const childSubjectId = await this.resolveSubject(child, issues);
        if (childSubjectId && childSubjectId !== subjectId) {
          issues.add(child, 'subject', 'importSubjectMismatch');
        }
      }
      const draft = await this.parseQuestion(child, subjectId, issues, questionKeyCounts, existing, {
        source: fields.source,
        sourceNote: fields.sourceNote,
      });
      if (draft) {
        children.push(draft);
      }
    }
    this.settle(issues);

    const result = await this.writeUnit(subjectId!, root, children, issues);
    this.materialKeys.set(unit.key, result.rootId);
    for (const child of children) {
      const key = cell(child.row, 'questionKey');
      if (key) {
        this.questionKeys.set(key, result.ids[child.item.ref]);
      }
    }
    return result.kind === 'existing' ? 'skipped' : 'written';
  }

  private async importStandalone(row: SheetRow, questionKeyCounts: Map<string, number>): Promise<UnitResult> {
    const issues = new UnitIssues();
    const key = cell(row, 'questionKey');
    this.markFailedKey(key);
    const subjectId = await this.resolveSubject(row, issues);
    const existing = await this.existingQuestions([row]);
    const draft = await this.parseQuestion(row, subjectId, issues, questionKeyCounts, existing, null);
    this.settle(issues);
    const result = await this.writeUnit(subjectId!, draft!, [], issues);
    if (key) {
      this.questionKeys.set(key, result.rootId);
    }
    return result.kind === 'existing' ? 'skipped' : 'written';
  }

  private async existingQuestions(rows: SheetRow[]): Promise<Map<string, Question>> {
    const ids = rows.map((row) => cell(row, 'id').toLowerCase()).filter((id) => isUUID(id));
    const found = ids.length > 0 ? await this.deps.questionsService.findByIds(ids) : [];
    return new Map(found.map((question) => [question.id, question]));
  }

  /** inherited 为材料小题继承的来源；为 null 时按独立题解析。带 id 的行留空的列保持原值 */
  private async parseQuestion(
    row: SheetRow,
    subjectId: string | null,
    issues: UnitIssues,
    questionKeyCounts: Map<string, number>,
    existing: Map<string, Question>,
    inherited: Pick<QuestionImportFields, 'source' | 'sourceNote'> | null,
  ): Promise<QuestionDraft | null> {
    this.rejectDateCells(row, issues);
    const key = cell(row, 'questionKey');
    if (key && (questionKeyCounts.get(key) ?? 0) > 1) {
      issues.add(row, 'questionKey', 'importDuplicateKey', key);
    }
    const id = this.parseId(row, issues);
    const rawType = cell(row, 'type');
    const type = rawType ? (rawType.toUpperCase() as QuestionType) : id ? existing.get(id)?.type : undefined;
    if (rawType && !QUESTION_TYPES.includes(type!)) {
      issues.add(row, 'type', 'invalidImportValue');
      return null;
    }
    if (!id && !type) {
      issues.add(row, 'type', 'importFieldRequired');
      return null;
    }
    const stem = cell(row, 'stem');
    if (!stem && !id) {
      issues.add(row, 'stem', 'importFieldRequired');
    }
    const options: QuestionOption[] = OPTION_KEYS.flatMap((optionKey) => {
      const content = cell(row, `option${optionKey}`);
      return content ? [{ key: optionKey, content }] : [];
    });
    const answerText = cell(row, 'answer');
    let answer: QuestionImportFields['answer'] | undefined;
    if (answerText || !id) {
      answer = type ? parseAnswerNotation(type, answerText, row.values.points ?? '') : undefined;
      if (answer === undefined) {
        issues.add(row, type ? 'answer' : 'type', type ? 'invalidQuestionAnswer' : 'importFieldRequired');
      }
    }
    const difficulty = this.parseInteger(row, 'difficulty', issues);
    let sort: number | undefined;
    if (inherited) {
      sort = this.parseInteger(row, 'order', issues);
      if (sort === undefined && !id) {
        issues.add(row, 'order', 'importFieldRequired');
      }
    }
    const knowledgePointIds =
      subjectId && cell(row, 'knowledgePath') ? await this.resolveKnowledgePoints(row, subjectId, issues) : undefined;
    const keep = <T>(value: T | undefined, fallback: T): T | undefined =>
      value !== undefined || id ? value : fallback;

    const fields: UpdateQuestionDto = {
      type: rawType ? type : keep(undefined, type),
      stem: stem || undefined,
      options: options.length > 0 ? options : keep(undefined, null),
      answer: answer ?? (id ? undefined : null),
      analysis: cell(row, 'analysis') || keep(undefined, null),
      difficulty,
      knowledgePointIds: keep(knowledgePointIds, []),
      ...(inherited ?? {
        source: this.parseSource(row, issues),
        sourceNote: cell(row, 'sourceNote') || keep(undefined, null),
        isFree: keep(this.parseBoolean(row, 'isFree', issues), true),
      }),
      ...(sort !== undefined && { sort }),
    };
    const draft: QuestionDraft = {
      row,
      item: id
        ? { ref: refOf(row), id, fields }
        : { ref: refOf(row), id: null, fields: fields as QuestionImportFields },
      assets: this.textAssets(row, {
        stem,
        analysis: fields.analysis,
        ...Object.fromEntries(options.map((option) => [`option${option.key}`, option.content])),
      }),
      audioAsset: null,
    };
    if (subjectId && !issues.has(row, 'answer') && !issues.has(row, 'stem')) {
      await this.checkFields(draft, subjectId, !!inherited, issues);
    }
    return draft;
  }

  /** 与题目服务相同的内容规则与字段长度限制，在上传资源之前检查 */
  private async checkFields(
    draft: QuestionDraft,
    subjectId: string,
    isChild: boolean,
    issues: UnitIssues,
  ): Promise<void> {
    const { item } = draft;
    if (item.id === null) {
      const { fields } = item;
      const violation = validateQuestionContent(
        {
          type: fields.type,
          stem: fields.stem,
          options: fields.options ?? null,
          answer: fields.answer ?? null,
          analysis: fields.analysis ?? null,
          material: fields.material ?? null,
          audioFileId: fields.audioFileId ?? null,
          knowledgePointIds: fields.knowledgePointIds ?? [],
        },
        isChild,
      );
      if (violation) {
        issues.add(draft.row, columnOf(violation.field), violation.violation);
      }
    }
    const { errors } =
      item.id === null
        ? await validated(CreateQuestionDto, { ...item.fields, subjectId })
        : await validated(UpdateQuestionDto, item.fields);
    for (const description of errors) {
      issues.addDescription(draft.row, description);
    }
  }

  private async writeUnit(
    subjectId: string,
    root: QuestionDraft,
    children: QuestionDraft[],
    issues: UnitIssues,
  ): Promise<WriteResult> {
    const drafts = [root, ...children];
    await this.uploadAssets(
      drafts.flatMap((draft) => [
        ...draft.assets,
        ...(draft.audioAsset
          ? [{ row: draft.row, field: 'audio', name: draft.audioAsset, purpose: FilePurpose.AUDIO as const }]
          : []),
      ]),
      issues,
    );
    for (const draft of drafts) {
      this.applyAssets(draft);
    }

    try {
      const result = await this.deps.questionsService.importUnit({
        subjectId,
        root: root.item,
        children: children.map((child) => child.item),
        publish: this.options.publish,
      });
      return { kind: 'written', ...result };
    } catch (error) {
      if (!(error instanceof QuestionImportItemError)) {
        throw error;
      }
      const duplicateId = error.ref === root.item.ref && root.item.id === null ? duplicateIdOf(error.cause) : null;
      const existing = duplicateId ? await this.existingUnit(duplicateId, root, children) : null;
      if (existing) {
        return existing;
      }
      const row = drafts.find((draft) => draft.item.ref === error.ref)?.row ?? root.row;
      this.failWith(issues, row, error.cause);
    }
  }

  /** 内容与已有题目相同时绑定到已有题目；材料须小题数一致，按顺序对应 */
  private async existingUnit(
    rootId: string,
    root: QuestionDraft,
    children: QuestionDraft[],
  ): Promise<WriteResult | null> {
    const [unit] = await this.deps.questionsService.findUnits([rootId]);
    if (!unit) {
      return null;
    }
    const existingChildren = unit.root.type === QuestionType.MATERIAL ? unit.questions : [];
    if (existingChildren.length !== children.length) {
      return null;
    }
    const ids: Record<string, string> = { [root.item.ref]: rootId };
    children.forEach((child, index) => (ids[child.item.ref] = existingChildren[index].id));
    return { kind: 'existing', rootId, ids };
  }

  private textAssets(row: SheetRow, texts: Record<string, string | null | undefined>): AssetRequest[] {
    return Object.entries(texts).flatMap(([field, text]) =>
      text ? assetNamesIn(text).map((name) => ({ row, field, name, purpose: FilePurpose.IMAGE as const })) : [],
    );
  }

  private async uploadAssets(requests: AssetRequest[], issues: UnitIssues): Promise<void> {
    for (const request of requests) {
      const cacheKey = `${request.purpose}:${request.name}`;
      if (this.assetFileIds.has(cacheKey)) {
        continue;
      }
      const content = this.pkg.assets.get(request.name);
      if (!content) {
        issues.add(request.row, request.field, 'importAssetNotFound', request.name);
        continue;
      }
      if (!isAllowedAsset(request.name, content, request.purpose)) {
        issues.add(request.row, request.field, 'importAssetTypeNotAllowed', request.name);
        continue;
      }
      try {
        const { file, reused } = await this.deps.fileStorageService.storeDeduplicated(
          content,
          request.name,
          request.purpose,
          null,
        );
        this.assetFileIds.set(cacheKey, file.id);
        if (!reused) {
          this.unitUploads.push({ cacheKey, file });
        }
      } catch (error) {
        const description = describeException(error);
        if (!description) {
          throw error;
        }
        issues.add(request.row, request.field, description.reason, request.name);
      }
    }
    this.settle(issues);
  }

  private applyAssets(draft: QuestionDraft): void {
    const images = new Map(
      [...this.assetFileIds]
        .filter(([key]) => key.startsWith(`${FilePurpose.IMAGE}:`))
        .map(([key, id]) => [key.slice(FilePurpose.IMAGE.length + 1), id]),
    );
    const replace = (text: string | null | undefined): string | null | undefined =>
      text ? replaceAssetLinks(text, images) : text;
    const fields: UpdateQuestionDto = draft.item.fields;
    fields.stem = replace(fields.stem) ?? fields.stem;
    fields.analysis = replace(fields.analysis);
    fields.material = replace(fields.material);
    if (fields.options) {
      fields.options = fields.options.map((option) => ({ key: option.key, content: replace(option.content)! }));
    }
    if (draft.audioAsset) {
      fields.audioFileId = this.assetFileIds.get(`${FilePurpose.AUDIO}:${draft.audioAsset}`) ?? null;
    }
  }

  private async importPaper(row: SheetRow, items: SheetRow[]): Promise<UnitResult> {
    const issues = new UnitIssues();
    this.rejectDateCells(row, issues);
    const subjectId = await this.resolveSubject(row, issues);
    const id = this.parseId(row, issues);
    const type = cell(row, 'type').toUpperCase() as CatalogPaperType;
    if (!CATALOG_PAPER_TYPES.includes(type)) {
      issues.add(row, 'type', cell(row, 'type') ? 'invalidImportValue' : 'importFieldRequired');
    }
    const multiScoringRule = cell(row, 'multiScoringRule').toUpperCase() as MultiScoringRule;
    if (multiScoringRule && !Object.values(MultiScoringRule).includes(multiScoringRule)) {
      issues.add(row, 'multiScoringRule', 'invalidImportValue');
    }
    const durationMin = this.parseInteger(row, 'durationMin', issues);
    if (durationMin === undefined && !cell(row, 'durationMin')) {
      issues.add(row, 'durationMin', 'importFieldRequired');
    }
    const paper = await validated(CreatePaperDto, {
      subjectId: subjectId ?? PLACEHOLDER_ID,
      title: cell(row, 'title'),
      type,
      year: this.parseInteger(row, 'year', issues) ?? null,
      durationMin: durationMin ?? 0,
      multiScoringRule: multiScoringRule || undefined,
      isFree: this.parseBoolean(row, 'isFree', issues) ?? true,
    });
    for (const description of paper.errors) {
      issues.addDescription(row, description);
    }
    const questions = await validated(SetPaperQuestionsDto, await this.paperQuestions(items, issues), false);
    for (const description of questions.errors) {
      issues.addDescription(row, description);
    }
    this.settle(issues);

    if (!id && (await this.paperTitleExists(subjectId!, paper.value.title))) {
      return 'skipped';
    }
    const { subjectId: _subjectId, ...fields } = paper.value;
    try {
      await this.deps.papersService.importPaper({
        id,
        subjectId: subjectId!,
        fields,
        questions: questions.value,
        publish: this.options.publish,
      });
      return 'written';
    } catch (error) {
      this.failWith(issues, row, error);
    }
  }

  private async paperTitleExists(subjectId: string, title: string): Promise<boolean> {
    const { data } = await this.deps.papersService.findManyWithPaginationAndCount({
      filterOptions: { subjectId, keyword: title },
      paginationOptions: { page: 1, limit: PAPER_TITLE_LOOKUP_LIMIT },
    });
    return data.some((paper) => paper.title === title && paper.type !== PaperType.GENERATED);
  }

  private async paperQuestions(rows: SheetRow[], issues: UnitIssues): Promise<SetPaperQuestionsDto> {
    const ordered = rows
      .map((row, index) => {
        this.rejectDateCells(row, issues);
        const raw = cell(row, 'sort');
        const sort = raw ? Number(raw) : index;
        if (!Number.isFinite(sort)) {
          issues.add(row, 'sort', 'invalidImportValue');
        }
        return { row, sort: Number.isFinite(sort) ? sort : index, index };
      })
      .sort((a, b) => a.sort - b.sort || a.index - b.index);

    const sections: SetPaperQuestionsDto['sections'] = [];
    const questions: PaperQuestionItemDto[] = [];
    for (const { row } of ordered) {
      const title = cell(row, 'sectionTitle');
      const sectionType = cell(row, 'sectionType').toUpperCase() as QuestionType;
      if (!title) {
        issues.add(row, 'sectionTitle', 'importFieldRequired');
      }
      if (!Object.values(QuestionType).includes(sectionType)) {
        issues.add(row, 'sectionType', sectionType ? 'invalidImportValue' : 'importFieldRequired');
      }
      let sectionIndex = sections.findIndex((section) => section.title === title);
      if (sectionIndex === -1) {
        sections.push({ title, questionType: sectionType });
        sectionIndex = sections.length - 1;
      } else if (sections[sectionIndex].questionType !== sectionType) {
        issues.add(row, 'sectionType', 'paperSectionTypeConflict');
      } else if (sectionIndex !== sections.length - 1) {
        issues.add(row, 'sectionTitle', 'invalidPaperSection');
      }

      const questionId = this.paperQuestionReference(row, issues);
      const score = Number(cell(row, 'score'));
      if (!cell(row, 'score') || !Number.isFinite(score)) {
        issues.add(row, 'score', cell(row, 'score') ? 'invalidImportValue' : 'importFieldRequired');
      }
      if (questionId) {
        const item = await validated(PaperQuestionItemDto, { questionId, sectionIndex, score });
        for (const description of item.errors) {
          issues.addDescription(row, description);
        }
        questions.push(item.value);
      }
    }
    return { sections, questions };
  }

  private paperQuestionReference(row: SheetRow, issues: UnitIssues): string | null {
    const references = (['questionKey', 'questionId', 'materialKey'] as const).filter((column) => cell(row, column));
    if (references.length !== 1) {
      issues.add(row, 'questionKey', references.length === 0 ? 'importFieldRequired' : 'invalidImportValue');
      return null;
    }
    const [column] = references;
    const value = cell(row, column);
    if (column === 'questionId') {
      if (!isUUID(value)) {
        issues.add(row, column, 'invalidImportValue');
        return null;
      }
      return value.toLowerCase();
    }
    const keys = column === 'questionKey' ? this.questionKeys : this.materialKeys;
    if (!keys.has(value)) {
      issues.add(
        row,
        column,
        column === 'questionKey' ? 'importQuestionKeyNotFound' : 'importMaterialKeyNotFound',
        value,
      );
      return null;
    }
    const id = keys.get(value);
    if (!id) {
      issues.add(row, column, 'importQuestionFailed', value);
      return null;
    }
    return id;
  }

  private async resolveSubject(row: SheetRow, issues: UnitIssues): Promise<string | null> {
    const exam = cell(row, 'exam');
    const subject = cell(row, 'subject');
    if (!exam || !subject) {
      if (!exam) {
        issues.add(row, 'exam', 'importFieldRequired');
      }
      if (!subject) {
        issues.add(row, 'subject', 'importFieldRequired');
      }
      return null;
    }
    const key = `${exam}\u0000${subject}`;
    if (!this.subjects.has(key)) {
      this.subjects.set(
        key,
        this.deps.subjectsService.findByExamAndName(exam, subject).then(
          (found) => found.id,
          (error: unknown) => {
            const description = describeException(error);
            if (!description) {
              throw error;
            }
            return { ...description, field: 'subject' };
          },
        ),
      );
    }
    const resolved = await this.subjects.get(key)!;
    if (typeof resolved === 'string') {
      return resolved;
    }
    issues.addDescription(row, resolved);
    return null;
  }

  private async resolveKnowledgePoints(row: SheetRow, subjectId: string, issues: UnitIssues): Promise<string[]> {
    const paths = splitLines(row.values.knowledgePath ?? '');
    if (!this.knowledgePaths.has(subjectId)) {
      this.knowledgePaths.set(subjectId, this.loadKnowledgePaths(subjectId));
    }
    const byPath = await this.knowledgePaths.get(subjectId)!;
    const ids: string[] = [];
    for (const path of paths) {
      const point = byPath.get(pathNames(path).join('/'));
      if (point) {
        ids.push(point.id);
      } else {
        issues.add(row, 'knowledgePath', 'knowledgePointNotFound', path);
      }
    }
    return [...new Set(ids)];
  }

  private async loadKnowledgePaths(subjectId: string): Promise<Map<string, KnowledgePoint>> {
    const points = await this.deps.knowledgePointsService.findBySubjectId(subjectId);
    const byId = new Map(points.map((point) => [point.id, point]));
    const nameOf = (point: KnowledgePoint): string => {
      const parent = point.parentId ? byId.get(point.parentId) : undefined;
      return parent ? `${nameOf(parent)}/${point.name}` : point.name;
    };
    return new Map(points.map((point) => [nameOf(point), point]));
  }

  private parseId(row: SheetRow, issues: UnitIssues): string | null {
    const id = cell(row, 'id');
    if (!id) {
      return null;
    }
    if (!isUUID(id)) {
      issues.add(row, 'id', 'invalidImportValue');
      return null;
    }
    return id.toLowerCase();
  }

  private parseInteger(row: SheetRow, column: string, issues: UnitIssues): number | undefined {
    const raw = cell(row, column);
    if (!raw) {
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      issues.add(row, column, 'invalidImportValue');
      return undefined;
    }
    return value;
  }

  private parseBoolean(row: SheetRow, column: string, issues: UnitIssues): boolean | undefined {
    const raw = cell(row, column).toLowerCase();
    if (!raw) {
      return undefined;
    }
    if (TRUE_VALUES.has(raw)) {
      return true;
    }
    if (FALSE_VALUES.has(raw)) {
      return false;
    }
    issues.add(row, column, 'invalidImportValue');
    return undefined;
  }

  private parseSource(row: SheetRow, issues: UnitIssues): QuestionSource | undefined {
    const raw = cell(row, 'source').toUpperCase() as QuestionSource;
    if (!raw) {
      return undefined;
    }
    if (!Object.values(QuestionSource).includes(raw)) {
      issues.add(row, 'source', 'invalidImportValue');
      return undefined;
    }
    return raw;
  }
}

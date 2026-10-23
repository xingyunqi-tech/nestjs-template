import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CreateQuestionVersionData,
  KnowledgePointCountDelta,
  QuestionChanges,
  QuestionRepository,
  QuestionTransaction,
} from './infrastructure/persistence/question.repository';
import { QuestionUsageRepository } from './infrastructure/persistence/question-usage.repository';
import { QUESTION_KNOWLEDGE_POINTS_MAX, Question, QuestionSummary } from './domain/question';
import { QuestionType } from './domain/question-type';
import { QuestionSource } from './domain/question-source';
import { QuestionAction, QuestionStatus, QUESTION_TRANSITIONS, publishedCountDelta } from './domain/question-status';
import { QuestionChangeType, QuestionVersion } from './domain/question-version';
import { OperatorProfile, QuestionOperator, isSelfReview } from './domain/question-operator';
import { QuestionAnswer, QuestionOption } from './domain/question-answer';
import { QuestionContent, normalizeAnswer, validateQuestionContent } from './domain/question-content';
import { computeContentHash } from './domain/content-hash';
import {
  isAnswerChange,
  isErrataCompatible,
  isSnapshotChanged,
  sameKnowledgePoints,
} from './domain/question-edit-rules';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionFilterOptions } from './dto/query-admin-question.dto';
import { AdminQuestionDto, AdminQuestionVersionDto } from './dto/admin-question.dto';
import { BatchPublishQuestionsDto, BatchPublishQuestionsResultDto } from './dto/batch-publish-questions.dto';
import {
  BatchQuestionFailureDto,
  BatchQuestionsResultDto,
  BatchUpdateQuestionsDto,
  KnowledgePointUpdateMode,
} from './dto/batch-question-operation.dto';
import { toBatchFailure } from './question-batch';
import { toQuestionOperator } from './dto/question-operator.dto';
import { PublicQuestionUnitDto, toPublicQuestion } from './dto/public-question.dto';
import { QuestionSolutionDto, toQuestionSolution } from './dto/question-solution.dto';
import { QuestionDrawCriteria, QuestionUnit, groupIntoUnits, packUnits } from './domain/question-unit';
import {
  QuestionImportFields,
  QuestionImportItem,
  QuestionImportItemError,
  QuestionImportResult,
  QuestionImportUnit,
} from './question-import';
import { SubjectsService } from '../exams/subjects.service';
import { FilesService } from '../files/files.service';
import { FileUrlResolver, extractFileIds, replaceFileReferences } from '../files/file-url.resolver';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { TransactionHandle } from '../../common/database/transaction-handle';

type UserId = number | string;

const DRAW_CANDIDATE_FACTOR = 3;
const MIN_DRAW_CANDIDATES = 20;
type FileReferencingContent = Pick<Question, 'stem' | 'analysis' | 'material' | 'options' | 'audioFileId'>;
export type FileReferenceSource = Partial<Pick<Question, 'stem' | 'options' | 'analysis' | 'material' | 'audioFileId'>>;

const DEFAULT_DIFFICULTY = 3;

interface TransitionAudit {
  operatorId: number | null;
  rejectReason?: string;
}

export interface ErrataChanges {
  answer: QuestionAnswer;
  analysis?: string | null;
}

export interface ErrataVersion {
  question: Question;
  fromVersion: number;
  toVersion: number;
  answerChanged: boolean;
}

function notFound(): NotFoundException {
  return new NotFoundException({ error: 'questionNotFound' });
}

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function conflict(error: string, errors?: Record<string, string>): ConflictException {
  return new ConflictException({ error, ...(errors && { errors }) });
}

function selfReviewForbidden(questionIds: Question['id'][]): ForbiddenException {
  return new ForbiddenException({ error: 'selfReviewForbidden', errors: { questionIds } });
}

function auditChanges(action: QuestionAction, audit: TransitionAudit, at: Date): QuestionChanges {
  switch (action) {
    case QuestionAction.SUBMIT:
      return { submittedBy: audit.operatorId, submittedAt: at, reviewedBy: null, reviewedAt: null, rejectReason: null };
    case QuestionAction.REJECT:
      return { reviewedBy: audit.operatorId, reviewedAt: at, rejectReason: audit.rejectReason ?? null };
    case QuestionAction.PUBLISH:
    case QuestionAction.OFFLINE:
      return { reviewedBy: audit.operatorId, reviewedAt: at };
  }
}

function plainOptions(options: QuestionOption[] | null | undefined): QuestionOption[] | null | undefined {
  return options ? options.map(({ key, content }) => ({ key, content })) : options;
}

function snapshotOf(
  content: QuestionContent,
  materialVersion: number | null,
): Omit<CreateQuestionVersionData, 'questionId' | 'version' | 'changeType'> {
  return {
    materialVersion,
    type: content.type,
    stem: content.stem,
    options: content.options,
    answer: content.answer,
    analysis: content.analysis,
    material: content.material,
    audioFileId: content.audioFileId,
    knowledgePointIds: [...content.knowledgePointIds],
  };
}

function contentOf(fields: QuestionImportFields): QuestionContent {
  return {
    type: fields.type,
    stem: fields.stem,
    options: plainOptions(fields.options) ?? null,
    answer: normalizeAnswer(fields.type, fields.answer ?? null),
    analysis: fields.analysis ?? null,
    material: fields.material ?? null,
    audioFileId: fields.audioFileId ?? null,
    knowledgePointIds: fields.knowledgePointIds ?? [],
  };
}

async function withItemRef<T>(ref: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof QuestionImportItemError ? error : new QuestionImportItemError(ref, error);
  }
}

function fileReferences(source: FileReferenceSource): [string, string[]][] {
  const fromText = (text: string | null | undefined): string[] => (text ? extractFileIds(text) : []);
  return [
    ['stem', fromText(source.stem)],
    ['options', (source.options ?? []).flatMap((option) => extractFileIds(option.content))],
    ['analysis', fromText(source.analysis)],
    ['material', fromText(source.material)],
    ['audioFileId', source.audioFileId ? [source.audioFileId.toLowerCase()] : []],
  ];
}

function audioUrlOf(source: FileReferenceSource, fileUrls: Record<string, string>): string | null {
  return source.audioFileId ? (fileUrls[source.audioFileId.toLowerCase()] ?? null) : null;
}

function contentTexts(item: FileReferencingContent): string[] {
  return [
    item.stem,
    ...(item.analysis !== null ? [item.analysis] : []),
    ...(item.material !== null ? [item.material] : []),
    ...(item.options ?? []).map((option) => option.content),
  ];
}

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly questionUsageRepository: QuestionUsageRepository,
    private readonly subjectsService: SubjectsService,
    private readonly filesService: FilesService,
    private readonly fileUrlResolver: FileUrlResolver,
  ) {}

  async findManyWithPaginationAndCount(
    options: { filterOptions?: QuestionFilterOptions | null; paginationOptions: IPaginationOptions },
    viewerUserId: UserId,
  ): Promise<{ data: AdminQuestionDto[]; total: number }> {
    const { data, total } = await this.questionRepository.findManyWithPaginationAndCount(options);
    return { data: await this.toAdminDtos(data, viewerUserId), total };
  }

  async getAdminDetail(id: Question['id'], viewerUserId: UserId): Promise<AdminQuestionDto> {
    const question = await this.findById(id);
    const children = question.type === QuestionType.MATERIAL ? await this.questionRepository.findChildren(id) : [];
    const [dto, ...childDtos] = await this.toAdminDtos([question, ...children], viewerUserId);
    if (question.type === QuestionType.MATERIAL) {
      dto.children = childDtos;
    }
    return dto;
  }

  async findVersions(id: Question['id'], viewerUserId: UserId): Promise<AdminQuestionVersionDto[]> {
    await this.findById(id);
    const versions = await this.questionRepository.findVersions(id);
    const fileUrls = await this.resolveFileUrls(versions, viewerUserId);
    return versions.map((version, index) =>
      Object.assign(new AdminQuestionVersionDto(), version, {
        audioUrl: audioUrlOf(version, fileUrls[index]),
        fileUrls: fileUrls[index],
      }),
    );
  }

  async findById(id: Question['id']): Promise<Question> {
    const question = await this.questionRepository.findById(id);
    if (!question) {
      throw notFound();
    }
    return question;
  }

  /** 按传入顺序返回，不存在的忽略 */
  async findByIds(ids: Question['id'][]): Promise<Question[]> {
    const found = new Map((await this.questionRepository.findByIds([...new Set(ids)])).map((q) => [q.id, q]));
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  /** 按传入顺序返回，不存在的忽略 */
  async findSummariesByIds(ids: Question['id'][]): Promise<QuestionSummary[]> {
    const found = new Map((await this.questionRepository.findSummariesByIds([...new Set(ids)])).map((q) => [q.id, q]));
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  /** 独立题或材料组成的出题单位，按传入顺序；小题与不存在的 id 忽略 */
  async findUnits(rootIds: Question['id'][]): Promise<QuestionUnit[]> {
    const roots = (await this.findByIds(rootIds)).filter((question) => question.parentId === null);
    const materialIds = roots.filter((root) => root.type === QuestionType.MATERIAL).map((root) => root.id);
    const children = await this.questionRepository.findChildrenByParentIds(materialIds);
    return roots.map((root) => ({
      root,
      questions: root.type === QuestionType.MATERIAL ? children.filter((child) => child.parentId === root.id) : [root],
    }));
  }

  /** 只读，不加科目锁；键为内容哈希，值为科目内已有题目 id */
  findIdsByContentHashes(subjectId: Question['subjectId'], contentHashes: string[]): Promise<Map<string, string>> {
    return this.questionRepository.transaction([], async (tx) => {
      const found = new Map<string, string>();
      for (const contentHash of new Set(contentHashes)) {
        const id = await tx.findIdByContentHash(subjectId, contentHash, []);
        if (id) {
          found.set(contentHash, id);
        }
      }
      return found;
    });
  }

  async findUnitsByQuestionIds(questionIds: Question['id'][]): Promise<QuestionUnit[]> {
    const questions = await this.findByIds(questionIds);
    const materialIds = [...new Set(questions.flatMap((question) => question.parentId ?? []))];
    const materials = new Map((await this.findByIds(materialIds)).map((material) => [material.id, material]));
    return groupIntoUnits(questions, materials);
  }

  /** 随机抽取已发布题目，以材料为单位，可作答题数尽量凑满 target */
  async drawUnits(criteria: QuestionDrawCriteria, target: number): Promise<QuestionUnit[]> {
    if (target <= 0) {
      return [];
    }
    const candidates = await this.questionRepository.findDrawCandidates(
      criteria,
      Math.max(target * DRAW_CANDIDATE_FACTOR, MIN_DRAW_CANDIDATES),
    );
    return this.findUnits(packUnits(candidates, target).map((candidate) => candidate.id));
  }

  /** 按传入顺序返回各项引用文件的访问地址，键为小写文件 id */
  async resolveFileUrls(sources: FileReferenceSource[], viewerUserId: UserId): Promise<Record<string, string>[]> {
    const ids = sources.map((source) => fileReferences(source).flatMap(([, fileIds]) => fileIds));
    const urls = await this.fileUrlResolver.resolveUrls(ids.flat(), viewerUserId);
    return ids.map((itemIds) => Object.fromEntries(itemIds.filter((id) => id in urls).map((id) => [id, urls[id]])));
  }

  /** 当前版本题面，不含答案与解析 */
  async toPublicUnits(units: QuestionUnit[], viewerUserId: UserId | null): Promise<PublicQuestionUnitDto[]> {
    const copies = units.map((unit) => ({
      root: { ...unit.root },
      questions: unit.root.type === QuestionType.MATERIAL ? unit.questions.map((question) => ({ ...question })) : [],
    }));
    const fileUrls = await this.resolveFileReferences(
      copies.flatMap((unit) => [unit.root, ...unit.questions]),
      viewerUserId,
    );
    return copies.map((unit) => {
      const dto = Object.assign(new PublicQuestionUnitDto(), toPublicQuestion(unit.root, undefined, fileUrls));
      if (unit.root.type === QuestionType.MATERIAL) {
        dto.children = unit.questions.map((question) => toPublicQuestion(question, undefined, fileUrls));
      }
      return dto;
    });
  }

  /** 题面按 versions 指定的版本渲染（缺省为当前版本，材料取小题快照记录的材料版本）；solutionIds 中的题目附带当前版本的答案与解析 */
  async renderUnits(
    units: QuestionUnit[],
    viewerUserId: UserId | null,
    options: { versions?: Record<string, number>; solutionIds?: ReadonlySet<string> } = {},
  ): Promise<{ units: PublicQuestionUnitDto[]; solutions: Map<Question['id'], QuestionSolutionDto> }> {
    const snapshots = options.versions
      ? await this.findRenderSnapshots(units, options.versions)
      : new Map<Question['id'], QuestionVersion>();
    const items = units.flatMap((unit) => {
      const questions = unit.root.type === QuestionType.MATERIAL ? [unit.root, ...unit.questions] : [unit.root];
      return questions.map((question) => {
        const snapshot = snapshots.get(question.id);
        return { question, snapshot: snapshot && { ...snapshot }, current: { ...question } };
      });
    });
    const fileUrls = await this.resolveFileReferences(
      items.map((item) => item.snapshot ?? item.current),
      viewerUserId,
    );
    const rendered = new Map(
      items.map((item) => [
        item.question.id,
        item.snapshot
          ? toPublicQuestion(item.question, item.snapshot, fileUrls)
          : toPublicQuestion(item.current, undefined, fileUrls),
      ]),
    );
    const solutions = new Map(
      items
        .filter((item) => item.question.type !== QuestionType.MATERIAL && options.solutionIds?.has(item.question.id))
        .map((item) => [item.question.id, toQuestionSolution(item.question, item.current.analysis)]),
    );
    return {
      units: units.map((unit) => {
        const dto = Object.assign(new PublicQuestionUnitDto(), rendered.get(unit.root.id));
        if (unit.root.type === QuestionType.MATERIAL) {
          dto.children = unit.questions.map((question) => rendered.get(question.id)!);
        }
        return dto;
      }),
      solutions,
    };
  }

  /** 与当前版本不同的版本快照，键为题目 id */
  private async findRenderSnapshots(
    units: QuestionUnit[],
    versions: Record<string, number>,
  ): Promise<Map<Question['id'], QuestionVersion>> {
    const questions = units.flatMap((unit) => unit.questions);
    const requested = (question: Question): number => versions[question.id] ?? question.currentVersion;
    const childSnapshots = await this.questionRepository.findVersionsByKeys(
      questions
        .filter((question) => question.parentId !== null || requested(question) !== question.currentVersion)
        .filter((question) => requested(question) > 0)
        .map((question) => ({ questionId: question.id, version: requested(question) })),
    );
    const byQuestion = new Map(childSnapshots.map((snapshot) => [snapshot.questionId, snapshot]));

    const materialSnapshots = await this.questionRepository.findVersionsByKeys(
      units.flatMap((unit) => {
        if (unit.root.type !== QuestionType.MATERIAL) {
          return [];
        }
        const materialVersion = unit.questions
          .map((question) => byQuestion.get(question.id)?.materialVersion)
          .find((version) => typeof version === 'number');
        return materialVersion && materialVersion !== unit.root.currentVersion
          ? [{ questionId: unit.root.id, version: materialVersion }]
          : [];
      }),
    );

    const result = new Map<Question['id'], QuestionVersion>();
    for (const question of questions) {
      const snapshot = byQuestion.get(question.id);
      if (snapshot && snapshot.version !== question.currentVersion) {
        result.set(question.id, snapshot);
      }
    }
    materialSnapshots.forEach((snapshot) => result.set(snapshot.questionId, snapshot));
    return result;
  }

  async create(dto: CreateQuestionDto, operatorId: number): Promise<AdminQuestionDto> {
    const content = contentOf(dto);
    this.assertContent(content, !!dto.parentId);
    await this.subjectsService.findById(dto.subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? unprocessable('subjectId', 'subjectNotFound') : error;
    });
    await this.assertFileReferences(content);

    const id = await this.questionRepository.transaction([dto.subjectId], (tx) =>
      this.insertInTx(tx, dto, content, operatorId),
    );
    return this.getAdminDetail(id, operatorId);
  }

  async update(id: Question['id'], dto: UpdateQuestionDto, userId: UserId): Promise<AdminQuestionDto> {
    const existing = await this.findById(id);
    await this.assertFileReferences(dto);

    await this.questionRepository.transaction([existing.subjectId], (tx) => this.updateInTx(tx, id, dto));
    return this.getAdminDetail(id, userId);
  }

  /** 材料与全部小题（或独立题）在一个事务内新建或更新，可选直接发布；任一项失败整体回滚 */
  async importUnit(unit: QuestionImportUnit): Promise<QuestionImportResult> {
    const items = [unit.root, ...unit.children];
    for (const item of items) {
      await withItemRef(item.ref, async () => {
        if (item.id === null) {
          this.assertContent(contentOf(item.fields), item !== unit.root);
        }
        await this.assertFileReferences(item.fields);
      });
    }

    return this.questionRepository.transaction([unit.subjectId], async (tx) => {
      const ids: Record<string, Question['id']> = {};
      const save = (item: QuestionImportItem, parentId: string | null): Promise<Question['id']> =>
        withItemRef(item.ref, async () => {
          if (item.id !== null) {
            await this.updateInTx(tx, item.id, item.fields, { subjectId: unit.subjectId, parentId });
            return item.id;
          }
          const dto: CreateQuestionDto = { ...item.fields, subjectId: unit.subjectId, parentId: parentId ?? undefined };
          return this.insertInTx(tx, dto, contentOf(dto), unit.operatorId);
        });

      const rootId = await save(unit.root, null);
      ids[unit.root.ref] = rootId;
      for (const child of unit.children) {
        ids[child.ref] = await save(child, rootId);
      }
      if (unit.publish) {
        await withItemRef(unit.root.ref, () => this.publishInTx(tx, rootId, unit.operatorId));
      }
      return { rootId, ids };
    });
  }

  /** 基于当前版本只改答案与解析并生成 ERRATA 版本；work 与版本写入在同一事务内执行 */
  async applyErrata<T>(
    id: Question['id'],
    changes: ErrataChanges,
    work: (handle: TransactionHandle, version: ErrataVersion) => Promise<T>,
  ): Promise<T> {
    const existing = await this.findById(id);
    return this.questionRepository.transaction([existing.subjectId], async (tx) => {
      const [current] = await tx.findForUpdate([id]);
      if (!current) {
        throw notFound();
      }
      if (current.type === QuestionType.MATERIAL) {
        throw unprocessable('id', 'errataMaterialNotAllowed');
      }
      if (current.currentVersion === 0) {
        throw conflict('errataQuestionNotPublished');
      }
      const next: QuestionContent = {
        ...current,
        answer: normalizeAnswer(current.type, changes.answer),
        analysis: changes.analysis !== undefined ? changes.analysis : current.analysis,
      };
      this.assertContent(next, current.parentId !== null);
      if (!isErrataCompatible(current, next)) {
        throw unprocessable('answer', 'invalidQuestionAnswer');
      }
      if (!isSnapshotChanged(current, next)) {
        throw unprocessable('answer', 'errataUnchanged');
      }

      const [parent] = current.parentId ? await tx.findForUpdate([current.parentId]) : [];
      const toVersion = current.currentVersion + 1;
      await tx.update([id], { answer: next.answer, analysis: next.analysis, currentVersion: toVersion });
      await tx.insertVersion({
        ...snapshotOf(next, parent ? parent.currentVersion : null),
        questionId: id,
        version: toVersion,
        changeType: QuestionChangeType.ERRATA,
      });
      return work(tx.handle, {
        question: current,
        fromVersion: current.currentVersion,
        toVersion,
        answerChanged: isAnswerChange(current, next),
      });
    });
  }

  adjustStatCorrect(handle: TransactionHandle, id: Question['id'], delta: number): Promise<void> {
    return this.questionRepository.adjustStatCorrect(handle, id, delta);
  }

  private async insertInTx(
    tx: QuestionTransaction,
    dto: CreateQuestionDto,
    content: QuestionContent,
    operatorId: number | null,
  ): Promise<string> {
    const parent = dto.parentId ? await this.lockDraftMaterial(tx, dto.parentId, dto.subjectId) : null;
    await this.assertTaggable(tx, dto.subjectId, content.knowledgePointIds);
    const contentHash = computeContentHash(content, parent?.contentHash ?? null);
    await this.assertUniqueHash(tx, dto.subjectId, contentHash, []);
    const sort = dto.sort ?? (parent ? ((await tx.maxChildSort(parent.id)) ?? -1) + 1 : 0);

    const { knowledgePointIds, ...fields } = content;
    const question = await tx.insert({
      ...fields,
      subjectId: dto.subjectId,
      parentId: parent?.id ?? null,
      difficulty: dto.difficulty ?? DEFAULT_DIFFICULTY,
      source: dto.source ?? QuestionSource.ORIGINAL,
      sourceNote: dto.sourceNote ?? null,
      status: QuestionStatus.DRAFT,
      isFree: parent ? parent.isFree : (dto.isFree ?? true),
      sort,
      contentHash,
      createdBy: operatorId,
    });
    await tx.replaceKnowledgePoints(question.id, knowledgePointIds);
    return question.id;
  }

  private async updateInTx(
    tx: QuestionTransaction,
    id: Question['id'],
    dto: UpdateQuestionDto,
    expected?: Pick<Question, 'subjectId' | 'parentId'>,
  ): Promise<void> {
    const [current] = await tx.findForUpdate([id]);
    if (expected && current?.subjectId !== expected.subjectId) {
      throw unprocessable('id', 'questionNotFound');
    }
    if (!current) {
      throw notFound();
    }
    if (expected && current.parentId !== expected.parentId) {
      throw unprocessable('id', 'invalidQuestionParent');
    }
    if (current.status === QuestionStatus.REVIEWING) {
      throw conflict('questionUnderReview');
    }
    // 试卷按小题顺序套用 childScores，材料发布后小题顺序固定
    if (
      current.parentId !== null &&
      current.status !== QuestionStatus.DRAFT &&
      dto.sort !== undefined &&
      dto.sort !== current.sort
    ) {
      throw unprocessable('sort', 'subQuestionSortLocked');
    }

    const type = dto.type ?? current.type;
    const next: QuestionContent = {
      type,
      stem: dto.stem ?? current.stem,
      options: dto.options !== undefined ? (plainOptions(dto.options) ?? null) : current.options,
      answer: normalizeAnswer(type, dto.answer !== undefined ? dto.answer : current.answer),
      analysis: dto.analysis !== undefined ? dto.analysis : current.analysis,
      material: dto.material !== undefined ? dto.material : current.material,
      audioFileId: dto.audioFileId !== undefined ? dto.audioFileId : current.audioFileId,
      knowledgePointIds: dto.knowledgePointIds ?? current.knowledgePointIds,
    };
    if ((current.type === QuestionType.MATERIAL) !== (type === QuestionType.MATERIAL)) {
      throw unprocessable('type', 'materialTypeImmutable');
    }
    this.assertContent(next, current.parentId !== null);

    const versioned = current.currentVersion > 0;
    if (versioned && isAnswerChange(current, next)) {
      throw new BusinessException('answerChangeNotAllowed');
    }
    const tagsChanged = !sameKnowledgePoints(current.knowledgePointIds, next.knowledgePointIds);
    if (tagsChanged) {
      await this.assertTaggable(tx, current.subjectId, next.knowledgePointIds);
    }

    const [parent] = current.parentId ? await tx.findForUpdate([current.parentId]) : [];
    const contentHash = computeContentHash(next, parent?.contentHash ?? null);
    if (contentHash !== current.contentHash) {
      await this.assertUniqueHash(tx, current.subjectId, contentHash, [id]);
    }

    const isFree = current.parentId ? current.isFree : (dto.isFree ?? current.isFree);
    const snapshotChanged = versioned && isSnapshotChanged(current, next);
    const currentVersion = snapshotChanged ? current.currentVersion + 1 : current.currentVersion;
    const { knowledgePointIds, ...fields } = next;
    await tx.update([id], {
      ...fields,
      difficulty: dto.difficulty ?? current.difficulty,
      source: dto.source ?? current.source,
      sourceNote: dto.sourceNote !== undefined ? dto.sourceNote : current.sourceNote,
      isFree,
      sort: dto.sort ?? current.sort,
      contentHash,
      currentVersion,
    });
    if (current.type === QuestionType.MATERIAL) {
      await this.syncSubQuestions(tx, current, contentHash, isFree);
    }
    if (tagsChanged) {
      await tx.replaceKnowledgePoints(id, knowledgePointIds);
      if (current.status === QuestionStatus.PUBLISHED) {
        await tx.adjustQuestionCounts([
          ...current.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId, delta: -1 })),
          ...knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId, delta: 1 })),
        ]);
      }
    }
    if (snapshotChanged) {
      await tx.insertVersion({
        ...snapshotOf(next, parent ? parent.currentVersion : null),
        questionId: id,
        version: currentVersion,
        changeType: QuestionChangeType.EDIT,
      });
    }
  }

  private async publishInTx(tx: QuestionTransaction, rootId: Question['id'], operatorId: number | null): Promise<void> {
    const [draft] = await tx.findForUpdate([rootId]);
    if (draft?.status === QuestionStatus.DRAFT) {
      await this.transition(tx, [draft], QuestionAction.SUBMIT, { operatorId });
    }
    const [root] = await tx.findForUpdate([rootId]);
    if (root?.status === QuestionStatus.REVIEWING) {
      await this.transition(tx, [root], QuestionAction.PUBLISH, { operatorId });
    }
  }

  changeStatus(
    id: Question['id'],
    action: Exclude<QuestionAction, QuestionAction.REJECT>,
    operator: QuestionOperator,
  ): Promise<AdminQuestionDto> {
    return this.applyAction(id, action, operator, {});
  }

  reject(id: Question['id'], reason: string, operator: QuestionOperator): Promise<AdminQuestionDto> {
    return this.applyAction(id, QuestionAction.REJECT, operator, { rejectReason: reason });
  }

  private async applyAction(
    id: Question['id'],
    action: QuestionAction,
    operator: QuestionOperator,
    audit: Omit<TransitionAudit, 'operatorId'>,
  ): Promise<AdminQuestionDto> {
    const existing = await this.findById(id);
    if (existing.parentId) {
      throw conflict('subQuestionStatusLocked');
    }
    await this.transitionRoot(id, existing.subjectId, action, operator, audit);
    return this.getAdminDetail(id, operator.id);
  }

  private transitionRoot(
    rootId: Question['id'],
    subjectId: Question['subjectId'],
    action: QuestionAction,
    operator: QuestionOperator,
    audit: Omit<TransitionAudit, 'operatorId'>,
  ): Promise<number> {
    return this.questionRepository.transaction([subjectId], async (tx) => {
      const roots = await tx.findForUpdate([rootId]);
      if (roots.length === 0) {
        throw notFound();
      }
      if (action === QuestionAction.PUBLISH || action === QuestionAction.REJECT) {
        this.assertNotSelfReview(roots, operator);
      }
      return this.transition(tx, roots, action, { ...audit, operatorId: operator.id });
    });
  }

  batchSubmit(ids: Question['id'][], operator: QuestionOperator): Promise<BatchQuestionsResultDto> {
    return this.batchTransition(ids, QuestionAction.SUBMIT, operator, {});
  }

  batchReject(ids: Question['id'][], reason: string, operator: QuestionOperator): Promise<BatchQuestionsResultDto> {
    return this.batchTransition(ids, QuestionAction.REJECT, operator, { rejectReason: reason });
  }

  batchOffline(ids: Question['id'][], operator: QuestionOperator): Promise<BatchQuestionsResultDto> {
    return this.batchTransition(ids, QuestionAction.OFFLINE, operator, {});
  }

  private batchTransition(
    ids: Question['id'][],
    action: QuestionAction,
    operator: QuestionOperator,
    audit: Omit<TransitionAudit, 'operatorId'>,
  ): Promise<BatchQuestionsResultDto> {
    return this.runBatch(
      ids,
      (question) => question.parentId ?? question.id,
      async (rootId, subjectId) => {
        await this.transitionRoot(rootId, subjectId, action, operator, audit);
      },
    );
  }

  /** 小题单独删除，与所属材料同批时随材料删除 */
  batchRemove(ids: Question['id'][]): Promise<BatchQuestionsResultDto> {
    const requested = new Set(ids);
    return this.runBatch(
      ids,
      (question) => (question.parentId !== null && requested.has(question.parentId) ? question.parentId : question.id),
      (id, subjectId) => this.removeInTransaction(id, subjectId),
    );
  }

  /** 逐题按单题编辑规则更新，小题不随材料归并 */
  async batchUpdate(dto: BatchUpdateQuestionsDto): Promise<BatchQuestionsResultDto> {
    const { ids, knowledgePointIds, mode, difficulty, source, isFree } = dto;
    if ([knowledgePointIds, difficulty, source, isFree].every((value) => value === undefined)) {
      throw new UnprocessableEntityException({ error: 'batchUpdateFieldsRequired' });
    }
    return this.runBatch(
      ids,
      (question) => question.id,
      (id, subjectId) =>
        this.questionRepository.transaction([subjectId], async (tx) => {
          const [current] = await tx.findForUpdate([id]);
          if (!current) {
            throw notFound();
          }
          const changes: UpdateQuestionDto = { difficulty, source, isFree };
          if (knowledgePointIds !== undefined) {
            changes.knowledgePointIds =
              mode === KnowledgePointUpdateMode.APPEND
                ? [...new Set([...current.knowledgePointIds, ...knowledgePointIds])]
                : knowledgePointIds;
            if (changes.knowledgePointIds.length > QUESTION_KNOWLEDGE_POINTS_MAX) {
              throw unprocessable('knowledgePointIds', 'questionKnowledgePointsTooMany');
            }
          }
          await this.updateInTx(tx, id, changes);
        }),
    );
  }

  /** 按 targetOf 归并后逐个目标独立执行，同一目标的请求 id 共享结果；返回失败项按请求顺序 */
  private async runBatch(
    ids: Question['id'][],
    targetOf: (question: Question) => Question['id'],
    work: (targetId: Question['id'], subjectId: Question['subjectId']) => Promise<unknown>,
  ): Promise<BatchQuestionsResultDto> {
    const found = new Map((await this.findByIds(ids)).map((question) => [question.id, question]));
    const targets = new Map<Question['id'], { subjectId: Question['subjectId']; ids: Question['id'][] }>();
    const failures = new Map<Question['id'], BatchQuestionFailureDto>();
    for (const id of ids) {
      const question = found.get(id);
      if (!question) {
        failures.set(id, toBatchFailure(id, notFound()));
        continue;
      }
      const targetId = targetOf(question);
      const target = targets.get(targetId) ?? { subjectId: question.subjectId, ids: [] };
      target.ids.push(id);
      targets.set(targetId, target);
    }
    for (const [targetId, target] of targets) {
      try {
        await work(targetId, target.subjectId);
      } catch (error) {
        if (!(error instanceof HttpException)) {
          this.logger.error(`Batch operation failed on question ${targetId}`, error);
        }
        target.ids.forEach((id) => failures.set(id, toBatchFailure(id, error)));
      }
    }
    return {
      succeeded: ids.length - failures.size,
      failed: ids.flatMap((id) => failures.get(id) ?? []),
    };
  }

  /** 任一题为当前操作人提交待审时整批拒绝 */
  async batchPublish(
    dto: BatchPublishQuestionsDto,
    operator: QuestionOperator,
  ): Promise<BatchPublishQuestionsResultDto> {
    const found = await this.questionRepository.findByIds(dto.ids);
    if (found.length !== dto.ids.length) {
      throw notFound();
    }
    const rootIds = [...new Set(found.map((question) => question.parentId ?? question.id))];
    const count = await this.questionRepository.transaction(
      found.map((question) => question.subjectId),
      async (tx) => {
        const roots = await tx.findForUpdate(rootIds);
        if (roots.length !== rootIds.length) {
          throw notFound();
        }
        this.assertNotSelfReview(roots, operator);
        return this.transition(tx, roots, QuestionAction.PUBLISH, { operatorId: operator.id });
      },
    );
    return { count };
  }

  /** 只校验待审的题，从下架重新发布不受限 */
  private assertNotSelfReview(roots: Question[], operator: QuestionOperator): void {
    const selfReviewed = roots
      .filter((root) => root.status === QuestionStatus.REVIEWING && isSelfReview(root, operator))
      .map((root) => root.id);
    if (selfReviewed.length > 0) {
      throw selfReviewForbidden(selfReviewed);
    }
  }

  /** 仅删除未发布过且未被作答或试卷引用的草稿，材料连同小题一起删除 */
  async remove(id: Question['id']): Promise<void> {
    const existing = await this.findById(id);
    await this.removeInTransaction(id, existing.subjectId);
  }

  private removeInTransaction(id: Question['id'], subjectId: Question['subjectId']): Promise<void> {
    return this.questionRepository.transaction([subjectId], async (tx) => {
      const [current] = await tx.findForUpdate([id]);
      if (!current) {
        throw notFound();
      }
      if (current.status !== QuestionStatus.DRAFT || current.currentVersion > 0) {
        throw conflict('onlyDraftDeletable');
      }
      const children = current.type === QuestionType.MATERIAL ? await tx.findChildrenForUpdate([id]) : [];
      const ids = [id, ...children.map((child) => child.id)];
      if (await this.questionUsageRepository.isUsed(ids)) {
        throw conflict('questionInUse');
      }
      await tx.remove(ids);
    });
  }

  /** 材料与全部小题整体流转，返回变更的题目数 */
  private async transition(
    tx: QuestionTransaction,
    roots: Question[],
    action: QuestionAction,
    audit: TransitionAudit,
  ): Promise<number> {
    const { from, to } = QUESTION_TRANSITIONS[action];
    if (roots.some((root) => !from.includes(root.status))) {
      throw conflict('invalidStatusTransition');
    }
    const materialIds = roots.filter((root) => root.type === QuestionType.MATERIAL).map((root) => root.id);
    const children = await tx.findChildrenForUpdate(materialIds);
    if (
      action === QuestionAction.SUBMIT &&
      materialIds.some((id) => !children.some((child) => child.parentId === id))
    ) {
      throw conflict('materialHasNoSubQuestions');
    }

    const group = [...roots, ...children];
    if (to === QuestionStatus.PUBLISHED) {
      const materialVersions = new Map(roots.map((root) => [root.id, Math.max(root.currentVersion, 1)]));
      const firstPublished = group.filter((question) => question.currentVersion === 0);
      for (const question of firstPublished) {
        await tx.insertVersion({
          ...snapshotOf(question, question.parentId ? (materialVersions.get(question.parentId) ?? null) : null),
          questionId: question.id,
          version: 1,
          changeType: QuestionChangeType.PUBLISH,
        });
      }
      await tx.update(
        firstPublished.map((question) => question.id),
        { currentVersion: 1 },
      );
    }
    await tx.update(
      group.map((question) => question.id),
      { status: to, ...auditChanges(action, audit, new Date()) },
    );

    const deltas: KnowledgePointCountDelta[] = group.flatMap((question) => {
      const delta = publishedCountDelta(question.status, to);
      return delta === 0 ? [] : question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId, delta }));
    });
    await tx.adjustQuestionCounts(deltas);
    return group.length;
  }

  private async syncSubQuestions(
    tx: QuestionTransaction,
    material: Question,
    contentHash: string,
    isFree: boolean,
  ): Promise<void> {
    const children = await tx.findChildrenForUpdate([material.id]);
    if (contentHash !== material.contentHash) {
      for (const child of children) {
        const childHash = computeContentHash(child, contentHash);
        await this.assertUniqueHash(tx, material.subjectId, childHash, [child.id]);
        await tx.update([child.id], { contentHash: childHash });
      }
    }
    if (isFree !== material.isFree) {
      await tx.update(
        children.map((child) => child.id),
        { isFree },
      );
    }
  }

  private async lockDraftMaterial(tx: QuestionTransaction, parentId: string, subjectId: string): Promise<Question> {
    const [parent] = await tx.findForUpdate([parentId]);
    if (parent?.subjectId !== subjectId || parent.type !== QuestionType.MATERIAL) {
      throw unprocessable('parentId', 'invalidQuestionParent');
    }
    if (parent.status !== QuestionStatus.DRAFT) {
      throw conflict('materialNotDraft');
    }
    return parent;
  }

  private assertContent(content: QuestionContent, isSubQuestion: boolean): void {
    const error = validateQuestionContent(content, isSubQuestion);
    if (error) {
      throw unprocessable(error.field, error.violation);
    }
  }

  private async assertTaggable(tx: QuestionTransaction, subjectId: string, knowledgePointIds: string[]): Promise<void> {
    if (knowledgePointIds.length === 0) {
      return;
    }
    const points = await tx.findKnowledgePointsForUpdate(knowledgePointIds);
    if (points.length !== knowledgePointIds.length || points.some((point) => point.subjectId !== subjectId)) {
      throw unprocessable('knowledgePointIds', 'invalidKnowledgePoint');
    }
    if (points.some((point) => !point.isLeaf)) {
      throw unprocessable('knowledgePointIds', 'questionKnowledgePointNotLeaf');
    }
  }

  private async assertUniqueHash(
    tx: QuestionTransaction,
    subjectId: string,
    contentHash: string,
    excludeIds: string[],
  ): Promise<void> {
    const duplicateId = await tx.findIdByContentHash(subjectId, contentHash, excludeIds);
    if (duplicateId) {
      throw conflict('duplicateQuestion', { duplicateQuestionId: duplicateId });
    }
  }

  /** 引用的文件须存在且非私有；assumedPublic 中的文件 id 视为可引用 */
  async assertFileReferences(
    source: FileReferenceSource,
    assumedPublic: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const references = fileReferences(source).map(([field, fileIds]): [string, string[]] => [
      field,
      fileIds.filter((id) => !assumedPublic.has(id)),
    ]);
    const ids = [...new Set(references.flatMap(([, fileIds]) => fileIds))];
    if (ids.length === 0) {
      return;
    }
    const files = new Map((await this.filesService.findByIds(ids)).map((file) => [file.id.toLowerCase(), file]));
    for (const [field, fileIds] of references) {
      if (fileIds.some((id) => !files.has(id))) {
        throw unprocessable(field, 'fileNotFound');
      }
      if (fileIds.some((id) => !this.filesService.canAccess(files.get(id)!, null))) {
        throw unprocessable(field, 'fileNotAccessible');
      }
    }
  }

  private async toAdminDtos(questions: Question[], viewerUserId: UserId): Promise<AdminQuestionDto[]> {
    const [fileUrls, profiles] = await Promise.all([
      this.resolveFileUrls(questions, viewerUserId),
      this.findOperatorProfiles(questions),
    ]);
    return questions.map((question, index) =>
      Object.assign(new AdminQuestionDto(), question, {
        audioUrl: audioUrlOf(question, fileUrls[index]),
        fileUrls: fileUrls[index],
        creator: toQuestionOperator(question.createdBy, profiles),
        submitter: toQuestionOperator(question.submittedBy, profiles),
        reviewer: toQuestionOperator(question.reviewedBy, profiles),
      }),
    );
  }

  private async findOperatorProfiles(questions: Question[]): Promise<Map<number, OperatorProfile>> {
    const ids = [
      ...new Set(
        questions.flatMap((question) =>
          [question.createdBy, question.submittedBy, question.reviewedBy].filter((id): id is number => id !== null),
        ),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    const profiles = await this.questionRepository.findOperatorProfiles(ids);
    return new Map(profiles.map((profile) => [profile.id, profile]));
  }

  /** 正文引用就地替换为访问地址，返回本次解析的地址表（含音频），键为小写文件 id */
  private async resolveFileReferences<T extends FileReferencingContent>(
    items: T[],
    viewerUserId: UserId | null,
  ): Promise<Record<string, string>> {
    const texts = items.flatMap(contentTexts);
    const urls = await this.fileUrlResolver.resolveUrls(
      [...texts.flatMap(extractFileIds), ...items.flatMap((item) => item.audioFileId ?? [])],
      viewerUserId,
    );
    const resolved = texts.map((text) => replaceFileReferences(text, urls));
    let index = 0;
    const next = (): string => resolved[index++];
    for (const item of items) {
      item.stem = next();
      if (item.analysis !== null) {
        item.analysis = next();
      }
      if (item.material !== null) {
        item.material = next();
      }
      item.options = item.options?.map((option) => ({ key: option.key, content: next() })) ?? null;
    }
    return urls;
  }
}

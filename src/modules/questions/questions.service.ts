import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CreateQuestionVersionData,
  KnowledgePointCountDelta,
  QuestionRepository,
  QuestionTransaction,
} from './infrastructure/persistence/question.repository';
import { QuestionUsageRepository } from './infrastructure/persistence/question-usage.repository';
import { Question } from './domain/question';
import { QuestionType } from './domain/question-type';
import { QuestionSource } from './domain/question-source';
import { QuestionAction, QuestionStatus, QUESTION_TRANSITIONS, publishedCountDelta } from './domain/question-status';
import { QuestionChangeType, QuestionVersion } from './domain/question-version';
import { QuestionOption } from './domain/question-answer';
import { QuestionContent, normalizeAnswer, validateQuestionContent } from './domain/question-content';
import { computeContentHash } from './domain/content-hash';
import { isAnswerChange, isSnapshotChanged, sameKnowledgePoints } from './domain/question-edit-rules';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionFilterOptions } from './dto/query-admin-question.dto';
import { AdminQuestionDto } from './dto/admin-question.dto';
import { BatchPublishQuestionsDto, BatchPublishQuestionsResultDto } from './dto/batch-publish-questions.dto';
import { PublicQuestionUnitDto, toPublicQuestion } from './dto/public-question.dto';
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
import { FileUrlResolver, extractFileIds } from '../files/file-url.resolver';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IPaginationOptions } from '../../common/types/pagination-options';

type UserId = number | string;

const DRAW_CANDIDATE_FACTOR = 3;
const MIN_DRAW_CANDIDATES = 20;
type FileReferencingContent = Pick<Question, 'stem' | 'analysis' | 'material' | 'options'>;
type FileReferenceSource = Partial<Pick<Question, 'stem' | 'options' | 'analysis' | 'material' | 'audioFileId'>>;

const DEFAULT_DIFFICULTY = 3;

function notFound(): NotFoundException {
  return new NotFoundException({ error: 'questionNotFound' });
}

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function conflict(error: string, errors?: Record<string, string>): ConflictException {
  return new ConflictException({ error, ...(errors && { errors }) });
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
    const resolved = await this.resolveFileReferences(data, viewerUserId);
    return { data: resolved.map((question) => Object.assign(new AdminQuestionDto(), question)), total };
  }

  async getAdminDetail(id: Question['id'], viewerUserId: UserId): Promise<AdminQuestionDto> {
    const question = await this.findById(id);
    const children = question.type === QuestionType.MATERIAL ? await this.questionRepository.findChildren(id) : [];
    await this.resolveFileReferences([question, ...children], viewerUserId);
    const dto = Object.assign(new AdminQuestionDto(), question);
    if (question.type === QuestionType.MATERIAL) {
      dto.children = children.map((child) => Object.assign(new AdminQuestionDto(), child));
    }
    return dto;
  }

  async findVersions(id: Question['id'], viewerUserId: UserId): Promise<QuestionVersion[]> {
    await this.findById(id);
    return this.resolveFileReferences(await this.questionRepository.findVersions(id), viewerUserId);
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

  /** 解析文本中的 file:{id} 引用 */
  resolveFileTexts(texts: string[], viewerUserId: UserId): Promise<string[]> {
    return this.fileUrlResolver.resolveMany(texts, viewerUserId);
  }

  /** 当前版本题面，不含答案与解析 */
  async toPublicUnits(units: QuestionUnit[], viewerUserId: UserId | null): Promise<PublicQuestionUnitDto[]> {
    const copies = units.map((unit) => ({
      root: { ...unit.root },
      questions: unit.root.type === QuestionType.MATERIAL ? unit.questions.map((question) => ({ ...question })) : [],
    }));
    await this.resolveFileReferences(
      copies.flatMap((unit) => [unit.root, ...unit.questions]),
      viewerUserId,
    );
    return copies.map((unit) => {
      const dto = Object.assign(new PublicQuestionUnitDto(), toPublicQuestion(unit.root));
      if (unit.root.type === QuestionType.MATERIAL) {
        dto.children = unit.questions.map((question) => toPublicQuestion(question));
      }
      return dto;
    });
  }

  async create(dto: CreateQuestionDto, userId: UserId): Promise<AdminQuestionDto> {
    const content = contentOf(dto);
    this.assertContent(content, !!dto.parentId);
    await this.subjectsService.findById(dto.subjectId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? unprocessable('subjectId', 'subjectNotFound') : error;
    });
    await this.assertFileReferences(content);

    const id = await this.questionRepository.transaction([dto.subjectId], (tx) => this.insertInTx(tx, dto, content));
    return this.getAdminDetail(id, userId);
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
          return this.insertInTx(tx, dto, contentOf(dto));
        });

      const rootId = await save(unit.root, null);
      ids[unit.root.ref] = rootId;
      for (const child of unit.children) {
        ids[child.ref] = await save(child, rootId);
      }
      if (unit.publish) {
        await withItemRef(unit.root.ref, () => this.publishInTx(tx, rootId));
      }
      return { rootId, ids };
    });
  }

  private async insertInTx(tx: QuestionTransaction, dto: CreateQuestionDto, content: QuestionContent): Promise<string> {
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

  private async publishInTx(tx: QuestionTransaction, rootId: Question['id']): Promise<void> {
    const [draft] = await tx.findForUpdate([rootId]);
    if (draft?.status === QuestionStatus.DRAFT) {
      await this.transition(tx, [draft], QuestionAction.SUBMIT);
    }
    const [root] = await tx.findForUpdate([rootId]);
    if (root?.status === QuestionStatus.REVIEWING) {
      await this.transition(tx, [root], QuestionAction.PUBLISH);
    }
  }

  async changeStatus(id: Question['id'], action: QuestionAction, userId: UserId): Promise<AdminQuestionDto> {
    const existing = await this.findById(id);
    if (existing.parentId) {
      throw conflict('subQuestionStatusLocked');
    }
    await this.questionRepository.transaction([existing.subjectId], async (tx) => {
      const roots = await tx.findForUpdate([id]);
      if (roots.length === 0) {
        throw notFound();
      }
      await this.transition(tx, roots, action);
    });
    return this.getAdminDetail(id, userId);
  }

  async batchPublish(dto: BatchPublishQuestionsDto): Promise<BatchPublishQuestionsResultDto> {
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
        return this.transition(tx, roots, QuestionAction.PUBLISH);
      },
    );
    return { count };
  }

  /** 仅删除未发布过且未被作答或试卷引用的草稿，材料连同小题一起删除 */
  async remove(id: Question['id']): Promise<void> {
    const existing = await this.findById(id);
    await this.questionRepository.transaction([existing.subjectId], async (tx) => {
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
  private async transition(tx: QuestionTransaction, roots: Question[], action: QuestionAction): Promise<number> {
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
      { status: to },
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

  /** 引用的文件须存在且非私有 */
  private async assertFileReferences(source: FileReferenceSource): Promise<void> {
    const references = fileReferences(source);
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

  private async resolveFileReferences<T extends FileReferencingContent>(
    items: T[],
    viewerUserId: UserId | null,
  ): Promise<T[]> {
    const resolved = await this.fileUrlResolver.resolveMany(items.flatMap(contentTexts), viewerUserId);
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
    return items;
  }
}

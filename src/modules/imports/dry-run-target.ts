import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { KnowledgePointViolation, checkCanAddChild, knowledgePointPath } from '../exams/domain/knowledge-point-rules';
import { ContentStatus } from '../exams/domain/content-status';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionStatus, QUESTION_TRANSITIONS, QuestionAction } from '../questions/domain/question-status';
import { QuestionUnit } from '../questions/domain/question-unit';
import { QuestionContent, normalizeAnswer, validateQuestionContent } from '../questions/domain/question-content';
import { computeContentHash } from '../questions/domain/content-hash';
import { isAnswerChange, sameKnowledgePoints } from '../questions/domain/question-edit-rules';
import { UpdateQuestionDto } from '../questions/dto/update-question.dto';
import {
  QuestionImportFields,
  QuestionImportItem,
  QuestionImportItemError,
  QuestionImportResult,
  QuestionImportUnit,
} from '../questions/question-import';
import { PaperImportInput } from '../papers/paper-import';
import { sumPaperScores } from '../papers/domain/paper-score';
import { PAPER_QUESTION_LIMITS, SetPaperQuestionsDto } from '../papers/dto/set-paper-questions.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AssetPurpose } from './package/asset-kind';
import { ImportSessionDeps, ImportTarget, StoredAsset, catalogPaperTitleExists } from './import-target';

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

function conflict(error: string, errors?: Record<string, string>): ConflictException {
  return new ConflictException({ error, ...(errors && { errors }) });
}

function assertContent(content: QuestionContent, isSubQuestion: boolean): void {
  const error = validateQuestionContent(content, isSubQuestion);
  if (error) {
    throw unprocessable(error.field, error.violation);
  }
}

function contentOf(fields: QuestionImportFields): QuestionContent {
  return {
    type: fields.type,
    stem: fields.stem,
    options: fields.options ? fields.options.map(({ key, content }) => ({ key, content })) : null,
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

const keyOf = (subjectId: string, value: string): string => `${subjectId}\u0000${value}`;

/** 一个导入单元内的改动先暂存，单元成功后提交，失败时丢弃 */
class Staged<K, V> {
  private readonly committed = new Map<K, V>();
  private readonly pending = new Map<K, V>();

  has(key: K): boolean {
    return this.pending.has(key) || this.committed.has(key);
  }

  get(key: K): V | undefined {
    return this.pending.has(key) ? this.pending.get(key) : this.committed.get(key);
  }

  set(key: K, value: V): void {
    this.pending.set(key, value);
  }

  commit(): void {
    this.pending.forEach((value, key) => this.committed.set(key, value));
    this.pending.clear();
  }

  rollback(): void {
    this.pending.clear();
  }
}

/** 预检用：只读查询题库，写入在内存中模拟，规则与各模块服务的导入写入一致 */
export class DryRunImportTarget implements ImportTarget {
  private readonly knowledgePoints = new Map<string, Promise<KnowledgePoint[]>>();
  private readonly simulatedPointIds = new Set<string>();
  private readonly linkedPoints = new Map<string, Promise<boolean>>();
  private readonly storedQuestions = new Map<string, Question | null>();
  private readonly storedChildren = new Map<string, string[]>();
  private readonly storedHashOwners = new Map<string, string | null>();
  private readonly questions = new Staged<string, Question>();
  private readonly children = new Staged<string, string[]>();
  private readonly hashOwners = new Staged<string, string | null>();
  private readonly paperTitles = new Set<string>();
  private readonly papers = new Map<string, { subjectId: string; status: ContentStatus }>();
  private readonly placeholderFiles = new Map<string, string>();

  constructor(
    private readonly deps: ImportSessionDeps,
    private readonly operatorId: number | null,
  ) {}

  async ensureKnowledgePath(subjectId: string, names: string[]): Promise<boolean> {
    const points = await this.pointsOf(subjectId);
    let parent = null as KnowledgePoint | null;
    let created = false;
    for (const name of names) {
      const parentId: string | null = parent?.id ?? null;
      const siblings: KnowledgePoint[] = points.filter((point) => point.parentId === parentId);
      let current: KnowledgePoint | undefined = siblings.find((point) => point.name === name);
      if (!current) {
        if (parent) {
          await this.assertCanAddChild(parent);
        }
        const id = randomUUID();
        current = Object.assign(new KnowledgePoint(), {
          id,
          subjectId,
          parentId,
          name,
          level: (parent?.level ?? 0) + 1,
          sort: siblings.length,
          path: knowledgePointPath(parent?.path ?? null, id),
          isLeaf: true,
          questionCount: 0,
        });
        points.push(current);
        this.simulatedPointIds.add(id);
        if (parent) {
          parent.isLeaf = false;
        }
        created = true;
      }
      parent = current;
    }
    if (!parent) {
      throw unprocessable('name', 'knowledgePointNotFound');
    }
    return created;
  }

  async findKnowledgePoints(subjectId: string): Promise<KnowledgePoint[]> {
    return [...(await this.pointsOf(subjectId))];
  }

  async storeAsset(content: Buffer, name: string, purpose: AssetPurpose): Promise<StoredAsset> {
    const existing = await this.deps.fileStorageService.findDeduplicated(content, name, purpose);
    if (existing) {
      return { fileId: existing.id, discard: null };
    }
    const key = `${purpose}:${createHash('sha256').update(content).digest('hex')}`;
    const known = this.placeholderFiles.get(key);
    if (known) {
      return { fileId: known, discard: null };
    }
    const fileId = randomUUID();
    this.placeholderFiles.set(key, fileId);
    return {
      fileId,
      discard: () => {
        this.placeholderFiles.delete(key);
        return Promise.resolve();
      },
    };
  }

  async importQuestionUnit(unit: QuestionImportUnit): Promise<QuestionImportResult> {
    const items = [unit.root, ...unit.children];
    const placeholderIds = new Set(this.placeholderFiles.values());
    for (const item of items) {
      await withItemRef(item.ref, async () => {
        if (item.id === null) {
          assertContent(contentOf(item.fields), item !== unit.root);
        }
        await this.deps.questionsService.assertFileReferences(item.fields, placeholderIds);
      });
    }
    await this.prefetchHashes(unit);
    try {
      const rootId = await this.save(unit, unit.root, null);
      const ids: Record<string, string> = { [unit.root.ref]: rootId };
      for (const child of unit.children) {
        ids[child.ref] = await this.save(unit, child, rootId);
      }
      if (unit.publish) {
        await withItemRef(unit.root.ref, () => this.publish(rootId));
      }
      this.questions.commit();
      this.children.commit();
      this.hashOwners.commit();
      return { rootId, ids };
    } catch (error) {
      this.questions.rollback();
      this.children.rollback();
      this.hashOwners.rollback();
      throw error;
    }
  }

  async findQuestions(ids: string[]): Promise<Question[]> {
    await this.preloadQuestions(ids);
    const found: Question[] = [];
    for (const id of ids) {
      const question = await this.question(id);
      if (question) {
        found.push(question);
      }
    }
    return found;
  }

  async findQuestionUnits(rootIds: string[]): Promise<QuestionUnit[]> {
    await this.preloadUnits(rootIds);
    const units: QuestionUnit[] = [];
    for (const id of rootIds) {
      const root = await this.question(id);
      if (root?.parentId !== null) {
        continue;
      }
      const questions =
        root.type === QuestionType.MATERIAL
          ? (await Promise.all((await this.childIdsOf(id)).map((childId) => this.question(childId)))).filter(
              (child): child is Question => !!child,
            )
          : [root];
      units.push({ root, questions });
    }
    return units;
  }

  async paperTitleExists(subjectId: string, title: string): Promise<boolean> {
    return (
      this.paperTitles.has(keyOf(subjectId, title)) ||
      catalogPaperTitleExists(this.deps.papersService, subjectId, title)
    );
  }

  async importPaper(input: PaperImportInput): Promise<void> {
    if (input.id) {
      const existing = this.papers.get(input.id) ?? (await this.deps.papersService.findByIds([input.id]))[0];
      if (existing?.subjectId !== input.subjectId) {
        throw unprocessable('id', 'paperNotFound');
      }
      if (existing.status !== ContentStatus.DRAFT) {
        throw conflict('paperFrozen');
      }
    }
    const rowCount = await this.countPaperRows(input.subjectId, input.questions);
    if (input.publish && rowCount === 0) {
      throw conflict('paperHasNoQuestions');
    }
    if (input.id) {
      this.papers.set(input.id, {
        subjectId: input.subjectId,
        status: input.publish ? ContentStatus.PUBLISHED : ContentStatus.DRAFT,
      });
    }
    this.paperTitles.add(keyOf(input.subjectId, input.fields.title));
  }

  private pointsOf(subjectId: string): Promise<KnowledgePoint[]> {
    let points = this.knowledgePoints.get(subjectId);
    if (!points) {
      points = this.deps.knowledgePointsService
        .findBySubjectId(subjectId)
        .then((found) => found.map((point) => Object.assign(new KnowledgePoint(), point)));
      this.knowledgePoints.set(subjectId, points);
    }
    return points;
  }

  private async assertCanAddChild(parent: KnowledgePoint): Promise<void> {
    const linked =
      parent.isLeaf && !this.simulatedPointIds.has(parent.id) && (await this.hasLinkedQuestions(parent.id));
    const violation = checkCanAddChild(parent, linked ? 1 : 0);
    if (violation === KnowledgePointViolation.HAS_QUESTIONS) {
      throw conflict(violation);
    }
    if (violation) {
      throw unprocessable('parentId', violation);
    }
  }

  private hasLinkedQuestions(knowledgePointId: string): Promise<boolean> {
    let linked = this.linkedPoints.get(knowledgePointId);
    if (!linked) {
      linked = this.deps.questionsService
        .findManyWithPaginationAndCount(
          { filterOptions: { knowledgePointId }, paginationOptions: { page: 1, limit: 1 } },
          this.operatorId ?? 0,
        )
        .then(({ total }) => total > 0);
      this.linkedPoints.set(knowledgePointId, linked);
    }
    return linked;
  }

  private async preloadQuestions(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.questions.has(id) && !this.storedQuestions.has(id));
    if (missing.length === 0) {
      return;
    }
    const found = new Map(
      (await this.deps.questionsService.findByIds(missing)).map((question) => [question.id, question]),
    );
    missing.forEach((id) => this.storedQuestions.set(id, found.get(id) ?? null));
  }

  private async preloadUnits(rootIds: string[]): Promise<void> {
    const missing = [...new Set(rootIds)].filter((id) => !this.questions.has(id) && !this.storedQuestions.has(id));
    if (missing.length === 0) {
      return;
    }
    for (const { root, questions } of await this.deps.questionsService.findUnits(missing)) {
      this.storedQuestions.set(root.id, root);
      if (root.type === QuestionType.MATERIAL) {
        questions.forEach((child) => this.storedQuestions.set(child.id, child));
        this.storedChildren.set(
          root.id,
          questions.map((child) => child.id),
        );
      }
    }
    await this.preloadQuestions(missing);
  }

  private async question(id: string): Promise<Question | undefined> {
    if (this.questions.has(id)) {
      return this.questions.get(id);
    }
    if (!this.storedQuestions.has(id)) {
      await this.preloadQuestions([id]);
    }
    return this.storedQuestions.get(id) ?? undefined;
  }

  private async childIdsOf(materialId: string): Promise<string[]> {
    if (this.children.has(materialId)) {
      return this.children.get(materialId)!;
    }
    if (!this.storedChildren.has(materialId)) {
      const [unit] = await this.deps.questionsService.findUnits([materialId]);
      const children = unit?.root.type === QuestionType.MATERIAL ? unit.questions : [];
      children.forEach((child) => this.storedQuestions.set(child.id, child));
      this.storedChildren.set(
        materialId,
        children.map((child) => child.id),
      );
    }
    return this.storedChildren.get(materialId)!;
  }

  private async prefetchHashes(unit: QuestionImportUnit): Promise<void> {
    if (unit.root.id !== null) {
      return;
    }
    const rootHash = computeContentHash(contentOf(unit.root.fields), null);
    const childHashes = unit.children.flatMap((child) =>
      child.id === null ? [computeContentHash(contentOf(child.fields), rootHash)] : [],
    );
    const missing = [rootHash, ...childHashes].filter(
      (hash) => !this.storedHashOwners.has(keyOf(unit.subjectId, hash)),
    );
    if (missing.length === 0) {
      return;
    }
    const found = await this.deps.questionsService.findIdsByContentHashes(unit.subjectId, missing);
    missing.forEach((hash) => this.storedHashOwners.set(keyOf(unit.subjectId, hash), found.get(hash) ?? null));
  }

  private async hashOwner(subjectId: string, contentHash: string): Promise<string | null> {
    const key = keyOf(subjectId, contentHash);
    if (this.hashOwners.has(key)) {
      return this.hashOwners.get(key) ?? null;
    }
    if (!this.storedHashOwners.has(key)) {
      const found = await this.deps.questionsService.findIdsByContentHashes(subjectId, [contentHash]);
      this.storedHashOwners.set(key, found.get(contentHash) ?? null);
    }
    return this.storedHashOwners.get(key) ?? null;
  }

  private async assertUniqueHash(subjectId: string, contentHash: string, excludeIds: string[]): Promise<void> {
    const owner = await this.hashOwner(subjectId, contentHash);
    if (owner && !excludeIds.includes(owner)) {
      throw conflict('duplicateQuestion', { duplicateQuestionId: owner });
    }
  }

  private rehash(question: Question, contentHash: string): void {
    this.hashOwners.set(keyOf(question.subjectId, question.contentHash), null);
    this.hashOwners.set(keyOf(question.subjectId, contentHash), question.id);
  }

  private async assertTaggable(subjectId: string, knowledgePointIds: string[]): Promise<void> {
    if (knowledgePointIds.length === 0) {
      return;
    }
    const points = await this.pointsOf(subjectId);
    const found = knowledgePointIds.map((id) => points.find((point) => point.id === id));
    if (found.some((point) => !point)) {
      throw unprocessable('knowledgePointIds', 'invalidKnowledgePoint');
    }
    if (found.some((point) => !point!.isLeaf)) {
      throw unprocessable('knowledgePointIds', 'questionKnowledgePointNotLeaf');
    }
  }

  private save(unit: QuestionImportUnit, item: QuestionImportItem, parentId: string | null): Promise<string> {
    return withItemRef(item.ref, async () => {
      if (item.id === null) {
        return this.insert(unit.subjectId, item.fields, parentId);
      }
      await this.update(item.id, item.fields, { subjectId: unit.subjectId, parentId });
      return item.id;
    });
  }

  private async insert(subjectId: string, fields: QuestionImportFields, parentId: string | null): Promise<string> {
    const parent = parentId ? await this.draftMaterial(parentId, subjectId) : null;
    const content = contentOf(fields);
    await this.assertTaggable(subjectId, content.knowledgePointIds);
    const contentHash = computeContentHash(content, parent?.contentHash ?? null);
    await this.assertUniqueHash(subjectId, contentHash, []);

    const id = randomUUID();
    const question = Object.assign(new Question(), {
      ...content,
      id,
      subjectId,
      parentId: parent?.id ?? null,
      status: QuestionStatus.DRAFT,
      currentVersion: 0,
      isFree: parent ? parent.isFree : (fields.isFree ?? true),
      sort: fields.sort ?? 0,
      contentHash,
    });
    this.questions.set(id, question);
    this.hashOwners.set(keyOf(subjectId, contentHash), id);
    if (parent) {
      this.children.set(parent.id, [...(await this.childIdsOf(parent.id)), id]);
    } else if (content.type === QuestionType.MATERIAL) {
      this.children.set(id, []);
    }
    return id;
  }

  private async draftMaterial(parentId: string, subjectId: string): Promise<Question> {
    const parent = await this.question(parentId);
    if (parent?.subjectId !== subjectId || parent.type !== QuestionType.MATERIAL) {
      throw unprocessable('parentId', 'invalidQuestionParent');
    }
    if (parent.status !== QuestionStatus.DRAFT) {
      throw conflict('materialNotDraft');
    }
    return parent;
  }

  private async update(
    id: string,
    dto: UpdateQuestionDto,
    expected: Pick<Question, 'subjectId' | 'parentId'>,
  ): Promise<void> {
    const current = await this.question(id);
    if (current?.subjectId !== expected.subjectId) {
      throw unprocessable('id', 'questionNotFound');
    }
    if (current.parentId !== expected.parentId) {
      throw unprocessable('id', 'invalidQuestionParent');
    }
    if (current.status === QuestionStatus.REVIEWING) {
      throw conflict('questionUnderReview');
    }
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
      options:
        dto.options !== undefined
          ? (dto.options?.map(({ key, content }) => ({ key, content })) ?? null)
          : current.options,
      answer: normalizeAnswer(type, dto.answer !== undefined ? dto.answer : current.answer),
      analysis: dto.analysis !== undefined ? dto.analysis : current.analysis,
      material: dto.material !== undefined ? dto.material : current.material,
      audioFileId: dto.audioFileId !== undefined ? dto.audioFileId : current.audioFileId,
      knowledgePointIds: dto.knowledgePointIds ?? current.knowledgePointIds,
    };
    if ((current.type === QuestionType.MATERIAL) !== (type === QuestionType.MATERIAL)) {
      throw unprocessable('type', 'materialTypeImmutable');
    }
    assertContent(next, current.parentId !== null);
    if (current.currentVersion > 0 && isAnswerChange(current, next)) {
      throw new BusinessException('answerChangeNotAllowed');
    }
    if (!sameKnowledgePoints(current.knowledgePointIds, next.knowledgePointIds)) {
      await this.assertTaggable(current.subjectId, next.knowledgePointIds);
    }
    const parent = current.parentId ? await this.question(current.parentId) : undefined;
    const contentHash = computeContentHash(next, parent?.contentHash ?? null);
    if (contentHash !== current.contentHash) {
      await this.assertUniqueHash(current.subjectId, contentHash, [id]);
      this.rehash(current, contentHash);
    }
    this.questions.set(
      id,
      Object.assign(new Question(), current, next, {
        sort: dto.sort ?? current.sort,
        isFree: current.parentId ? current.isFree : (dto.isFree ?? current.isFree),
        contentHash,
      }),
    );
    if (current.type === QuestionType.MATERIAL && contentHash !== current.contentHash) {
      for (const childId of await this.childIdsOf(id)) {
        const child = (await this.question(childId))!;
        const childHash = computeContentHash(child, contentHash);
        await this.assertUniqueHash(child.subjectId, childHash, [child.id]);
        this.rehash(child, childHash);
        this.questions.set(child.id, Object.assign(new Question(), child, { contentHash: childHash }));
      }
    }
  }

  private async publish(rootId: string): Promise<void> {
    const root = (await this.question(rootId))!;
    let status = root.status;
    if (QUESTION_TRANSITIONS[QuestionAction.SUBMIT].from.includes(status)) {
      if (root.type === QuestionType.MATERIAL && (await this.childIdsOf(rootId)).length === 0) {
        throw conflict('materialHasNoSubQuestions');
      }
      status = QUESTION_TRANSITIONS[QuestionAction.SUBMIT].to;
    }
    if (status !== QuestionStatus.REVIEWING) {
      return;
    }
    const childIds = root.type === QuestionType.MATERIAL ? await this.childIdsOf(rootId) : [];
    for (const id of [rootId, ...childIds]) {
      const question = (await this.question(id))!;
      this.questions.set(
        id,
        Object.assign(new Question(), question, {
          status: QUESTION_TRANSITIONS[QuestionAction.PUBLISH].to,
          currentVersion: Math.max(question.currentVersion, 1),
        }),
      );
    }
  }

  private async countPaperRows(subjectId: string, dto: SetPaperQuestionsDto): Promise<number> {
    const rootIds = dto.questions.map((item) => item.questionId);
    if (new Set(rootIds).size !== rootIds.length) {
      throw unprocessable('questions', 'duplicatePaperQuestion');
    }
    dto.questions.forEach((item, index) => {
      if (item.sectionIndex >= dto.sections.length) {
        throw unprocessable('questions', 'invalidPaperSection');
      }
      if (index > 0 && item.sectionIndex < dto.questions[index - 1].sectionIndex) {
        throw unprocessable('questions', 'invalidPaperSection');
      }
    });

    const units = new Map((await this.findQuestionUnits(rootIds)).map((unit) => [unit.root.id, unit]));
    const rows: { type: QuestionType; score: number }[] = [];
    for (const item of dto.questions) {
      const unit = units.get(item.questionId);
      if (unit?.root.subjectId !== subjectId) {
        throw unprocessable('questions', 'paperQuestionNotFound');
      }
      if (unit.questions.some((question) => question.status !== QuestionStatus.PUBLISHED)) {
        throw unprocessable('questions', 'paperQuestionNotPublished');
      }
      if (item.childScores && item.childScores.length !== unit.questions.length) {
        throw unprocessable('questions', 'invalidChildScores');
      }
      unit.questions.forEach((question, index) =>
        rows.push({ type: question.type, score: item.childScores?.[index] ?? item.score }),
      );
    }
    if (sumPaperScores(rows).totalScore > PAPER_QUESTION_LIMITS.maxTotalScore) {
      throw unprocessable('questions', 'paperScoreTooHigh');
    }
    return rows.length;
  }
}

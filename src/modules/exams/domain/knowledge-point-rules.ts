import { KnowledgePoint } from './knowledge-point';

export const MAX_KNOWLEDGE_POINT_LEVEL = 3;

export enum KnowledgePointViolation {
  NOT_FOUND = 'knowledgePointNotFound',
  TOO_DEEP = 'knowledgePointTooDeep',
  HAS_QUESTIONS = 'knowledgePointHasQuestions',
  HAS_CHILDREN = 'knowledgePointHasChildren',
  INVALID_PARENT = 'invalidKnowledgePointParent',
  INVALID_MIGRATION_TARGET = 'invalidMigrationTarget',
  MIGRATION_TARGET_NOT_LEAF = 'knowledgePointNotLeaf',
}

export type KnowledgePointChangeResult<T = KnowledgePoint> =
  { ok: true; value: T } | { ok: false; violation: KnowledgePointViolation };

type QuestionHolder = Pick<KnowledgePoint, 'questionCount'>;

function hasQuestions(point: QuestionHolder, linkedQuestionCount: number): boolean {
  return point.questionCount > 0 || linkedQuestionCount > 0;
}

export function knowledgePointPath(parentPath: string | null, id: string): string {
  return `${parentPath ?? '/'}${id}/`;
}

export function checkCanAddChild(
  parent: Pick<KnowledgePoint, 'level' | 'questionCount'>,
  parentLinkedQuestionCount: number,
): KnowledgePointViolation | null {
  if (hasQuestions(parent, parentLinkedQuestionCount)) {
    return KnowledgePointViolation.HAS_QUESTIONS;
  }
  if (parent.level >= MAX_KNOWLEDGE_POINT_LEVEL) {
    return KnowledgePointViolation.TOO_DEEP;
  }
  return null;
}

/** subtreeMaxLevel 为 node 及其全部后代中最大的 level */
export function checkCanMove(
  node: Pick<KnowledgePoint, 'subjectId' | 'path' | 'level'>,
  subtreeMaxLevel: number,
  newParent: Pick<KnowledgePoint, 'subjectId' | 'path' | 'level' | 'questionCount'> | null,
  newParentLinkedQuestionCount: number,
): KnowledgePointViolation | null {
  if (newParent) {
    if (newParent.subjectId !== node.subjectId || newParent.path.startsWith(node.path)) {
      return KnowledgePointViolation.INVALID_PARENT;
    }
    if (hasQuestions(newParent, newParentLinkedQuestionCount)) {
      return KnowledgePointViolation.HAS_QUESTIONS;
    }
  }
  const newLevel = (newParent?.level ?? 0) + 1;
  if (newLevel + subtreeMaxLevel - node.level > MAX_KNOWLEDGE_POINT_LEVEL) {
    return KnowledgePointViolation.TOO_DEEP;
  }
  return null;
}

export function checkCanRemove(
  node: Pick<KnowledgePoint, 'isLeaf' | 'questionCount'>,
  linkedQuestionCount: number,
): KnowledgePointViolation | null {
  if (!node.isLeaf) {
    return KnowledgePointViolation.HAS_CHILDREN;
  }
  if (hasQuestions(node, linkedQuestionCount)) {
    return KnowledgePointViolation.HAS_QUESTIONS;
  }
  return null;
}

export function checkCanMigrate(
  source: Pick<KnowledgePoint, 'id' | 'subjectId'>,
  target: Pick<KnowledgePoint, 'id' | 'subjectId' | 'isLeaf'> | null,
): KnowledgePointViolation | null {
  if (!target || target.id === source.id || target.subjectId !== source.subjectId) {
    return KnowledgePointViolation.INVALID_MIGRATION_TARGET;
  }
  if (!target.isLeaf) {
    return KnowledgePointViolation.MIGRATION_TARGET_NOT_LEAF;
  }
  return null;
}

import { Question } from './question';
import { QuestionType } from './question-type';

/** 出题单位：独立题，或材料连同全部小题；questions 为可作答的题目 */
export interface QuestionUnit {
  root: Question;
  questions: Question[];
}

/** 按顺序挑选单位，使可作答题数尽量凑满 target 且不超过；没有能放下的单位时取第一个 */
export function packUnits<T extends { size: number }>(units: T[], target: number): T[] {
  const picked: T[] = [];
  let total = 0;
  for (const unit of units) {
    if (total >= target) {
      break;
    }
    if (unit.size > 0 && total + unit.size <= target) {
      picked.push(unit);
      total += unit.size;
    }
  }
  if (picked.length === 0 && target > 0) {
    const first = units.find((unit) => unit.size > 0);
    return first ? [first] : [];
  }
  return picked;
}

/** 按顺序取单位直到可作答题数达到 count，材料不拆分 */
export function takeLeadingUnits(units: QuestionUnit[], count: number): QuestionUnit[] {
  const taken: QuestionUnit[] = [];
  let total = 0;
  for (const unit of units) {
    if (total >= count) {
      break;
    }
    taken.push(unit);
    total += unit.questions.length;
  }
  return taken;
}

/** 将可作答题目按所属材料归组：单位按首次出现的位置排列，同一材料的小题合入同一单位 */
export function groupIntoUnits(questions: Question[], materials: Map<Question['id'], Question>): QuestionUnit[] {
  const units: QuestionUnit[] = [];
  const byMaterial = new Map<Question['id'], QuestionUnit>();
  for (const question of questions) {
    const material = question.parentId ? materials.get(question.parentId) : undefined;
    const existing = material && byMaterial.get(material.id);
    if (existing) {
      existing.questions.push(question);
    } else if (material) {
      const unit = { root: material, questions: [question] };
      byMaterial.set(material.id, unit);
      units.push(unit);
    } else if (!question.parentId) {
      units.push({ root: question, questions: [question] });
    }
  }
  return units;
}

/** 合并同一出题单位，按首次出现的位置排列 */
export function mergeUnits(units: QuestionUnit[]): QuestionUnit[] {
  const merged = new Map<Question['id'], QuestionUnit>();
  for (const unit of units) {
    const existing = merged.get(unit.root.id);
    if (existing) {
      const known = new Set(existing.questions.map((question) => question.id));
      existing.questions.push(...unit.questions.filter((question) => !known.has(question.id)));
    } else {
      merged.set(unit.root.id, { root: unit.root, questions: [...unit.questions] });
    }
  }
  return [...merged.values()];
}

export interface QuestionDrawCriteria {
  subjectId: string;
  /** 独立题按题型筛选；MATERIAL 只抽材料 */
  type?: QuestionType;
  /** 含下级知识点；材料按小题匹配 */
  knowledgePointIds?: string[];
  /** 闭区间；材料按小题匹配 */
  difficultyRange?: [number, number];
  excludeRootIds?: Question['id'][];
}

export interface QuestionDrawCandidate {
  id: Question['id'];
  /** 可作答题数 */
  size: number;
}

import { Paper } from '../../domain/paper';

export interface PaperScores {
  lastScore: number | null;
  bestScore: number | null;
}

/** 用户在试卷上的模考成绩与近期作答 */
export abstract class PaperAttemptRepository {
  /** 已交卷模考的最近一次成绩与最高分，没有成绩的试卷不含 */
  abstract findUserScores(userId: number, paperIds: Paper['id'][]): Promise<Map<Paper['id'], PaperScores>>;

  /** 作答过（答案非空）的题目所属出题单位 id；since 为空时不限时间 */
  abstract findAnsweredRootIds(userId: number, subjectId: string, since: Date | null): Promise<string[]>;
}

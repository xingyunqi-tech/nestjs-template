export class UserKnowledgeStat {
  id: string;
  userId: number;
  /** 叶子知识点 */
  knowledgePointId: string;
  answered: number;
  correct: number;
  /** 最近 20 次作答结果，1 对 0 错，按计入顺序 */
  recentResults: number[];
  lastAnsweredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export abstract class WrongBookReader {
  /** 科目内错题本 ACTIVE 且未下架的题目 */
  abstract findActiveQuestionIds(userId: number, subjectId: string): Promise<string[]>;
}

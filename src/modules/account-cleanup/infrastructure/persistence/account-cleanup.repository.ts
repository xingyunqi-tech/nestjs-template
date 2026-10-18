export abstract class AccountCleanupRepository {
  abstract markCompleted(userId: number): Promise<void>;

  /** 软删除时间早于 deletedBefore 且尚未完成清理的用户，按用户 id 升序 */
  abstract findPendingUserIds(deletedBefore: Date, limit: number): Promise<number[]>;
}

import { NullableType } from '../../../../common/types/nullable.type';
import { UserExamProfile } from '../../domain/user-exam-profile';

export type ExamProfileChanges = Partial<Pick<UserExamProfile, 'examDate' | 'dailyGoal'>>;

/** 同一用户的写操作串行执行，保证最多一个当前考试 */
export abstract class UserExamProfileRepository {
  abstract findManyByUserId(userId: UserExamProfile['userId']): Promise<UserExamProfile[]>;

  /** 当前考试档案，不加载考试 */
  abstract findCurrentByUserId(userId: UserExamProfile['userId']): Promise<NullableType<UserExamProfile>>;

  abstract findByUserIdAndExamId(
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
  ): Promise<NullableType<UserExamProfile>>;

  /** 不存在时创建，用户没有当前考试时新建的成为当前考试 */
  abstract upsert(
    userId: UserExamProfile['userId'],
    examId: UserExamProfile['examId'],
    changes: ExamProfileChanges,
  ): Promise<UserExamProfile>;

  /** 返回是否存在该关注 */
  abstract markCurrent(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<boolean>;

  /** 删除当前考试时，最近关注的另一个已发布考试成为当前，没有则为空；返回是否存在该关注 */
  abstract remove(userId: UserExamProfile['userId'], examId: UserExamProfile['examId']): Promise<boolean>;

  abstract removeByUser(userId: number): Promise<void>;
}

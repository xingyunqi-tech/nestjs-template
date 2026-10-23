import { RoleEnum } from '../../../common/enums/roles/roles.enum';

export interface OperatorProfile {
  id: number;
  nickname: string | null;
  email: string | null;
}

export interface QuestionOperator {
  id: number;
  roleId: number | null;
}

/** 操作人是题目的创建人或提交人；admin 不受限 */
export function isSelfReview(
  question: { createdBy: number | null; submittedBy: number | null },
  operator: QuestionOperator | null,
): boolean {
  return (
    operator !== null &&
    operator.roleId !== RoleEnum.admin &&
    (question.createdBy === operator.id || question.submittedBy === operator.id)
  );
}

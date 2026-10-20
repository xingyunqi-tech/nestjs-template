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

/** admin 可审核自己提交的题目 */
export function isSelfReview(submittedBy: number | null, operator: QuestionOperator | null): boolean {
  return operator !== null && submittedBy === operator.id && operator.roleId !== RoleEnum.admin;
}

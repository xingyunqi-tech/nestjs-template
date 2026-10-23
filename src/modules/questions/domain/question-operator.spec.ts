import { isSelfReview } from './question-operator';
import { RoleEnum } from '../../../common/enums/roles/roles.enum';

const question = (createdBy: number | null, submittedBy: number | null) => ({ createdBy, submittedBy });

describe('isSelfReview', () => {
  it('should flag a non-admin reviewing a question they submitted', () => {
    expect(isSelfReview(question(9, 5), { id: 5, roleId: RoleEnum.reviewer })).toBe(true);
    expect(isSelfReview(question(9, 5), { id: 5, roleId: null })).toBe(true);
  });

  it('should flag a non-admin reviewing a question they created', () => {
    expect(isSelfReview(question(5, 9), { id: 5, roleId: RoleEnum.reviewer })).toBe(true);
    expect(isSelfReview(question(5, null), { id: 5, roleId: RoleEnum.reviewer })).toBe(true);
  });

  it('should exempt admins, other operators and questions without a creator or submitter', () => {
    expect(isSelfReview(question(5, 5), { id: 5, roleId: RoleEnum.admin })).toBe(false);
    expect(isSelfReview(question(5, 5), { id: 6, roleId: RoleEnum.reviewer })).toBe(false);
    expect(isSelfReview(question(null, null), { id: 5, roleId: RoleEnum.reviewer })).toBe(false);
    expect(isSelfReview(question(5, 5), null)).toBe(false);
  });
});

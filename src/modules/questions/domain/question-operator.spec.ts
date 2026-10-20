import { isSelfReview } from './question-operator';
import { RoleEnum } from '../../../common/enums/roles/roles.enum';

describe('isSelfReview', () => {
  it('should flag a non-admin reviewing their own submission', () => {
    expect(isSelfReview(5, { id: 5, roleId: RoleEnum.reviewer })).toBe(true);
    expect(isSelfReview(5, { id: 5, roleId: null })).toBe(true);
  });

  it('should exempt admins, other operators and questions without a submitter', () => {
    expect(isSelfReview(5, { id: 5, roleId: RoleEnum.admin })).toBe(false);
    expect(isSelfReview(5, { id: 6, roleId: RoleEnum.reviewer })).toBe(false);
    expect(isSelfReview(null, { id: 5, roleId: RoleEnum.reviewer })).toBe(false);
    expect(isSelfReview(5, null)).toBe(false);
  });
});

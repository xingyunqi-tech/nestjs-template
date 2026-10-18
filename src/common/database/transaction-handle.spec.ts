import { EntityManager } from 'typeorm';
import { TransactionHandle, createTransactionHandle, entityManagerOf } from './transaction-handle';

describe('TransactionHandle', () => {
  it('should resolve the entity manager the handle was created with', () => {
    const manager = {} as EntityManager;

    expect(entityManagerOf(createTransactionHandle(manager))).toBe(manager);
  });

  it('should reject handles not created by createTransactionHandle', () => {
    expect(() => entityManagerOf({} as TransactionHandle)).toThrow('Unknown transaction handle');
  });
});

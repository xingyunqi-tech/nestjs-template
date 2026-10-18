import type { EntityManager } from 'typeorm';

declare const transactionHandleBrand: unique symbol;

/** 跨模块传递的不透明事务句柄 */
export type TransactionHandle = { readonly [transactionHandleBrand]: true };

const managers = new WeakMap<TransactionHandle, EntityManager>();

export function createTransactionHandle(manager: EntityManager): TransactionHandle {
  const handle = Object.freeze({}) as TransactionHandle;
  managers.set(handle, manager);
  return handle;
}

/** 仅供 relational 仓储取出句柄所属事务的 EntityManager */
export function entityManagerOf(handle: TransactionHandle): EntityManager {
  const manager = managers.get(handle);
  if (!manager) {
    throw new Error('Unknown transaction handle');
  }
  return manager;
}

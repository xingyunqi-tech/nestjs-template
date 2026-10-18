import { DiscoveryService } from '@nestjs/core';

/** 注销账号后清理某一类用户数据，clean 须幂等 */
export interface AccountDataCleaner {
  readonly name: string;
  clean(userId: number): Promise<void>;
}

export interface AccountCleanerOptions {
  /** 升序执行 */
  order: number;
}

/** 标记清理器 provider，由账号清理模块自动收集 */
export const AccountCleaner = DiscoveryService.createDecorator<AccountCleanerOptions>();

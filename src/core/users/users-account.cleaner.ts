import { Injectable } from '@nestjs/common';
import { UsersService } from './users.service';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

/** 头像文件由文件清理器删除 */
@AccountCleaner({ order: 900 })
@Injectable()
export class UsersAccountCleaner implements AccountDataCleaner {
  readonly name = 'users';

  constructor(private readonly usersService: UsersService) {}

  clean(userId: number): Promise<void> {
    return this.usersService.detachPhoto(userId);
  }
}

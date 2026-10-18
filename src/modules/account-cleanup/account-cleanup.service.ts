import { HttpStatus, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UsersService } from '../../core/users/users.service';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';

@Injectable()
export class AccountCleanupService {
  constructor(
    private readonly usersService: UsersService,
    private readonly producer: AccountCleanupProducer,
  ) {}

  async retrigger(userId: number): Promise<void> {
    if (!(await this.usersService.findDeletedById(userId))) {
      if (await this.usersService.findById(userId)) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { user: 'userNotDeleted' },
        });
      }
      throw new NotFoundException({ error: 'userNotFound' });
    }
    await this.producer.enqueueCleanup(userId);
  }
}

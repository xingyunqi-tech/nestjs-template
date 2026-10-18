import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AccountCleanupService } from './account-cleanup.service';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';
import { UsersService } from '../../core/users/users.service';

describe('AccountCleanupService', () => {
  let usersService: { findDeletedById: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let producer: { enqueueCleanup: ReturnType<typeof vi.fn> };
  let service: AccountCleanupService;

  beforeEach(() => {
    usersService = { findDeletedById: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue(null) };
    producer = { enqueueCleanup: vi.fn().mockResolvedValue(undefined) };
    service = new AccountCleanupService(
      usersService as unknown as UsersService,
      producer as unknown as AccountCleanupProducer,
    );
  });

  it('should enqueue the cleanup of a deleted user', async () => {
    usersService.findDeletedById.mockResolvedValue({ id: 7 });

    await service.retrigger(7);

    expect(producer.enqueueCleanup).toHaveBeenCalledWith(7);
  });

  it('should reject a user who is not deleted', async () => {
    usersService.findById.mockResolvedValue({ id: 7 });

    const error = await service.retrigger(7).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ errors: { user: 'userNotDeleted' } });
    expect(producer.enqueueCleanup).not.toHaveBeenCalled();
  });

  it('should reject an unknown user', async () => {
    await expect(service.retrigger(7)).rejects.toBeInstanceOf(NotFoundException);
    expect(producer.enqueueCleanup).not.toHaveBeenCalled();
  });
});

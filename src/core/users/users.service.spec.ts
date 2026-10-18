import type { Mocked } from 'vitest';
import { UsersService } from './users.service';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { FilesService } from '../../modules/files/files.service';
import { SessionService } from '../session/session.service';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';
import { FileType } from '../../modules/files/domain/file';
import { FileVisibility } from '../../modules/files/domain/file-visibility';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

describe('UsersService', () => {
  describe('updateByAdmin', () => {
    let repository: Mocked<Pick<UserRepository, 'findById' | 'update'>>;
    let sessionService: Mocked<Pick<SessionService, 'deleteByUserId'>>;
    let service: UsersService;

    beforeEach(() => {
      repository = {
        findById: vi.fn().mockResolvedValue({ id: 1, password: 'hash' }),
        update: vi.fn().mockResolvedValue({ id: 1 }),
      };
      sessionService = { deleteByUserId: vi.fn() };
      service = new UsersService(
        repository as unknown as UserRepository,
        {} as FilesService,
        sessionService as unknown as SessionService,
        {} as AccountCleanupProducer,
      );
    });

    it('should revoke every session of the user after changing the password', async () => {
      await service.updateByAdmin(1, { password: 'e10adc3949ba59abbe56e057f20f883e' });

      expect(sessionService.deleteByUserId).toHaveBeenCalledWith({ userId: 1 });
    });

    it('should keep the sessions when the password is not changed', async () => {
      await service.updateByAdmin(1, { firstName: 'A' });

      expect(sessionService.deleteByUserId).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should revoke the sessions, soft delete the user and then enqueue the account cleanup', async () => {
      const calls: string[] = [];
      const track = (name: string) =>
        vi.fn(() => {
          calls.push(name);
          return Promise.resolve();
        });
      const repository = { remove: track('remove') };
      const sessionService = { deleteByUserId: track('sessions') };
      const producer = { enqueueCleanup: track('enqueue') };
      const service = new UsersService(
        repository as unknown as UserRepository,
        {} as FilesService,
        sessionService as unknown as SessionService,
        producer as unknown as AccountCleanupProducer,
      );

      await service.remove(7);

      expect(repository.remove).toHaveBeenCalledWith(7);
      expect(sessionService.deleteByUserId).toHaveBeenCalledWith({ userId: 7 });
      expect(producer.enqueueCleanup).toHaveBeenCalledWith(7);
      expect(calls).toEqual(['sessions', 'remove', 'enqueue']);
    });
  });

  describe('photo', () => {
    let repository: Mocked<Pick<UserRepository, 'findById' | 'update'>>;
    let fileRepository: { findByIds: ReturnType<typeof vi.fn> };
    let service: UsersService;

    const file = (visibility: FileVisibility, ownerUserId: number | null): FileType =>
      Object.assign(new FileType(), { id: 'f1', path: 'a.png', visibility, ownerUserId });

    beforeEach(() => {
      repository = { findById: vi.fn(), update: vi.fn().mockResolvedValue({ id: 1 }) };
      fileRepository = { findByIds: vi.fn() };
      service = new UsersService(
        repository as unknown as UserRepository,
        new FilesService(fileRepository as unknown as ConstructorParameters<typeof FilesService>[0]),
        {} as SessionService,
        {} as AccountCleanupProducer,
      );
    });

    it('should accept the user own private photo', async () => {
      fileRepository.findByIds.mockResolvedValue([file(FileVisibility.PRIVATE, 1)]);
      await service.update(1, { photo: { id: 'f1', path: '' } });
      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ photo: expect.objectContaining({ id: 'f1' }) }),
      );
    });

    it('should accept a public photo', async () => {
      fileRepository.findByIds.mockResolvedValue([file(FileVisibility.PUBLIC, 2)]);
      await expect(service.update(1, { photo: { id: 'f1', path: '' } })).resolves.toEqual({ id: 1 });
    });

    it("should reject another user's private photo with 403", async () => {
      fileRepository.findByIds.mockResolvedValue([file(FileVisibility.PRIVATE, 2)]);
      await expect(service.update(1, { photo: { id: 'f1', path: '' } })).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject a missing photo with 422', async () => {
      fileRepository.findByIds.mockResolvedValue([]);
      await expect(service.update(1, { photo: { id: 'f1', path: '' } })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });
});

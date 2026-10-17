import type { Mocked } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { FileVisibility } from './domain/file-visibility';

function file(overrides: Partial<FileType> = {}): FileType {
  return Object.assign(new FileType(), {
    id: 'f1',
    path: 'a.png',
    ownerUserId: 1,
    visibility: FileVisibility.PUBLIC,
    ...overrides,
  });
}

describe('FilesService', () => {
  let repository: Mocked<FileRepository>;
  let service: FilesService;

  beforeEach(() => {
    repository = { create: vi.fn(), findById: vi.fn(), findByIds: vi.fn(), findByPath: vi.fn(), findReusable: vi.fn(), remove: vi.fn() };
    service = new FilesService(repository);
  });

  describe('canAccess', () => {
    it('should let anyone read a public file', () => {
      expect(service.canAccess(file(), undefined)).toBe(true);
      expect(service.canAccess(file(), 2)).toBe(true);
    });

    it('should let only the owner read a private file', () => {
      const privateFile = file({ visibility: FileVisibility.PRIVATE });
      expect(service.canAccess(privateFile, 1)).toBe(true);
      expect(service.canAccess(privateFile, '1')).toBe(true);
      expect(service.canAccess(privateFile, 2)).toBe(false);
      expect(service.canAccess(privateFile, null)).toBe(false);
    });

    it('should let nobody read a private system file', () => {
      expect(service.canAccess(file({ visibility: FileVisibility.PRIVATE, ownerUserId: null }), 1)).toBe(false);
    });
  });

  describe('findAccessible', () => {
    it('should return a private file to its owner', async () => {
      repository.findById.mockResolvedValue(file({ visibility: FileVisibility.PRIVATE }));
      await expect(service.findAccessible('f1', 1)).resolves.toMatchObject({ id: 'f1' });
    });

    it('should reject other users with 403', async () => {
      repository.findById.mockResolvedValue(file({ visibility: FileVisibility.PRIVATE }));
      await expect(service.findAccessible('f1', 2)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should return 404 for a missing file', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.findAccessible('f1', 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertReferenceable', () => {
    it('should accept public files and the user own private files', async () => {
      repository.findByIds.mockResolvedValue([file(), file({ id: 'f2', visibility: FileVisibility.PRIVATE })]);
      await expect(service.assertReferenceable(['f1', 'f2', 'f1'], 1)).resolves.toHaveLength(2);
      expect(repository.findByIds).toHaveBeenCalledWith(['f1', 'f2']);
    });

    it("should reject another user's private file with 403", async () => {
      repository.findByIds.mockResolvedValue([file({ visibility: FileVisibility.PRIVATE })]);
      await expect(service.assertReferenceable(['f1'], 2)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should reject a missing file with 404', async () => {
      repository.findByIds.mockResolvedValue([file()]);
      await expect(service.assertReferenceable(['f1', 'f2'], 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should not query when nothing is referenced', async () => {
      await expect(service.assertReferenceable([], 1)).resolves.toEqual([]);
      expect(repository.findByIds).not.toHaveBeenCalled();
    });
  });
});

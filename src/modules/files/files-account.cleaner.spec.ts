import type { Mocked } from 'vitest';
import { FilesAccountCleaner } from './files-account.cleaner';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileStorageService } from './file-storage.service';
import { FileType } from './domain/file';

describe('FilesAccountCleaner', () => {
  let repository: Mocked<Pick<FileRepository, 'findByOwner'>>;
  let storage: Mocked<Pick<FileStorageService, 'remove'>>;
  let cleaner: FilesAccountCleaner;

  const file = (id: string): FileType => Object.assign(new FileType(), { id, path: `${id}.jpg`, ownerUserId: 7 });

  beforeEach(() => {
    repository = { findByOwner: vi.fn().mockResolvedValue([]) };
    storage = { remove: vi.fn().mockResolvedValue(undefined) };
    cleaner = new FilesAccountCleaner(
      repository as unknown as FileRepository,
      storage as unknown as FileStorageService,
    );
  });

  it('should remove every uploaded file of the user page by page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => file(`f${String(index).padStart(3, '0')}`));
    repository.findByOwner.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([file('f100')]);

    await cleaner.clean(7);

    expect(repository.findByOwner).toHaveBeenNthCalledWith(1, 7, null, 100);
    expect(repository.findByOwner).toHaveBeenNthCalledWith(2, 7, 'f099', 100);
    expect(storage.remove).toHaveBeenCalledTimes(101);
  });

  it('should keep a file that is still referenced and continue', async () => {
    repository.findByOwner.mockResolvedValue([file('f1'), file('f2')]);
    storage.remove.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));

    await cleaner.clean(7);

    expect(storage.remove).toHaveBeenCalledTimes(2);
  });

  it('should rethrow other errors', async () => {
    repository.findByOwner.mockResolvedValue([file('f1')]);
    storage.remove.mockRejectedValue(new Error('s3 down'));

    await expect(cleaner.clean(7)).rejects.toThrow('s3 down');
  });
});

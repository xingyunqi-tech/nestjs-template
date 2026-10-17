import type { Mocked } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilesLocalService } from './files.service';
import { FileRepository } from '../../persistence/file.repository';
import { FilePurpose } from '../../../domain/file-purpose';
import { FileVisibility } from '../../../domain/file-visibility';
import { FileType } from '../../../domain/file';

const MAX_SIZES: Record<FilePurpose, number> = {
  [FilePurpose.IMAGE]: 10,
  [FilePurpose.PRIVATE_IMAGE]: 10,
  [FilePurpose.AUDIO]: 100,
  [FilePurpose.IMPORT]: 100,
  [FilePurpose.EXPORT]: 100,
};

const config = {
  get: (key: string) => (key === 'app.apiPrefix' ? 'api' : undefined),
  getOrThrow: (key: string) => (key === 'file.maxSizes' ? MAX_SIZES : undefined),
} as unknown as ConfigService;

async function upload(name: string, size: number): Promise<Express.Multer.File> {
  const dir = await mkdtemp(join(tmpdir(), 'upload-'));
  const path = join(dir, name);
  await writeFile(path, Buffer.alloc(size));
  return { path, size, originalname: name } as Express.Multer.File;
}

describe('FilesLocalService', () => {
  let repository: Mocked<FileRepository>;
  let service: FilesLocalService;

  beforeEach(() => {
    repository = {
      create: vi.fn(async (data) => Object.assign(new FileType(), { id: 'f1', ...data })),
      findById: vi.fn(),
      findByIds: vi.fn(),
      findByPath: vi.fn(),
    };
    service = new FilesLocalService(config, repository);
  });

  it('should record the owner, visibility, MIME type and size', async () => {
    const file = { path: 'files/abc.jpg', size: 5, originalname: 'photo.JPG' } as Express.Multer.File;

    await service.create(file, 7, FilePurpose.PRIVATE_IMAGE);

    expect(repository.create).toHaveBeenCalledWith({
      path: '/api/v1/files/abc.jpg',
      ownerUserId: 7,
      visibility: FileVisibility.PRIVATE,
      mimeType: 'image/jpeg',
      size: 5,
    });
  });

  it('should delete the stored file and reject it when it exceeds the purpose limit', async () => {
    const file = await upload('big.png', 11);

    await expect(service.create(file, 7, FilePurpose.IMAGE)).rejects.toMatchObject({ status: 413 });
    expect(existsSync(file.path)).toBe(false);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should accept a file within a larger purpose limit', async () => {
    const file = await upload('listening.mp3', 50);

    await expect(service.create(file, 1, FilePurpose.AUDIO)).resolves.toMatchObject({
      file: { visibility: FileVisibility.PUBLIC, mimeType: 'audio/mpeg' },
    });
  });

  it('should serve only public files by file name', async () => {
    repository.findByPath.mockResolvedValueOnce(
      Object.assign(new FileType(), { id: 'f1', path: '/api/v1/files/a.png', visibility: FileVisibility.PUBLIC }),
    );
    await expect(service.findPublicByFileName('a.png')).resolves.toMatchObject({ id: 'f1' });
    expect(repository.findByPath).toHaveBeenCalledWith('/api/v1/files/a.png');

    repository.findByPath.mockResolvedValueOnce(
      Object.assign(new FileType(), { id: 'f2', path: '/api/v1/files/b.png', visibility: FileVisibility.PRIVATE }),
    );
    await expect(service.findPublicByFileName('b.png')).resolves.toBeNull();
  });
});

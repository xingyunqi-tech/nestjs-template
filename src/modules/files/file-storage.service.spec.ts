import type { Mocked } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { FileStorageService } from './file-storage.service';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { FilePurpose } from './domain/file-purpose';
import { FileVisibility } from './domain/file-visibility';
import { FileDriver } from './config/file-config.type';
import { localDiskPath } from './local-file-path';
import { AllConfigType } from '../../config/config.type';

const CONTENT = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SHA256 = createHash('sha256').update(CONTENT).digest('hex');

describe('FileStorageService', () => {
  let repository: Mocked<FileRepository>;
  let service: FileStorageService;
  const created: FileType[] = [];

  beforeEach(() => {
    repository = {
      create: vi.fn((data) => {
        const file = Object.assign(new FileType(), { ...data, id: `f${created.length + 1}` });
        created.push(file);
        return Promise.resolve(file);
      }),
      findById: vi.fn(),
      findByIds: vi.fn(),
      findByPath: vi.fn(),
      findReusable: vi.fn().mockResolvedValue(null),
      remove: vi.fn(),
      removeWithin: vi.fn((_id: string, afterDelete: () => Promise<void>) => afterDelete()),
      findByOwner: vi.fn(),
    };
    const values: Record<string, unknown> = {
      'file.driver': FileDriver.LOCAL,
      'app.apiPrefix': 'api',
      'file.maxSizes': { [FilePurpose.IMAGE]: 1024, [FilePurpose.CONTENT_IMAGE]: 1024, [FilePurpose.IMPORT]: 1024 },
    };
    const configService = { get: vi.fn((key: string) => values[key]), getOrThrow: vi.fn((key: string) => values[key]) };
    service = new FileStorageService(repository, configService as unknown as ConfigService<AllConfigType>);
  });

  afterEach(async () => {
    for (const file of created.splice(0)) {
      await service.remove(file);
    }
  });

  it('should write a new file with its sha256 and read it back', async () => {
    const file = await service.store(CONTENT, 'a.png', FilePurpose.IMAGE, 1);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png', size: 4, sha256: SHA256, visibility: FileVisibility.PUBLIC }),
    );
    expect(file.path).toMatch(/^\/api\/v1\/files\/\w+\.png$/);
    await expect(service.read(file)).resolves.toEqual(CONTENT);
  });

  it('should reuse an existing public file with the same content and type', async () => {
    const existing = Object.assign(new FileType(), { id: 'old', path: '/api/v1/files/old.png' });
    repository.findReusable.mockResolvedValue(existing);

    await expect(service.storeDeduplicated(CONTENT, 'b.png', FilePurpose.IMAGE, 1)).resolves.toEqual({
      file: existing,
      reused: true,
    });
    expect(repository.findReusable).toHaveBeenCalledWith(SHA256, FileVisibility.PUBLIC, 'image/png');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should write a new file when no reusable file exists', async () => {
    const stored = await service.storeDeduplicated(CONTENT, 'b.png', FilePurpose.IMAGE, 1);

    expect(stored.reused).toBe(false);
    expect(existsSync(localDiskPath(stored.file.path))).toBe(true);
  });

  it('should never reuse files for private purposes', async () => {
    await service.storeDeduplicated(Buffer.from('{}'), 'c.json', FilePurpose.IMPORT, 1);

    expect(repository.findReusable).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: FileVisibility.PRIVATE }));
  });

  it('should delete the record and the stored content', async () => {
    const file = await service.store(CONTENT, 'd.png', FilePurpose.IMAGE, 1);
    created.pop();

    await service.remove(file);

    expect(repository.removeWithin).toHaveBeenCalledWith(file.id, expect.any(Function));
    await expect(readFile(localDiskPath(file.path))).rejects.toThrow();
  });

  it('should store content assets without an owner', async () => {
    await service.store(CONTENT, 'e.png', FilePurpose.CONTENT_IMAGE, 1);
    await service.store(CONTENT, 'f.png', FilePurpose.IMAGE, 1);

    expect(repository.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ ownerUserId: null }));
    expect(repository.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ ownerUserId: 1 }));
  });

  it('should reject disallowed types and oversized content', async () => {
    await expect(service.store(CONTENT, 'a.exe', FilePurpose.IMAGE, 1)).rejects.toMatchObject({ status: 422 });
    await expect(service.store(Buffer.alloc(2048), 'a.png', FilePurpose.IMAGE, 1)).rejects.toMatchObject({
      status: 413,
    });
  });
});

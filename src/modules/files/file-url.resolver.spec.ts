import type { Mocked } from 'vitest';
import { FileUrlResolver, extractFileIds } from './file-url.resolver';
import { FilesService } from './files.service';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { FileVisibility } from './domain/file-visibility';

vi.mock('./file-url', () => ({
  buildFileUrl: (file: { path: string }) => Promise.resolve(`https://cdn.example.com/${file.path}`),
}));

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const PRIVATE_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';

function file(id: string, path: string, visibility: FileVisibility, ownerUserId: number | null = 1): FileType {
  return Object.assign(new FileType(), { id, path, visibility, ownerUserId });
}

describe('FileUrlResolver', () => {
  let repository: Mocked<FileRepository>;
  let resolver: FileUrlResolver;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByPath: vi.fn(),
      findReusable: vi.fn(),
      remove: vi.fn(),
      findByIds: vi.fn().mockResolvedValue([
        file(PUBLIC_ID, 'audio.mp3', FileVisibility.PUBLIC, null),
        file(PRIVATE_ID, 'photo.jpg', FileVisibility.PRIVATE, 1),
      ]),
    };
    resolver = new FileUrlResolver(new FilesService(repository));
  });

  it('should replace a file reference with its URL and leave the source untouched', async () => {
    const stem = `听录音 ![](file:${PUBLIC_ID}) 后作答`;

    await expect(resolver.resolve(stem)).resolves.toBe('听录音 ![](https://cdn.example.com/audio.mp3) 后作答');
    expect(stem).toContain(`file:${PUBLIC_ID}`);
  });

  it('should replace repeated references', async () => {
    await expect(resolver.resolve(`file:${PUBLIC_ID} file:${PUBLIC_ID.toUpperCase()}`)).resolves.toBe(
      'https://cdn.example.com/audio.mp3 https://cdn.example.com/audio.mp3',
    );
  });

  it('should keep references to missing files', async () => {
    await expect(resolver.resolve(`![](file:${MISSING_ID})`)).resolves.toBe(`![](file:${MISSING_ID})`);
  });

  it('should resolve a private file only for its owner', async () => {
    const content = `file:${PRIVATE_ID}`;

    await expect(resolver.resolve(content, 1)).resolves.toBe('https://cdn.example.com/photo.jpg');
    await expect(resolver.resolve(content, 2)).resolves.toBe(content);
    await expect(resolver.resolve(content)).resolves.toBe(content);
  });

  it('should load all referenced files with one query', async () => {
    const resolved = await resolver.resolveMany([`a file:${PUBLIC_ID}`, `b file:${MISSING_ID}`, 'c']);

    expect(resolved).toEqual(['a https://cdn.example.com/audio.mp3', `b file:${MISSING_ID}`, 'c']);
    expect(repository.findByIds).toHaveBeenCalledTimes(1);
    expect(repository.findByIds).toHaveBeenCalledWith([PUBLIC_ID, MISSING_ID]);
  });

  it('should not query when the content has no reference', async () => {
    await expect(resolver.resolve('plain text')).resolves.toBe('plain text');
    expect(repository.findByIds).not.toHaveBeenCalled();
  });

  it('should map accessible file ids to URLs with one query', async () => {
    await expect(resolver.resolveUrls([PUBLIC_ID.toUpperCase(), PUBLIC_ID, PRIVATE_ID, MISSING_ID], 2)).resolves.toEqual(
      { [PUBLIC_ID]: 'https://cdn.example.com/audio.mp3' },
    );
    expect(repository.findByIds).toHaveBeenCalledTimes(1);
    expect(repository.findByIds).toHaveBeenCalledWith([PUBLIC_ID, PRIVATE_ID, MISSING_ID]);
  });

  it('should return an empty map without querying when no ids are given', async () => {
    await expect(resolver.resolveUrls([])).resolves.toEqual({});
    expect(repository.findByIds).not.toHaveBeenCalled();
  });

  it('should extract distinct file ids', () => {
    expect(extractFileIds(`file:${PUBLIC_ID} file:${PUBLIC_ID} file:not-a-uuid file:${PRIVATE_ID}`)).toEqual([
      PUBLIC_ID,
      PRIVATE_ID,
    ]);
  });
});

import { UnprocessableEntityException } from '@nestjs/common';
import { FILE_PURPOSE_RULES, mimeTypeFor, parseFilePurpose, purposeFileFilter } from './file-purposes';
import { FilePurpose } from './domain/file-purpose';
import { FileVisibility } from './domain/file-visibility';

function filter(purpose: unknown, originalname: string): { error: Error | null; accepted: boolean } {
  let outcome = { error: null as Error | null, accepted: false };
  purposeFileFilter({ query: { purpose } }, { originalname }, (error, accepted) => {
    outcome = { error, accepted };
  });
  return outcome;
}

describe('file purposes', () => {
  it('should default to public images', () => {
    expect(parseFilePurpose(undefined)).toBe(FilePurpose.IMAGE);
    expect(parseFilePurpose('')).toBe(FilePurpose.IMAGE);
    expect(FILE_PURPOSE_RULES[FilePurpose.IMAGE].visibility).toBe(FileVisibility.PUBLIC);
  });

  it('should reject an unknown purpose', () => {
    expect(parseFilePurpose('video')).toBeNull();
  });

  it.each([
    [FilePurpose.IMAGE, 'a.webp', 'image/webp'],
    [FilePurpose.PRIVATE_IMAGE, 'a.JPG', 'image/jpeg'],
    [FilePurpose.AUDIO, 'a.mp3', 'audio/mpeg'],
    [FilePurpose.AUDIO, 'a.m4a', 'audio/mp4'],
    [FilePurpose.IMPORT, 'a.zip', 'application/zip'],
    [FilePurpose.IMPORT, 'a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    [FilePurpose.IMPORT, 'a.json', 'application/json'],
    [FilePurpose.EXPORT, 'a.pdf', 'application/pdf'],
  ])('should allow %s files named %s', (purpose, name, mimeType) => {
    expect(mimeTypeFor(purpose, name)).toBe(mimeType);
  });

  it.each([
    [FilePurpose.IMAGE, 'a.mp3'],
    [FilePurpose.PRIVATE_IMAGE, 'a.gif'],
    [FilePurpose.AUDIO, 'a.wav'],
    [FilePurpose.IMPORT, 'a.exe'],
    [FilePurpose.EXPORT, 'a'],
    [FilePurpose.IMAGE, 'a.constructor'],
  ])('should reject %s files named %s', (purpose, name) => {
    expect(mimeTypeFor(purpose, name)).toBeNull();
  });

  it('should mark audio as public and handwriting photos, imports and exports as private', () => {
    expect(FILE_PURPOSE_RULES[FilePurpose.AUDIO].visibility).toBe(FileVisibility.PUBLIC);
    expect(FILE_PURPOSE_RULES[FilePurpose.PRIVATE_IMAGE].visibility).toBe(FileVisibility.PRIVATE);
    expect(FILE_PURPOSE_RULES[FilePurpose.IMPORT].visibility).toBe(FileVisibility.PRIVATE);
    expect(FILE_PURPOSE_RULES[FilePurpose.EXPORT].visibility).toBe(FileVisibility.PRIVATE);
  });

  describe('purposeFileFilter', () => {
    it('should accept a whitelisted file', () => {
      expect(filter('audio', 'listening.mp3')).toEqual({ error: null, accepted: true });
    });

    it('should reject a file outside the whitelist with 422', () => {
      const { error, accepted } = filter('image', 'listening.mp3');
      expect(accepted).toBe(false);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { file: 'cantUploadFileType' },
      });
    });

    it('should reject an unknown purpose with 422', () => {
      const { error } = filter('video', 'a.mp4');
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { purpose: 'invalidFilePurpose' },
      });
    });
  });
});

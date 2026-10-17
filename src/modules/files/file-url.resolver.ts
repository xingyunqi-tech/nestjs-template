import { Injectable } from '@nestjs/common';
import { FilesService } from './files.service';
import { buildFileUrl } from './file-url';
import { FileType } from './domain/file';

const FILE_REFERENCE_PATTERN = /file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function extractFileIds(content: string): string[] {
  return [...new Set(Array.from(content.matchAll(FILE_REFERENCE_PATTERN), (match) => match[1].toLowerCase()))];
}

/** 文件不存在或查看者无权访问时保留原引用 */
@Injectable()
export class FileUrlResolver {
  constructor(private readonly filesService: FilesService) {}

  async resolve(content: string, viewerUserId?: number | string | null): Promise<string> {
    const [resolved] = await this.resolveMany([content], viewerUserId);
    return resolved;
  }

  async resolveMany(contents: string[], viewerUserId?: number | string | null): Promise<string[]> {
    const ids = [...new Set(contents.flatMap((content) => extractFileIds(content)))];
    if (ids.length === 0) {
      return contents;
    }

    const urls = new Map<string, string>();
    const files = await this.filesService.findByIds(ids);
    await Promise.all(
      files
        .filter((file) => this.filesService.canAccess(file, viewerUserId))
        .map(async (file: FileType) => urls.set(file.id.toLowerCase(), await buildFileUrl(file))),
    );

    return contents.map((content) =>
      content.replace(FILE_REFERENCE_PATTERN, (reference, id: string) => urls.get(id.toLowerCase()) ?? reference),
    );
  }
}

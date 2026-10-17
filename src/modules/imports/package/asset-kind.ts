import { FILE_PURPOSE_RULES, fileExtension } from '../../files/file-purposes';
import { FilePurpose } from '../../files/domain/file-purpose';

export type AssetPurpose = FilePurpose.IMAGE | FilePurpose.AUDIO;

const startsWith = (content: Buffer, signature: number[], offset = 0): boolean =>
  content.length >= offset + signature.length && signature.every((byte, index) => content[offset + index] === byte);

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const SIGNATURES: Record<string, (content: Buffer) => boolean> = {
  jpg: (content) => startsWith(content, [0xff, 0xd8, 0xff]),
  jpeg: (content) => startsWith(content, [0xff, 0xd8, 0xff]),
  png: (content) => startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: (content) => startsWith(content, ascii('GIF87a')) || startsWith(content, ascii('GIF89a')),
  webp: (content) => startsWith(content, ascii('RIFF')) && startsWith(content, ascii('WEBP'), 8),
  mp3: (content) =>
    startsWith(content, ascii('ID3')) || (content.length >= 2 && content[0] === 0xff && (content[1] & 0xe0) === 0xe0),
  m4a: (content) => startsWith(content, ascii('ftyp'), 4),
};

export function isAllowedAsset(fileName: string, content: Buffer, purpose: AssetPurpose): boolean {
  const extension = fileExtension(fileName);
  const allowed = Object.prototype.hasOwnProperty.call(FILE_PURPOSE_RULES[purpose].mimeTypes, extension);
  return allowed && (SIGNATURES[extension]?.(content) ?? false);
}

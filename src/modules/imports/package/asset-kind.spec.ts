import { isAllowedAsset } from './asset-kind';
import { FilePurpose } from '../../files/domain/file-purpose';
import { PNG_BYTES } from '../../../../test/utils/import-package';

describe('isAllowedAsset', () => {
  it('should accept whitelisted images whose header matches the extension', () => {
    expect(isAllowedAsset('chart.png', PNG_BYTES, FilePurpose.IMAGE)).toBe(true);
    expect(isAllowedAsset('photo.JPG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), FilePurpose.IMAGE)).toBe(true);
    expect(isAllowedAsset('a.gif', Buffer.from('GIF89a...'), FilePurpose.IMAGE)).toBe(true);
    expect(
      isAllowedAsset(
        'a.webp',
        Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.from('VP8 ')]),
        FilePurpose.IMAGE,
      ),
    ).toBe(true);
  });

  it('should accept whitelisted audio', () => {
    expect(isAllowedAsset('a.mp3', Buffer.from('ID3\x04\0'), FilePurpose.AUDIO)).toBe(true);
    expect(isAllowedAsset('b.mp3', Buffer.from([0xff, 0xfb, 0x90, 0x00]), FilePurpose.AUDIO)).toBe(true);
    expect(isAllowedAsset('a.m4a', Buffer.from('\0\0\0\x20ftypM4A '), FilePurpose.AUDIO)).toBe(true);
  });

  it('should reject executables and scripts even with an image extension', () => {
    expect(isAllowedAsset('run.png', Buffer.from('MZ\x90\0\x03'), FilePurpose.IMAGE)).toBe(false);
    expect(isAllowedAsset('run.png', Buffer.from('#!/bin/sh\nrm -rf /'), FilePurpose.IMAGE)).toBe(false);
    expect(isAllowedAsset('icon.svg', Buffer.from('<svg onload="alert(1)"/>'), FilePurpose.IMAGE)).toBe(false);
    expect(isAllowedAsset('run.exe', Buffer.from('MZ'), FilePurpose.IMAGE)).toBe(false);
    expect(isAllowedAsset('no-extension', PNG_BYTES, FilePurpose.IMAGE)).toBe(false);
  });

  it('should reject a file used for the wrong purpose', () => {
    expect(isAllowedAsset('chart.png', PNG_BYTES, FilePurpose.AUDIO)).toBe(false);
    expect(isAllowedAsset('a.mp3', Buffer.from('ID3'), FilePurpose.IMAGE)).toBe(false);
  });
});

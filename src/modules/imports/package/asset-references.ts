const ASSET_LINK = /(\]\(\s*)(?:\.\/)?assets\/([^)\s]+)(\s*\))/g;
const ASSET_PREFIX = /^(?:\.\/)?assets\//;

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** 文本中 ![](assets/xxx) 引用的资源名（相对 assets/） */
export function assetNamesIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(ASSET_LINK), (match) => decodeName(match[2])))];
}

export function replaceAssetLinks(text: string, fileIds: ReadonlyMap<string, string>): string {
  return text.replace(ASSET_LINK, (link, open: string, name: string, close: string) => {
    const fileId = fileIds.get(decodeName(name));
    return fileId ? `${open}file:${fileId}${close}` : link;
  });
}

/** audio 列可写文件名或 assets/文件名 */
export function assetNameOf(value: string): string {
  return decodeName(value.trim().replace(ASSET_PREFIX, ''));
}

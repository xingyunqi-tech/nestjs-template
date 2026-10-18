export interface OutputSegmenterOptions {
  /** 首段达到该长度且遇到段落结尾时下发 */
  firstMinLength: number;
  /** 后续段达到该长度且遇到段落结尾时下发 */
  minLength: number;
  /** 单段上限，未遇到段落结尾时在该长度内切分 */
  maxLength: number;
  /** 出现该标记后的文本不下发，作为 trailer 保留 */
  marker?: string;
}

const SENTENCE_ENDINGS = new Set(['\n', '。', '！', '？', '；', '.', '!', '?', ';']);

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** text 末尾与 marker 前缀重合的长度 */
function partialMarkerLength(text: string, marker: string): number {
  for (let length = Math.min(marker.length - 1, text.length); length > 0; length--) {
    if (text.endsWith(marker.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

/** 将模型输出按段落（或单段上限）切分为待送检的片段 */
export class OutputSegmenter {
  private pending = '';
  private emittedCount = 0;
  private trailerText: string | null = null;

  constructor(private readonly options: OutputSegmenterOptions) {}

  /** marker 之后的文本；未出现 marker 时为 null */
  get trailer(): string | null {
    return this.trailerText;
  }

  push(text: string): string[] {
    if (this.trailerText !== null) {
      this.trailerText += text;
      return [];
    }
    this.pending += text;
    const { marker } = this.options;
    const markerIndex = marker ? this.pending.indexOf(marker) : -1;
    if (marker && markerIndex >= 0) {
      this.trailerText = this.pending.slice(markerIndex + marker.length);
      this.pending = this.pending.slice(0, markerIndex);
      return this.flush();
    }
    return this.takeReady();
  }

  /** 取出剩余文本 */
  flush(): string[] {
    const segments: string[] = [];
    while (this.pending.length > 0) {
      const cut =
        this.pending.length > this.options.maxLength ? this.forcedCut(this.pending.length) : this.pending.length;
      segments.push(this.take(cut));
    }
    return segments;
  }

  private takeReady(): string[] {
    const segments: string[] = [];
    for (;;) {
      const safeLength = this.options.marker
        ? this.pending.length - partialMarkerLength(this.pending, this.options.marker)
        : this.pending.length;
      const window = this.pending.slice(0, Math.min(safeLength, this.options.maxLength));
      const minLength = this.emittedCount === 0 ? this.options.firstMinLength : this.options.minLength;
      const paragraphEnd = window.lastIndexOf('\n\n');
      if (paragraphEnd >= 0 && paragraphEnd + 2 >= minLength) {
        segments.push(this.take(paragraphEnd + 2));
      } else if (safeLength >= this.options.maxLength) {
        segments.push(this.take(this.forcedCut(this.options.maxLength)));
      } else {
        return segments;
      }
    }
  }

  /** limit 以内优先在句末切分，且不拆开代理对 */
  private forcedCut(limit: number): number {
    const end = Math.min(limit, this.options.maxLength);
    let cut = end;
    for (let index = end - 1; index >= Math.floor(end / 2); index--) {
      if (SENTENCE_ENDINGS.has(this.pending[index])) {
        cut = index + 1;
        break;
      }
    }
    if (cut < this.pending.length && isHighSurrogate(this.pending.charCodeAt(cut - 1))) {
      cut -= 1;
    }
    return Math.max(cut, 1);
  }

  private take(length: number): string {
    const segment = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    this.emittedCount += 1;
    return segment;
  }
}

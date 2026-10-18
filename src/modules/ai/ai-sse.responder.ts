import { HttpException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { AiStreamFollowItem } from './ai-message-stream.service';
import { AiStreamEntry, AiStreamEventName } from './domain/ai-stream-event';
import { BusinessException } from '../../common/exceptions/business.exception';

function errorCodeOf(error: unknown): string {
  if (error instanceof BusinessException) {
    return error.errorKey;
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      typeof (response as { error?: unknown }).error === 'string'
    ) {
      return (response as { error: string }).error;
    }
  }
  return 'internalServerError';
}

/** 把消息事件写为 SSE；开始输出后的异常转为 error 事件，客户端断开时停止读取 */
@Injectable()
export class AiSseResponder {
  async send(response: Response, follow: (signal: AbortSignal) => AsyncIterable<AiStreamFollowItem>): Promise<void> {
    const i18n = I18nContext.current();
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    try {
      for await (const item of follow(controller.signal)) {
        if (controller.signal.aborted) {
          break;
        }
        response.write(item.type === 'heartbeat' ? ': ping\n\n' : this.format(item.entry, i18n));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        response.write(
          this.format({ id: null, event: AiStreamEventName.ERROR, data: { code: errorCodeOf(error) } }, i18n),
        );
      }
    } finally {
      response.end();
    }
  }

  private format(entry: AiStreamEntry, i18n: I18nContext | undefined): string {
    const data =
      entry.event === AiStreamEventName.ERROR
        ? { ...entry.data, message: this.translate(String(entry.data.code), i18n) }
        : entry.data;
    return `${entry.id ? `id: ${entry.id}\n` : ''}event: ${entry.event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private translate(code: string, i18n: I18nContext | undefined): string {
    const translated = i18n?.t(`common.${code}`, { defaultValue: '' });
    return typeof translated === 'string' && translated !== '' && translated !== `common.${code}` ? translated : code;
  }
}

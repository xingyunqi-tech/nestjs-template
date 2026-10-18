import { EventEmitter } from 'events';
import type { Response } from 'express';
import { AiSseResponder } from './ai-sse.responder';
import { AiStreamFollowItem } from './ai-message-stream.service';
import { AiStreamEventName } from './domain/ai-stream-event';
import { BusinessException } from '../../common/exceptions/business.exception';

function fakeResponse(): Response & { chunks: string[]; ended: boolean } {
  const emitter = new EventEmitter();
  const response = Object.assign(emitter, {
    chunks: [] as string[],
    ended: false,
    headers: {},
    status: vi.fn(),
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders: vi.fn(),
    write(chunk: string) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
  });
  return response as unknown as Response & { chunks: string[]; ended: boolean };
}

describe('AiSseResponder', () => {
  const responder = new AiSseResponder();

  it('should write entries as SSE events with ids and heartbeats as comments', async () => {
    const response = fakeResponse();
    async function* follow(): AsyncGenerator<AiStreamFollowItem> {
      yield { type: 'entry', entry: { id: '1-0', event: AiStreamEventName.ANSWER_DELTA, data: { text: '你好' } } };
      yield { type: 'heartbeat' };
      yield { type: 'entry', entry: { id: null, event: AiStreamEventName.MESSAGE_DONE, data: { status: 'DONE' } } };
    }

    await responder.send(response, follow);

    expect((response as unknown as { headers: Record<string, string> }).headers['Content-Type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.chunks).toEqual([
      'id: 1-0\nevent: answer.delta\ndata: {"text":"你好"}\n\n',
      ': ping\n\n',
      'event: message.done\ndata: {"status":"DONE"}\n\n',
    ]);
    expect(response.ended).toBe(true);
  });

  it('should turn an exception after the stream started into an error event', async () => {
    const response = fakeResponse();
    async function* follow(): AsyncGenerator<AiStreamFollowItem> {
      yield { type: 'heartbeat' };
      throw new BusinessException('aiUnavailable');
    }

    await responder.send(response, follow);

    expect(response.chunks.at(-1)).toBe('event: error\ndata: {"code":"aiUnavailable","message":"aiUnavailable"}\n\n');
    expect(response.ended).toBe(true);
  });

  it('should stop reading once the client disconnects', async () => {
    const response = fakeResponse();
    let aborted = false;
    async function* follow(signal: AbortSignal): AsyncGenerator<AiStreamFollowItem> {
      yield { type: 'heartbeat' };
      response.emit('close');
      aborted = signal.aborted;
      yield { type: 'heartbeat' };
    }

    await responder.send(response, follow);

    expect(aborted).toBe(true);
    expect(response.chunks).toEqual([': ping\n\n']);
  });
});

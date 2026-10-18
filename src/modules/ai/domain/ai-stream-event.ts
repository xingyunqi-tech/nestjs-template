export enum AiStreamEventName {
  MESSAGE_START = 'message.start',
  REASONING_DELTA = 'reasoning.delta',
  ANSWER_DELTA = 'answer.delta',
  SUGGESTIONS = 'suggestions',
  MESSAGE_DONE = 'message.done',
  ERROR = 'error',
}

export interface AiStreamEntry {
  /** 流内位置，续读时作为 after 传入；由数据库内容补发的事件为 null */
  id: string | null;
  event: AiStreamEventName;
  data: Record<string, unknown>;
}

export function isTerminalEvent(event: AiStreamEventName): boolean {
  return event === AiStreamEventName.MESSAGE_DONE || event === AiStreamEventName.ERROR;
}

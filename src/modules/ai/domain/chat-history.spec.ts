import { RECENT_MESSAGE_LIMIT, splitHistory, toLlmMessages } from './chat-history';
import { AiMessage, AiMessageRole, AiMessageStatus } from './ai-message';

const message = (index: number, role: AiMessageRole, status = AiMessageStatus.DONE, content = `m${index}`): AiMessage =>
  Object.assign(new AiMessage(), { id: `id-${index}`, role, status, content });

describe('chat history', () => {
  it('should keep the latest 10 rounds and leave earlier messages for the summary', () => {
    const messages = Array.from({ length: RECENT_MESSAGE_LIMIT + 4 }, (_, index) =>
      message(index, index % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT),
    );

    const { older, recent } = splitHistory(messages);

    expect(older.map((item) => item.id)).toEqual(['id-0', 'id-1', 'id-2', 'id-3']);
    expect(recent).toHaveLength(RECENT_MESSAGE_LIMIT);
  });

  it('should drop failed, blocked and streaming answers and merge consecutive user messages', () => {
    const { recent } = splitHistory([
      message(0, AiMessageRole.USER),
      message(1, AiMessageRole.ASSISTANT, AiMessageStatus.BLOCKED),
      message(2, AiMessageRole.USER),
      message(3, AiMessageRole.ASSISTANT, AiMessageStatus.STOPPED),
      message(4, AiMessageRole.USER),
      message(5, AiMessageRole.ASSISTANT, AiMessageStatus.STREAMING),
    ]);

    expect(toLlmMessages(recent)).toEqual([
      { role: 'user', content: 'm0\n\nm2' },
      { role: 'assistant', content: 'm3' },
      { role: 'user', content: 'm4' },
    ]);
  });

  it('should not start the model messages with an assistant message', () => {
    expect(
      toLlmMessages([
        { role: AiMessageRole.ASSISTANT, content: 'a' },
        { role: AiMessageRole.USER, content: 'u' },
      ]),
    ).toEqual([{ role: 'user', content: 'u' }]);
  });
});

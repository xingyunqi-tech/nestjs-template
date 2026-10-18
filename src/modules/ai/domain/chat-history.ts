import { LlmChatMessage } from '../../../integrations/llm/llm-provider';
import { AiMessage, AiMessageRole, AiMessageStatus } from './ai-message';

/** 携带最近 10 轮消息 */
export const RECENT_MESSAGE_LIMIT = 20;

/** 摘要之外待压缩的消息达到该数量时更新摘要 */
export const SUMMARY_BATCH_THRESHOLD = 4;

const SUMMARY_MAX_LENGTH = 500;

/** 可进入上下文的消息：用户消息，以及完成或停止的非空回答 */
export function isContextMessage(message: AiMessage): boolean {
  if (message.role === AiMessageRole.USER) {
    return true;
  }
  return (
    (message.status === AiMessageStatus.DONE || message.status === AiMessageStatus.STOPPED) &&
    message.content.trim() !== ''
  );
}

/** 按时间升序的消息拆为待压缩部分与最近部分 */
export function splitHistory(messages: AiMessage[]): { older: AiMessage[]; recent: AiMessage[] } {
  const usable = messages.filter(isContextMessage);
  const recentStart = Math.max(usable.length - RECENT_MESSAGE_LIMIT, 0);
  return { older: usable.slice(0, recentStart), recent: usable.slice(recentStart) };
}

/** 转为模型消息，连续同角色消息合并 */
export function toLlmMessages(messages: Pick<AiMessage, 'role' | 'content'>[]): LlmChatMessage[] {
  const result: LlmChatMessage[] = [];
  for (const message of messages) {
    const role = message.role === AiMessageRole.USER ? 'user' : 'assistant';
    const last = result[result.length - 1];
    if (last?.role === role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      result.push({ role, content: message.content });
    }
  }
  while (result[0]?.role === 'assistant') {
    result.shift();
  }
  return result;
}

/** 摘要请求：在已有摘要基础上合并更早的对话 */
export function buildSummaryRequest(
  previousSummary: string | null,
  messages: Pick<AiMessage, 'role' | 'content'>[],
): { system: string; messages: LlmChatMessage[] } {
  const transcript = messages
    .map((message) => `${message.role === AiMessageRole.USER ? '学生' : '老师'}：${message.content}`)
    .join('\n\n');
  return {
    system: `你负责压缩学习辅导对话。把已有摘要与新增对话合并为一段不超过 ${SUMMARY_MAX_LENGTH} 字的摘要，保留学生的疑问点、已讲解的要点和结论，只输出摘要正文。`,
    messages: [
      {
        role: 'user',
        content: `已有摘要：\n${previousSummary ?? '无'}\n\n新增对话：\n${transcript}`,
      },
    ],
  };
}

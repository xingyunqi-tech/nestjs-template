import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectQuestionDto } from './reject-question.dto';

const check = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(RejectQuestionDto, body);
  const errors = await validate(dto);
  return { dto, messages: errors.flatMap((error) => Object.values(error.constraints ?? {})) };
};

describe('RejectQuestionDto', () => {
  it('should trim the reason', async () => {
    const { dto, messages } = await check({ reason: '  答案有误  ' });

    expect(messages).toEqual([]);
    expect(dto.reason).toBe('答案有误');
  });

  it('should accept a reason of 500 characters after trimming', async () => {
    const { messages } = await check({ reason: ` ${'因'.repeat(500)} ` });

    expect(messages).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['null', { reason: null }],
    ['not a string', { reason: 123 }],
    ['empty', { reason: '' }],
    ['blank', { reason: '   ' }],
    ['longer than 500 characters', { reason: '因'.repeat(501) }],
  ])('should reject a reason that is %s with a single message key', async (_case, body) => {
    const { messages } = await check(body);

    expect(messages).toEqual(['rejectReasonLength']);
  });
});

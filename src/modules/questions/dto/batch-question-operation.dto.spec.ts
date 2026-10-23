import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BatchQuestionIdsDto,
  BatchRejectQuestionsDto,
  BatchUpdateQuestionsDto,
  KnowledgePointUpdateMode,
} from './batch-question-operation.dto';

const ID_A = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

async function check<T extends object>(type: new () => T, body: Record<string, unknown>) {
  const dto = plainToInstance(type, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, properties: errors.map((error) => error.property), errors };
}

describe('BatchQuestionIdsDto', () => {
  it('should lowercase ids', async () => {
    const { dto, properties } = await check(BatchQuestionIdsDto, { ids: [ID_A, ID_B] });

    expect(properties).toEqual([]);
    expect(dto.ids).toEqual([ID_A.toLowerCase(), ID_B]);
  });

  it('should accept 100 ids', async () => {
    const { properties } = await check(BatchQuestionIdsDto, { ids: Array.from({ length: 100 }, (_, i) => uuid(i)) });

    expect(properties).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['empty', { ids: [] }],
    ['more than 100', { ids: Array.from({ length: 101 }, (_, i) => uuid(i)) }],
    ['duplicated ignoring case', { ids: [ID_A, ID_A.toLowerCase()] }],
    ['not uuids', { ids: ['q1'] }],
  ])('should reject ids that are %s', async (_case, body) => {
    const { properties } = await check(BatchQuestionIdsDto, body);

    expect(properties).toEqual(['ids']);
  });
});

describe('BatchRejectQuestionsDto', () => {
  it('should validate ids and trim the reason', async () => {
    const { dto, properties } = await check(BatchRejectQuestionsDto, { ids: [ID_B], reason: '  答案有误  ' });

    expect(properties).toEqual([]);
    expect(dto.reason).toBe('答案有误');
  });

  it('should reject a blank reason with the reject reason message key', async () => {
    const { errors } = await check(BatchRejectQuestionsDto, { ids: [ID_B], reason: '   ' });

    expect(errors.map((error) => [error.property, Object.values(error.constraints ?? {})])).toEqual([
      ['reason', ['rejectReasonLength']],
    ]);
  });

  it('should require ids', async () => {
    const { properties } = await check(BatchRejectQuestionsDto, { reason: '原因' });

    expect(properties).toEqual(['ids']);
  });
});

describe('BatchUpdateQuestionsDto', () => {
  it('should accept knowledge points with a mode and lowercase them', async () => {
    const { dto, properties } = await check(BatchUpdateQuestionsDto, {
      ids: [ID_B],
      knowledgePointIds: [ID_A],
      mode: 'append',
      difficulty: 2,
      source: 'PUBLIC',
      isFree: false,
    });

    expect(properties).toEqual([]);
    expect(dto).toMatchObject({ knowledgePointIds: [ID_A.toLowerCase()], mode: KnowledgePointUpdateMode.APPEND });
  });

  it('should accept an empty knowledge point list to replace with', async () => {
    const { properties } = await check(BatchUpdateQuestionsDto, {
      ids: [ID_B],
      knowledgePointIds: [],
      mode: 'replace',
    });

    expect(properties).toEqual([]);
  });

  it('should leave the field presence check to the service', async () => {
    const { properties } = await check(BatchUpdateQuestionsDto, { ids: [ID_B] });

    expect(properties).toEqual([]);
  });

  it.each([
    ['knowledge points without a mode', { knowledgePointIds: [ID_A] }, 'mode'],
    ['an unknown mode', { knowledgePointIds: [ID_A], mode: 'merge' }, 'mode'],
    [
      'more than 10 knowledge points',
      { knowledgePointIds: Array.from({ length: 11 }, (_, i) => uuid(i)), mode: 'replace' },
      'knowledgePointIds',
    ],
    ['duplicated knowledge points', { knowledgePointIds: [ID_A, ID_A], mode: 'replace' }, 'knowledgePointIds'],
    ['null knowledge points', { knowledgePointIds: null, mode: 'append' }, 'knowledgePointIds'],
    ['a difficulty out of range', { difficulty: 6 }, 'difficulty'],
    ['an unknown source', { source: 'UNKNOWN' }, 'source'],
    ['a non-boolean isFree', { isFree: 'yes' }, 'isFree'],
  ])('should reject %s', async (_case, body, property) => {
    const { properties } = await check(BatchUpdateQuestionsDto, { ids: [ID_B], ...body });

    expect(properties).toEqual([property]);
  });
});

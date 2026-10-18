import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryWrongBookDto } from './query-wrong-book.dto';

const errorsOf = async (query: Record<string, unknown>): Promise<string[]> =>
  (await validate(plainToInstance(QueryWrongBookDto, query))).map((error) => error.property);

describe('QueryWrongBookDto', () => {
  it('should accept time bounds with a UTC designator or an offset', async () => {
    expect(
      await errorsOf({ lastWrongFrom: '2026-10-12T00:00:00+08:00', lastWrongTo: '2026-10-18T16:00:00.000Z' }),
    ).toEqual([]);
  });

  it('should reject time bounds without a time zone', async () => {
    expect(await errorsOf({ lastWrongFrom: '2026-10-12T00:00:00', lastWrongTo: '2026-10-12' })).toEqual([
      'lastWrongFrom',
      'lastWrongTo',
    ]);
  });

  it('should reject invalid calendar dates', async () => {
    expect(await errorsOf({ lastWrongFrom: '2026-02-30T00:00:00Z' })).toEqual(['lastWrongFrom']);
  });

  it('should convert wrong count bounds to integers', async () => {
    const dto = plainToInstance(QueryWrongBookDto, { minWrongCount: '2', maxWrongCount: '5' });
    expect(dto).toMatchObject({ minWrongCount: 2, maxWrongCount: 5 });
    expect(await validate(dto)).toEqual([]);
  });
});

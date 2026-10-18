import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryAiUsageDto } from './ai-usage.dto';

describe('QueryAiUsageDto', () => {
  const errorsOf = async (query: Record<string, unknown>): Promise<string[]> =>
    (await validate(plainToInstance(QueryAiUsageDto, query))).map((error) => error.property);

  it('should accept calendar dates', async () => {
    await expect(errorsOf({ from: '2028-02-29', to: '2028-03-01' })).resolves.toEqual([]);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-04-31', '2026-1-01', '2026-10-18T00:00:00Z', 'x'])(
    'should reject %s',
    async (value) => {
      await expect(errorsOf({ from: value, to: '2026-10-18' })).resolves.toEqual(['from']);
      await expect(errorsOf({ from: '2026-10-18', to: value })).resolves.toEqual(['to']);
    },
  );
});

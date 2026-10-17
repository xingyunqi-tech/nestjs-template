import { BadRequestException } from '@nestjs/common';
import { ParseUuidPipe } from './parse-uuid.pipe';

describe('ParseUuidPipe', () => {
  const pipe = new ParseUuidPipe();

  it('should accept a uuid and normalize it to lower case', () => {
    expect(pipe.transform('8F14E45F-CEEA-467A-9575-8B4E5D3A2F10')).toBe('8f14e45f-ceea-467a-9575-8b4e5d3a2f10');
  });

  it.each(['abc', '1', '', '8f14e45f-ceea-467a-9575-8b4e5d3a2f1'])('should reject %p with 400', (value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });

  it('should report the error on the id field', () => {
    try {
      pipe.transform('abc');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ errors: { id: 'invalidId' } });
    }
    expect.assertions(1);
  });
});

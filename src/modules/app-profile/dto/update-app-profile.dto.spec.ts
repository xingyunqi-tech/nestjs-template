import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAppProfileDto } from './update-app-profile.dto';

const errorsOf = async (body: Record<string, unknown>): Promise<string[]> =>
  (await validate(plainToInstance(UpdateAppProfileDto, body))).map((error) => error.property);

describe('UpdateAppProfileDto', () => {
  it('should accept an empty body', async () => {
    expect(await errorsOf({})).toEqual([]);
  });

  it('should accept values at the length limits', async () => {
    expect(
      await errorsOf({
        appName: 'a'.repeat(20),
        slogan: 'a'.repeat(40),
        companyName: 'a'.repeat(60),
        copyright: 'a'.repeat(100),
        icpLicense: 'a'.repeat(50),
        servicePhone: '+86 400-123-4567',
        serviceHours: 'a'.repeat(40),
        serviceEmail: 'service@example.com',
        shareTitle: 'a'.repeat(40),
      }),
    ).toEqual([]);
  });

  it.each([
    ['appName', 20],
    ['slogan', 40],
    ['companyName', 60],
    ['copyright', 100],
    ['icpLicense', 50],
    ['serviceHours', 40],
    ['shareTitle', 40],
  ])('should reject %s longer than %i characters', async (field, max) => {
    expect(await errorsOf({ [field]: 'a'.repeat(max + 1) })).toEqual([field]);
  });

  it('should limit the length after trimming', async () => {
    expect(await errorsOf({ appName: `  ${'a'.repeat(20)}  ` })).toEqual([]);
  });

  it.each(['400#123', '电话 4001234', 'tel:4001234', '+', '- -'])(
    'should reject service phone %s',
    async (servicePhone) => {
      expect(await errorsOf({ servicePhone })).toEqual(['servicePhone']);
    },
  );

  it('should reject a service phone longer than 20 characters', async () => {
    expect(await errorsOf({ servicePhone: '1'.repeat(21) })).toEqual(['servicePhone']);
  });

  it('should accept a service email of 100 characters', async () => {
    expect(await errorsOf({ serviceEmail: `${'a'.repeat(64)}@${'b'.repeat(31)}.com` })).toEqual([]);
  });

  it('should reject a service email longer than 100 characters', async () => {
    expect(await errorsOf({ serviceEmail: `${'a'.repeat(64)}@${'b'.repeat(32)}.com` })).toEqual(['serviceEmail']);
  });

  it('should reject an invalid service email', async () => {
    expect(await errorsOf({ serviceEmail: 'service@' })).toEqual(['serviceEmail']);
  });

  it('should reject non-string values', async () => {
    expect(await errorsOf({ appName: 123, slogan: ['a'] })).toEqual(['appName', 'slogan']);
  });

  it('should convert blank strings to null and skip validation', async () => {
    const dto = plainToInstance(UpdateAppProfileDto, { serviceEmail: '   ', servicePhone: '' });
    expect(dto).toMatchObject({ serviceEmail: null, servicePhone: null });
    expect(await validate(dto)).toEqual([]);
  });
});

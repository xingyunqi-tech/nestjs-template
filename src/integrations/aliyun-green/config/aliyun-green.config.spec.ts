import aliyunGreenConfig from './aliyun-green.config';

const KEYS = ['ALIYUN_GREEN_ACCESS_KEY_ID', 'ALIYUN_GREEN_ACCESS_KEY_SECRET', 'ALIYUN_GREEN_REGION'] as const;

describe('aliyunGreenConfig', () => {
  const saved: Partial<Record<(typeof KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('should default to cn-shanghai without credentials when variables are unset', () => {
    expect(aliyunGreenConfig()).toEqual({ accessKeyId: '', accessKeySecret: '', region: 'cn-shanghai' });
  });

  it('should fall back to defaults when variables are empty strings', () => {
    Object.assign(process.env, {
      ALIYUN_GREEN_ACCESS_KEY_ID: '',
      ALIYUN_GREEN_ACCESS_KEY_SECRET: '',
      ALIYUN_GREEN_REGION: '',
    });

    expect(aliyunGreenConfig()).toEqual({ accessKeyId: '', accessKeySecret: '', region: 'cn-shanghai' });
  });

  it('should trim the credentials and treat whitespace-only values as unset', () => {
    Object.assign(process.env, {
      ALIYUN_GREEN_ACCESS_KEY_ID: '  ak \n',
      ALIYUN_GREEN_ACCESS_KEY_SECRET: '   ',
    });

    expect(aliyunGreenConfig()).toEqual({ accessKeyId: 'ak', accessKeySecret: '', region: 'cn-shanghai' });
  });

  it('should read configured values', () => {
    Object.assign(process.env, {
      ALIYUN_GREEN_ACCESS_KEY_ID: 'ak',
      ALIYUN_GREEN_ACCESS_KEY_SECRET: 'sk',
      ALIYUN_GREEN_REGION: 'cn-beijing',
    });

    expect(aliyunGreenConfig()).toEqual({ accessKeyId: 'ak', accessKeySecret: 'sk', region: 'cn-beijing' });
  });

  it.each(['green-cip.cn-shanghai.aliyuncs.com', 'CN-SHANGHAI', 'shanghai'])(
    'should reject ALIYUN_GREEN_REGION=%s',
    (value) => {
      process.env.ALIYUN_GREEN_REGION = value;

      expect(() => aliyunGreenConfig()).toThrow(/ALIYUN_GREEN_REGION/);
    },
  );
});

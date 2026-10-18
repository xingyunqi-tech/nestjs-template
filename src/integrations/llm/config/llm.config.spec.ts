import llmConfig from './llm.config';

const KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_TIMEOUT_MS'] as const;

describe('llmConfig', () => {
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

  it('should default to DeepSeek when variables are unset', () => {
    expect(llmConfig()).toEqual({
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
      timeoutMs: 120_000,
    });
  });

  it('should fall back to defaults when variables are empty strings', () => {
    Object.assign(process.env, { LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '', LLM_TIMEOUT_MS: '' });

    expect(llmConfig()).toEqual({
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
      timeoutMs: 120_000,
    });
  });

  it('should read configured values', () => {
    Object.assign(process.env, {
      LLM_BASE_URL: 'https://llm.example.com/v1',
      LLM_API_KEY: 'sk-1',
      LLM_MODEL: 'deepseek-reasoner',
      LLM_TIMEOUT_MS: '60000',
    });

    expect(llmConfig()).toEqual({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'sk-1',
      model: 'deepseek-reasoner',
      timeoutMs: 60_000,
    });
  });

  it.each(['abc', '500', '300000'])('should reject LLM_TIMEOUT_MS=%s', (value) => {
    process.env.LLM_TIMEOUT_MS = value;

    expect(() => llmConfig()).toThrow(/LLM_TIMEOUT_MS/);
  });
});

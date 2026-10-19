import type { Mocked } from 'vitest';
import { AppProfileService } from './app-profile.service';
import { AppConfigService } from '../config/config.service';

const EMPTY_PROFILE = {
  appName: null,
  slogan: null,
  companyName: null,
  copyright: null,
  icpLicense: null,
  servicePhone: null,
  serviceHours: null,
  serviceEmail: null,
  shareTitle: null,
};

describe('AppProfileService', () => {
  let appConfigService: Mocked<Pick<AppConfigService, 'getValue' | 'upsert'>>;
  let service: AppProfileService;
  let stored: Record<string, unknown> | undefined;

  beforeEach(() => {
    stored = undefined;
    appConfigService = {
      getValue: vi.fn(async () => stored?.value),
      upsert: vi.fn(async (key: string, value: Record<string, unknown>) => {
        stored = value;
        return { key, value, isPublic: true, createdAt: new Date(), updatedAt: new Date() };
      }),
    } as unknown as Mocked<Pick<AppConfigService, 'getValue' | 'upsert'>>;
    service = new AppProfileService(appConfigService as unknown as AppConfigService);
  });

  it('should return every field as null when nothing has been saved', async () => {
    await expect(service.get()).resolves.toEqual(EMPTY_PROFILE);
  });

  it('should read back the saved profile', async () => {
    const saved = await service.update({ appName: '备考刷题', servicePhone: '400-123 4567' });

    expect(saved).toEqual({ ...EMPTY_PROFILE, appName: '备考刷题', servicePhone: '400-123 4567' });
    await expect(service.get()).resolves.toEqual(saved);
    expect(appConfigService.upsert).toHaveBeenCalledWith('app.profile', { value: saved });
  });

  it('should store blank and missing fields as null', async () => {
    await expect(service.update({ appName: '  备考  ', slogan: '   ', shareTitle: null })).resolves.toEqual({
      ...EMPTY_PROFILE,
      appName: '备考',
    });
  });

  it('should replace the whole profile on update', async () => {
    await service.update({ appName: '备考刷题', slogan: '一站式备考' });
    await service.update({ slogan: '新宣传语' });

    await expect(service.get()).resolves.toEqual({ ...EMPTY_PROFILE, slogan: '新宣传语' });
  });

  it('should ignore unknown keys and non-string values in the stored config', async () => {
    stored = { value: { appName: 1, slogan: ' 宣传语 ', extra: 'x' } };

    await expect(service.get()).resolves.toEqual({ ...EMPTY_PROFILE, slogan: '宣传语' });
  });
});

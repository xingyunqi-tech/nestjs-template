import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { APP_PROFILE_FIELDS, AppProfile } from './domain/app-profile';
import { UpdateAppProfileDto } from './dto/update-app-profile.dto';

export const APP_PROFILE_CONFIG_KEY = 'app.profile';

const toProfile = (source: unknown): AppProfile => {
  const record = source !== null && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  return Object.fromEntries(
    APP_PROFILE_FIELDS.map((field) => {
      const value = record[field];
      return [field, typeof value === 'string' && value.trim() ? value.trim() : null];
    }),
  ) as unknown as AppProfile;
};

@Injectable()
export class AppProfileService {
  constructor(private readonly appConfigService: AppConfigService) {}

  async get(): Promise<AppProfile> {
    return toProfile(await this.appConfigService.getValue(APP_PROFILE_CONFIG_KEY));
  }

  /** 整体覆盖，未传的字段保存为 null */
  async update(dto: UpdateAppProfileDto): Promise<AppProfile> {
    const profile = toProfile(dto);
    await this.appConfigService.upsert(APP_PROFILE_CONFIG_KEY, { value: profile });
    return profile;
  }
}

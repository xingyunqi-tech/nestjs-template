import { ApiProperty } from '@nestjs/swagger';

export const APP_PROFILE_FIELDS = [
  'appName',
  'slogan',
  'companyName',
  'copyright',
  'icpLicense',
  'servicePhone',
  'serviceHours',
  'serviceEmail',
  'shareTitle',
] as const;

export type AppProfileField = (typeof APP_PROFILE_FIELDS)[number];

export const APP_PROFILE_MAX_LENGTH = {
  appName: 20,
  slogan: 40,
  companyName: 60,
  copyright: 100,
  icpLicense: 50,
  servicePhone: 20,
  serviceHours: 40,
  serviceEmail: 100,
  shareTitle: 40,
} as const satisfies Partial<Record<AppProfileField, number>>;

export const SERVICE_PHONE_PATTERN = /^(?=.*\d)[\d\-+ ]+$/;

/** 每个字段未配置时为 null */
export class AppProfile {
  @ApiProperty({ type: String, nullable: true, example: '备考刷题', description: '产品名称' })
  appName: string | null;

  @ApiProperty({ type: String, nullable: true, example: '刷题、模考、错题本，一站式高效备考', description: '宣传语' })
  slogan: string | null;

  @ApiProperty({ type: String, nullable: true, description: '公司名称' })
  companyName: string | null;

  @ApiProperty({ type: String, nullable: true, description: '版权信息' })
  copyright: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ICP 备案号' })
  icpLicense: string | null;

  @ApiProperty({ type: String, nullable: true, description: '客服电话' })
  servicePhone: string | null;

  @ApiProperty({ type: String, nullable: true, example: '工作日 9:00-18:00', description: '客服服务时间' })
  serviceHours: string | null;

  @ApiProperty({ type: String, nullable: true, description: '客服邮箱' })
  serviceEmail: string | null;

  @ApiProperty({ type: String, nullable: true, description: '分享标题，为 null 时客户端使用产品名称' })
  shareTitle: string | null;
}

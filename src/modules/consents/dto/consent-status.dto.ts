import { ApiProperty } from '@nestjs/swagger';
import { ConsentType } from '../domain/consent-type';

export class ConsentStatusDto {
  @ApiProperty({ enum: ConsentType, enumName: 'ConsentType' })
  type: ConsentType;

  @ApiProperty({ type: String, nullable: true, description: '当前版本，未配置时为 null' })
  currentVersion: string | null;

  @ApiProperty({ type: String, nullable: true, description: '最近一次同意的版本，从未同意时为 null' })
  agreedVersion: string | null;

  @ApiProperty({ type: Date, nullable: true })
  agreedAt: Date | null;

  @ApiProperty({ type: Boolean, description: '已同意当前版本' })
  agreed: boolean;

  @ApiProperty({
    type: Boolean,
    description: '已配置当前版本且尚未同意；agreedVersion 不为 null 时为版本升级后的重新同意',
  })
  needsConsent: boolean;
}

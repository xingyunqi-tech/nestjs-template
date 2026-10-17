import { ApiProperty } from '@nestjs/swagger';

export class Config {
  @ApiProperty({ type: String, example: 'app.theme' })
  key: string;

  @ApiProperty({ type: Object, example: { primaryColor: '#1890ff' } })
  value: Record<string, unknown>;

  @ApiProperty({ type: Boolean, example: true, description: '公开配置可被所有登录用户读取' })
  isPublic: boolean;

  @ApiProperty({ type: Date, nullable: true, description: '未写入过的登记项返回默认值，时间为 null' })
  createdAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  updatedAt: Date | null;
}

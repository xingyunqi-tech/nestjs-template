import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import aliyunGreenConfig from './config/aliyun-green.config';
import { ContentModerationProvider } from './content-moderation-provider';
import { AliyunGreenModerationProvider } from './providers/aliyun-green-moderation.provider';

@Module({
  imports: [ConfigModule.forFeature(aliyunGreenConfig)],
  providers: [{ provide: ContentModerationProvider, useClass: AliyunGreenModerationProvider }],
  exports: [ContentModerationProvider],
})
export class AliyunGreenModule {}

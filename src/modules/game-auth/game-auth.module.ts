import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WechatModule } from '../../integrations/wechat/wechat.module';
import { GameAuthController } from './game-auth.controller';
import { GameAuthService } from './game-auth.service';
import { RelationalGamePlayerPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [RelationalGamePlayerPersistenceModule, WechatModule, JwtModule.register({})],
  controllers: [GameAuthController],
  providers: [GameAuthService],
})
export class GameAuthModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppProfileController } from './app-profile.controller';
import { AdminAppProfileController } from './admin-app-profile.controller';
import { AppProfileService } from './app-profile.service';

@Module({
  imports: [AppConfigModule],
  controllers: [AppProfileController, AdminAppProfileController],
  providers: [AppProfileService],
})
export class AppProfileModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigSeedService } from './config-seed.service';
import { ConfigEntity } from '../../../../../modules/config/infrastructure/persistence/relational/entities/config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConfigEntity])],
  providers: [ConfigSeedService],
  exports: [ConfigSeedService],
})
export class ConfigSeedModule {}

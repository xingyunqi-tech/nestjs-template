import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfigService } from '../../typeorm-config.service';
import { dataSourceFactory } from '../../data-source.factory';
import { RoleSeedModule } from './role/role-seed.module';
import { StatusSeedModule } from './status/status-seed.module';
import { UserSeedModule } from './user/user-seed.module';
import { PermissionSeedModule } from './permission/permission-seed.module';
import { RegionSeedModule } from './region/region-seed.module';
import { ConfigSeedModule } from './config/config-seed.module';
import databaseConfig from '../../config/database.config';
import appConfig from '../../../../config/app.config';

@Module({
  imports: [
    RoleSeedModule,
    StatusSeedModule,
    UserSeedModule,
    PermissionSeedModule,
    RegionSeedModule,
    ConfigSeedModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, appConfig],
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
      dataSourceFactory,
    }),
  ],
})
export class SeedModule {}

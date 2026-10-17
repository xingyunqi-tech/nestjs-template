import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAlertEntity } from './entities/admin-alert.entity';
import { AdminAlertRepository } from '../admin-alert.repository';
import { AdminAlertRelationalRepository } from './repositories/admin-alert.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAlertEntity])],
  providers: [
    {
      provide: AdminAlertRepository,
      useClass: AdminAlertRelationalRepository,
    },
  ],
  exports: [AdminAlertRepository],
})
export class RelationalMonitorPersistenceModule {}

import { Global, Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { AlertService } from './alert.service';
import { QueueMonitorService } from './queue-monitor.service';
import { RelationalMonitorPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { UsersModule } from '../../core/users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertReporter } from '../../infrastructure/alerting/alert-reporter';

@Global()
@Module({
  imports: [RelationalMonitorPersistenceModule, UsersModule, NotificationsModule],
  controllers: [MonitorController],
  providers: [AlertService, QueueMonitorService, { provide: AlertReporter, useExisting: AlertService }],
  exports: [AlertService, AlertReporter],
})
export class MonitorModule {}

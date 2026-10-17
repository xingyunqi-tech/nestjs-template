import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ImportsCoreModule } from './imports-core.module';
import { ImportLauncher } from './import-launcher';
import { ImportJobWatchdogTask } from './import-job-watchdog.task';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { AdminImportsController } from './admin-imports.controller';
import { IMPORT_QUEUE } from '../../infrastructure/queue/import-queue/import-queue.constants';
import { isRedisEnabled } from '../../infrastructure/redis/config/redis.config';

@Module({
  imports: [
    ImportsCoreModule,
    SchedulerModule,
    ConditionalModule.registerWhen(BullModule.registerQueue({ name: IMPORT_QUEUE }), isRedisEnabled),
  ],
  controllers: [AdminImportsController],
  providers: [ImportLauncher, ImportJobWatchdogTask],
  exports: [ImportsCoreModule],
})
export class ImportsModule {}

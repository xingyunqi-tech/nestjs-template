import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJobEntity } from './entities/import-job.entity';
import { ImportJobRepository } from '../import-job.repository';
import { ImportJobRelationalRepository } from './repositories/import-job.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ImportJobEntity])],
  providers: [{ provide: ImportJobRepository, useClass: ImportJobRelationalRepository }],
  exports: [ImportJobRepository],
})
export class RelationalImportPersistenceModule {}

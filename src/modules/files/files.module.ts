import { Module } from '@nestjs/common';

import { RelationalFilePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { FileUrlResolver } from './file-url.resolver';
import { FileStorageService } from './file-storage.service';
import { FilesAccountCleaner } from './files-account.cleaner';
import fileConfig from './config/file.config';
import { FileConfig, FileDriver } from './config/file-config.type';
import { FilesLocalModule } from './infrastructure/uploader/local/files.module';
import { FilesS3Module } from './infrastructure/uploader/s3/files.module';
import { FilesS3PresignedModule } from './infrastructure/uploader/s3-presigned/files.module';

const infrastructureUploaderModule =
  (fileConfig() as FileConfig).driver === FileDriver.LOCAL
    ? FilesLocalModule
    : (fileConfig() as FileConfig).driver === FileDriver.S3
      ? FilesS3Module
      : FilesS3PresignedModule;

@Module({
  imports: [RelationalFilePersistenceModule, infrastructureUploaderModule],
  controllers: [FilesController],
  providers: [FilesService, FileUrlResolver, FileStorageService, FilesAccountCleaner],
  exports: [FilesService, FileUrlResolver, FileStorageService, RelationalFilePersistenceModule],
})
export class FilesModule {}

import { Module } from '@nestjs/common';
import { FilesLocalController } from './files.controller';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

import { FilesLocalService } from './files.service';
import { LOCAL_FILES_ROOT } from '../../../local-file-path';
import { purposeFileFilter } from '../../../file-purposes';

import { RelationalFilePersistenceModule } from '../../persistence/relational/relational-persistence.module';
import { AllConfigType } from '../../../../../config/config.type';

@Module({
  imports: [
    RelationalFilePersistenceModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AllConfigType>) => {
        return {
          fileFilter: purposeFileFilter,
          storage: diskStorage({
            destination: LOCAL_FILES_ROOT,
            filename: (_request, file, callback) => {
              callback(null, `${randomStringGenerator()}.${file.originalname.split('.').pop()?.toLowerCase()}`);
            },
          }),
          limits: {
            fileSize: configService.get('file.maxFileSize', { infer: true }),
          },
        };
      },
    }),
  ],
  controllers: [FilesLocalController],
  providers: [ConfigModule, ConfigService, FilesLocalService],
  exports: [FilesLocalService],
})
export class FilesLocalModule {}

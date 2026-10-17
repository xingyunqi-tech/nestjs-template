import { Module } from '@nestjs/common';
import { FilesS3Controller } from './files.controller';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { createS3Client } from '../../../config/s3-client.factory';
import multerS3 from 'multer-s3';

import { FilesS3Service } from './files.service';
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
        const s3 = createS3Client(configService.getOrThrow('file', { infer: true }));

        return {
          fileFilter: purposeFileFilter,
          storage: multerS3({
            s3: s3,
            bucket: configService.getOrThrow('file.awsDefaultS3Bucket', {
              infer: true,
            }),
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: (_request, file, callback) => {
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
  controllers: [FilesS3Controller],
  providers: [FilesS3Service],
  exports: [FilesS3Service],
})
export class FilesS3Module {}

import 'dotenv/config';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import databaseConfig from '../../../infrastructure/database/config/database.config';
import appConfig from '../../../config/app.config';
import fileConfig from '../../files/config/file.config';
import redisConfig from '../../../infrastructure/redis/config/redis.config';
import { TypeOrmConfigService } from '../../../infrastructure/database/typeorm-config.service';
import { dataSourceFactory } from '../../../infrastructure/database/data-source.factory';
import { CacheModule } from '../../../infrastructure/cache/cache.module';
import { RedisModule } from '../../../infrastructure/redis/redis.module';
import { PermissionsModule } from '../../../core/permissions/permissions.module';
import { ImportsCoreModule } from '../imports-core.module';
import { ImportsService } from '../imports.service';
import { ImportJobStatus } from '../domain/import-job-status';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, appConfig, fileConfig, redisConfig],
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        ...new TypeOrmConfigService(configService).createTypeOrmOptions(),
        logging: false,
      }),
      dataSourceFactory,
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'zh',
      loaderOptions: { path: join(__dirname, '../../../i18n/'), watch: false },
      logging: false,
      resolvers: [AcceptLanguageResolver],
    }),
    CacheModule,
    RedisModule,
    PermissionsModule,
    ImportsCoreModule,
  ],
})
class ImportContentModule {}

const USAGE = 'Usage: pnpm import:content <file> [--publish]';

const importContent = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const [path, ...rest] = args.filter((arg) => arg !== '--publish');
  if (!path || rest.length > 0) {
    console.error(USAGE);
    return 2;
  }

  const content = await readFile(path);
  const app = await NestFactory.createApplicationContext(ImportContentModule, { logger: ['error', 'warn'] });
  const logger = new Logger('ImportContent');
  try {
    const importsService = app.get(ImportsService);
    const job = await importsService.createFromContent(content, basename(path), publish);
    const execution = await importsService.execute(job.id);
    if (!execution) {
      logger.error(`Import job ${job.id} was not started`);
      return 1;
    }
    const { job: finished, errors } = execution;
    for (const error of errors) {
      const field = error.field ? ` [${error.field}]` : '';
      const detail = error.detail ? ` (${error.detail})` : '';
      console.log(
        `${error.sheet}:${error.row}${field} ${error.reason} ${importsService.describe(error.reason)}${detail}`,
      );
    }
    console.log(
      `Import job ${finished.id} ${finished.status}: total ${finished.total}, succeeded ${finished.succeeded}, skipped ${finished.skipped}, failed ${finished.failed}` +
        (finished.failureReason
          ? `, reason ${finished.failureReason} ${importsService.describe(finished.failureReason)}`
          : '') +
        (finished.errorReportFileId ? `, error report file ${finished.errorReportFileId}` : ''),
    );
    return finished.status === ImportJobStatus.DONE && finished.failed === 0 ? 0 : 1;
  } finally {
    await app.close();
  }
};

importContent().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

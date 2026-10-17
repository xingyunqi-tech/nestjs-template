import { ClassSerializerInterceptor, Type, ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { useContainer } from 'class-validator';
import { getMetadataArgsStorage } from 'typeorm';
import { register } from '@prometheus-io/client';
import { AppModule } from '../../src/app.module';
import validationOptions from '../../src/common/validation-options';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResolvePromisesInterceptor } from '../../src/common/serializer.interceptor';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { TypeOrmConfigService } from '../../src/infrastructure/database/typeorm-config.service';

/** 进程内启动完整应用，配置与 main.ts 一致 */
export async function createTestApp(controllers: Type[] = []): Promise<NestExpressApplication> {
  register.clear();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(TypeOrmConfigService)
    .useFactory({
      inject: [ConfigService],
      factory: (configService: ConfigService) => ({
        createTypeOrmOptions: (): TypeOrmModuleOptions => ({
          ...new TypeOrmConfigService(configService).createTypeOrmOptions(),
          entities: getMetadataArgsStorage().tables.map((table) => table.target),
          migrations: [],
          logging: false,
        }),
      }),
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  app.set('trust proxy', true);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.setGlobalPrefix('api', { exclude: ['/', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(reflector),
    new ResponseInterceptor(reflector),
  );
  await app.init();
  return app;
}

export function randomIp(): string {
  const octet = (): number => Math.floor(Math.random() * 250) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

import 'dotenv/config';
import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import validationOptions from './common/validation-options';
import { AllConfigType } from './config/config.type';
import { ResolvePromisesInterceptor } from './common/serializer.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { MetricsMiddleware } from './infrastructure/metrics/metrics.middleware';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { applyRequestBodyContent } from './common/swagger/api-request-body-content';
import { requestContextMiddleware } from './common/request-context';

/** 容纳协议正文等富文本配置（HTML 约 200KB） */
const JSON_BODY_LIMIT = '256kb';

/** 允许浏览器跨域读取的响应头 */
const CORS_EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Use Pino logger
  app.useLogger(app.get(Logger));
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  const trustProxy = configService.get('app.trustProxy', { infer: true });
  if (trustProxy) {
    app.set('trust proxy', trustProxy);
  }

  app.use(requestContextMiddleware);

  // CORS configuration
  const frontendDomain = configService.get('app.frontendDomain', { infer: true });
  const nodeEnv = configService.get('app.nodeEnv', { infer: true });

  if (nodeEnv === 'production' && frontendDomain) {
    // Production: only allow configured frontend domain(s)
    const allowedOrigins = frontendDomain.split(',').map((origin) => origin.trim());
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  } else {
    // Development: allow all origins for easier testing
    app.enableCors({
      origin: true,
      credentials: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  }

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Global exception filter
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  app.enableShutdownHooks();
  app.setGlobalPrefix(configService.getOrThrow('app.apiPrefix', { infer: true }), {
    exclude: ['/', 'metrics'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalPipes(new ValidationPipe(validationOptions));

  if (configService.get('metrics.enabled', { infer: true })) {
    const metricsMiddleware = app.get(MetricsMiddleware);
    app.use(metricsMiddleware.use.bind(metricsMiddleware));
  }

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(reflector),
    new ResponseInterceptor(reflector), // Wrap responses in unified format
  );

  if (configService.get('app.swaggerEnabled', { infer: true })) {
    const options = new DocumentBuilder()
      .setTitle('API')
      .setDescription(
        'API docs\n\n' +
          '📄 **OpenAPI JSON**: [/docs-json](/docs-json)\n\n' +
          '📥 **Download**: [openapi.json](/docs-json)',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addGlobalParameters({
        in: 'header',
        required: false,
        name: 'Accept-Language',
        schema: {
          example: 'en',
        },
      })
      .build();

    const document = applyRequestBodyContent(SwaggerModule.createDocument(app, options));
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(configService.getOrThrow('app.port', { infer: true }));
}
void bootstrap();

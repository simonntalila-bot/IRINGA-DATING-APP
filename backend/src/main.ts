import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfig } from './common/config/app-config';

async function bootstrap(): Promise<void> {
  // `rawBody: true` is REQUIRED: the payment webhook verifies an HMAC over the
  // exact bytes the gateway sent. Without the raw buffer the signature can never
  // be verified and no entitlement is ever granted.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(AppConfig);

  app.setGlobalPrefix(config.apiPrefix);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Iringa Dating API listening on http://localhost:${config.port}/${config.apiPrefix}`);
}

void bootstrap();

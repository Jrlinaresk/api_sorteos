import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { configureHttpBodyParsers } from './config/http-body-parser.config';
import { configureAdminPanel } from './config/admin-panel.config';
import { configurePrivateApiCaching } from './config/private-api-cache.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const express = app.getHttpAdapter().getInstance();
  const production = config.get<string>('NODE_ENV') === 'production';
  const swaggerEnabled =
    !production && config.get<string>('SWAGGER_ENABLED') !== 'false';

  if (config.get<string>('TRUST_PROXY') === 'true')
    express.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: swaggerEnabled
            ? ["'self'", "'unsafe-inline'"]
            : ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  configureHttpBodyParsers(app);
  app.enableCors(corsOptions(config));
  app.useGlobalFilters(new AllExceptionsFilter());
  configurePrivateApiCaching(express);
  configureAdminPanel(express, config, logger);

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Sorteos API')
      .setDescription(
        'Campañas, checkout Pix, cuotas, resultados y administración',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-Order-Token' },
        'order-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(config.get<string>('PORT') || 8080);
  const host = config.get<string>('HOST') || '0.0.0.0';
  await app.listen(port, host);
  logger.log(`API escuchando en ${host}:${port}`);
}

function corsOptions(config: ConfigService) {
  const production = config.get<string>('NODE_ENV') === 'production';
  const configured = (config.get<string>('CORS_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const allowed = new Set(
    configured.length || production
      ? configured
      : [
          'http://localhost:3000',
          'http://localhost:4200',
          'http://localhost:5173',
          'http://localhost:5174',
        ],
  );
  if (production && allowed.size === 0) {
    throw new Error('CORS_ORIGINS es obligatorio en producción');
  }
  return {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Order-Token',
      'X-Payment-Token',
      'X-Prize-Token',
      'X-Client-Session',
      'X-Admin-Session',
      'X-Correlation-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-Correlation-Id',
      'Content-Disposition',
      'ETag',
      'Accept-Ranges',
      'Content-Range',
    ],
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      return allowed.has(normalized)
        ? callback(null, true)
        : callback(new Error('Origen CORS no permitido'));
    },
  };
}

void bootstrap();

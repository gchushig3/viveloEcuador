import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { GatewayEnvironment } from './config/gateway-environment.js';
import { AppModule } from './app.module.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';
import { addGatewayPaths } from './modules/swagger/swagger-document.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true, colors: false }),
    bodyParser: false,
  });
  const env = app
    .get(ConfigService)
    .getOrThrow<GatewayEnvironment>('gateway');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableCors({
    origin: env.CORS_ORIGINS.length === 0 ? false : env.CORS_ORIGINS,
    credentials: false,
  });
  app.use(app.get(CorrelationIdMiddleware).use.bind(app.get(CorrelationIdMiddleware)));
  app.useGlobalInterceptors(app.get(RequestLoggingInterceptor));
  app.useGlobalFilters(app.get(GlobalExceptionFilter));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Descubre EC API Gateway')
    .setDescription('Punto de entrada versionado para los microservicios de Descubre EC.')
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .build();
  const document = addGatewayPaths(
    SwaggerModule.createDocument(app, swaggerConfig),
  );
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: false },
  });

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`api-gateway: startup failed: ${reason.slice(0, 300)}\n`);
  process.exitCode = 1;
});

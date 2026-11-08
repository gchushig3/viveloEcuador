import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnvironment } from './config/environment.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { HealthController } from './modules/health/health.controller.js';
import { HealthService } from './modules/health/health.service.js';
import { ProxyController } from './modules/proxy/proxy.controller.js';
import { ProxyService } from './modules/proxy/proxy.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (source) => ({
        ...source,
        gateway: validateEnvironment(source),
      }),
    }),
  ],
  controllers: [HealthController, ProxyController],
  providers: [
    HealthService,
    ProxyService,
    CorrelationIdMiddleware,
    RequestLoggingInterceptor,
    GlobalExceptionFilter,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}

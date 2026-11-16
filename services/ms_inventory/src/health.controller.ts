import { Controller, Get } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { PublicInfrastructure, SagaReadinessService } from '@booking/infrastructure';

@Controller('health')
@PublicInfrastructure()
export class HealthController {
  constructor(private readonly readiness: SagaReadinessService) {}
  @Get('live') live() { return { status: 'UP' }; }
  @Get('ready') ready() { return this.readiness.ready(); }
  @GrpcMethod('Health', 'Check')
  async check() {
    try { await this.readiness.ready(); return { status: 1 }; }
    catch { return { status: 2 }; }
  }
}

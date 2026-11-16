import { Controller, Get } from '@nestjs/common';
import { PublicInfrastructure, SagaReadinessService } from '@booking/infrastructure';

@Controller('health')
@PublicInfrastructure()
export class HealthController {
  constructor(private readonly readiness: SagaReadinessService) {}
  @Get('live') live() { return { status: 'UP' }; }
  @Get('ready') ready() { return this.readiness.ready(); }
}

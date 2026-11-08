import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'UP' } {
    return { status: 'UP' };
  }

  @Get()
  async healthCheck(@Res() response: Response): Promise<void> {
    await this.writeHealth(response);
  }

  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    await this.writeHealth(response);
  }

  private async writeHealth(response: Response): Promise<void> {
    const result = await this.health.check();
    response.status(result.status === 'UP' ? 200 : 503).json(result);
  }
}

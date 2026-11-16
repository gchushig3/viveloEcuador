import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ClientsService } from './clients.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly clients: ClientsService) {}
  @Get('live') live() { return { status: 'UP' as const }; }
  @Get('ready') async ready() {
    try { await this.clients.ready(); return { status: 'UP' as const }; }
    catch { throw new ServiceUnavailableException({ status: 'DOWN' }); }
  }
}

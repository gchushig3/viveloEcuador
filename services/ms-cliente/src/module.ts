import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [ClientsController, HealthController],
  providers: [ClientsService],
})
export class AppModule {}

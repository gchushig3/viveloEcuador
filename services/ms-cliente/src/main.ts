import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './module.js';

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v2');
app.enableCors({ origin: false });
await app.listen(Number(process.env.PORT ?? 3018), '0.0.0.0');

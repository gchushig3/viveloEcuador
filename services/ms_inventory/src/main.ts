import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { inventoryGrpcOptions, sagaRmqOptions } from '@booking/infrastructure';
import { AppModule } from './app.module.js';
import { dirname, join } from 'node:path';

const app = await NestFactory.create(AppModule, {
  logger: new ConsoleLogger({ json: true, colors: false }),
});
const config = app.get(ConfigService);
app.setGlobalPrefix('api/v2');
app.enableShutdownHooks();
const grpc = inventoryGrpcOptions(config, true);
const inventoryProtoPath = config.getOrThrow<string>('INVENTORY_PROTO_PATH');
grpc.options!.package = ['inventory', 'grpc.health.v1'];
grpc.options!.protoPath = [inventoryProtoPath, join(dirname(inventoryProtoPath), 'health.proto')];
app.connectMicroservice(grpc);
app.connectMicroservice(sagaRmqOptions(config, 'ms_inventory'));
await app.startAllMicroservices();
await app.listen(Number(config.get('PORT') ?? 3017), '0.0.0.0');

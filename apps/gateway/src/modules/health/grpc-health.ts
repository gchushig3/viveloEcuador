import { credentials, loadPackageDefinition, type Client, type ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { resolve } from 'node:path';

type HealthClient = Client & {
  check(request: { service: string }, options: { deadline: number }, callback: (error: ServiceError | null, result?: { status: string }) => void): unknown;
};

export function checkGrpcHealth(address: string, tls: boolean, timeoutMs: number): Promise<boolean> {
  const definition = loadSync(resolve(process.cwd(), '../../contracts/grpc/health.proto'), { enums: String, defaults: true });
  const proto = loadPackageDefinition(definition) as unknown as { grpc: { health: { v1: { Health: new (address: string, channelCredentials: ReturnType<typeof credentials.createSsl>) => HealthClient } } } };
  const client = new proto.grpc.health.v1.Health(address, tls ? credentials.createSsl() : credentials.createInsecure());
  return new Promise(resolveResult => {
    client.check({ service: '' }, { deadline: Date.now() + timeoutMs }, (error, result) => {
      client.close();
      resolveResult(!error && result?.status === 'SERVING');
    });
  });
}

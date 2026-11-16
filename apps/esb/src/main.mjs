import { loadConfig } from './config.mjs';
import { createEsb } from './server.mjs';

const config = loadConfig(process.env);
const server = createEsb(config);
server.listen(config.port, () => console.log(JSON.stringify({ service: 'esb', port: config.port })));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
});

import { configFromEnv, startServer } from './server.js';

async function main(): Promise<void> {
  const cfg = configFromEnv();
  const running = await startServer(cfg);
  const stop = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((err) => {
  console.error(`[mc-bff] no se pudo arrancar: ${(err as Error).message}`);
  process.exit(1);
});

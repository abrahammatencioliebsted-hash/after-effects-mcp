import { ConfigError, loadConfig } from './config.js';
import { loadAllowedCommands } from './commands.js';
import { HeartbeatLoop, collectHeartbeat } from './heartbeat.js';
import { createLogger } from './log.js';
import { closeServer, createAgentServer, listen } from './server.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const log = createLogger();
  let cfg;
  let commands;
  try {
    cfg = loadConfig();
    commands = await loadAllowedCommands(cfg);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  if (!cfg.bffUrl) log.info('Modo "solo local": MC_BFF_URL no está definido, no se enviarán latidos');
  if (!cfg.token) log.warn('MC_NODE_AGENT_TOKEN no definido: las rutas protegidas responderán 503');
  if (!['127.0.0.1', 'localhost', '::1'].includes(cfg.host)) {
    log.warn('El servidor escucha fuera de loopback; protege el puerto con firewall y token', { host: cfg.host });
  }

  const loop = new HeartbeatLoop({ cfg, log, collect: () => collectHeartbeat(cfg, commands, log) });
  const server = createAgentServer({
    cfg,
    log,
    commands,
    getSnapshot: async () => loop.latest ?? (await collectHeartbeat(cfg, commands, log)),
  });
  const port = await listen(server, cfg.host, cfg.port);
  log.info('node-agent iniciado', {
    version: VERSION,
    machineId: cfg.machineId,
    os: cfg.machineOs,
    host: cfg.host,
    port,
    heartbeatSec: cfg.heartbeatSec,
    maxHeavyJobs: cfg.maxHeavyJobs,
    commands: commands.length,
    bff: cfg.bffUrl ?? null,
  });
  loop.start();

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    log.info('Cerrando node-agent', { signal });
    loop.stop();
    void closeServer(server).then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: Error) => {
  process.stderr.write(`Error fatal del node-agent: ${err.message}\n`);
  process.exit(1);
});

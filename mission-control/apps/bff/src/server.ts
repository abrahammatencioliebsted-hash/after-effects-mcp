import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createPaperclipClient } from '@mc/paperclip-client';
import { buildServices, createApp, type McApp, type Services } from './app.js';
import { DemoBackend } from './backends/demo.js';
import { PaperclipBackend } from './backends/paperclip.js';
import { BFF_VERSION, type McBackend } from './backends/types.js';

const PKG_ROOT = resolve(import.meta.dirname, '..');

export interface ServerConfig {
  mode: 'demo' | 'paperclip';
  port: number;
  host: string;
  paperclipUrl: string;
  paperclipToken?: string;
  companyId?: string;
  nodeAgentToken?: string;
  dataDir: string;
  catalogDir: string;
  electionsFile?: string;
  modelPricesFile?: string;
  staticDir: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = (env.MC_BACKEND || 'demo').toLowerCase();
  if (mode !== 'demo' && mode !== 'paperclip') throw new Error(`MC_BACKEND inválido: "${mode}" (usa demo o paperclip)`);
  const port = Number(env.MC_PORT || 3300);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`MC_PORT inválido: ${env.MC_PORT}`);
  const cfg: ServerConfig = {
    mode,
    port,
    host: env.MC_HOST || '127.0.0.1',
    paperclipUrl: env.MC_PAPERCLIP_URL || 'http://127.0.0.1:3100',
    dataDir: resolve(env.MC_DATA_DIR || './data'),
    catalogDir: resolve(PKG_ROOT, env.MC_CATALOG_PATH || '../../packages/catalog/catalog'),
    staticDir: resolve(PKG_ROOT, env.MC_STATIC_DIR || '../ui/dist'),
  };
  if (env.MC_PAPERCLIP_TOKEN) cfg.paperclipToken = env.MC_PAPERCLIP_TOKEN;
  if (env.MC_PAPERCLIP_COMPANY_ID) cfg.companyId = env.MC_PAPERCLIP_COMPANY_ID;
  if (env.MC_NODE_AGENT_TOKEN) cfg.nodeAgentToken = env.MC_NODE_AGENT_TOKEN;
  if (env.MC_ELECTIONS_FILE) cfg.electionsFile = env.MC_ELECTIONS_FILE;
  if (env.MC_MODEL_PRICES_FILE) cfg.modelPricesFile = env.MC_MODEL_PRICES_FILE;
  return cfg;
}

export interface RunningServer {
  app: McApp;
  backend: McBackend;
  services: Services;
  port: number;
  close(): Promise<void>;
}

export async function startServer(cfg: ServerConfig, log: (line: string) => void = console.log): Promise<RunningServer> {
  const services = buildServices({ dataDir: cfg.dataDir, catalogDir: cfg.catalogDir, ...(cfg.modelPricesFile ? { modelPricesFile: cfg.modelPricesFile } : {}) });
  const deps = { ...services };
  const backend: McBackend =
    cfg.mode === 'paperclip'
      ? new PaperclipBackend(deps, {
          client: createPaperclipClient({ baseUrl: cfg.paperclipUrl, ...(cfg.paperclipToken ? { token: cfg.paperclipToken } : {}) }),
          baseUrl: cfg.paperclipUrl,
          ...(cfg.companyId ? { companyId: cfg.companyId } : {}),
          nodeAgentTokenSet: Boolean(cfg.nodeAgentToken),
        })
      : new DemoBackend(deps);
  const app = createApp({
    backend,
    services,
    ...(cfg.electionsFile ? { electionsFile: cfg.electionsFile } : {}),
    ...(cfg.nodeAgentToken ? { nodeAgentToken: cfg.nodeAgentToken } : {}),
    staticDir: cfg.staticDir,
  });
  await backend.start();
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host });
  await new Promise<void>((res, rej) => {
    server.once('listening', () => res());
    server.once('error', rej);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;

  const bar = '='.repeat(64);
  const label = cfg.mode === 'demo' ? 'DEMO — DATOS SIMULADOS' : 'PAPERCLIP — DATOS REALES';
  log(bar);
  log(`  MISSION CONTROL BFF v${BFF_VERSION}   MODO: ${cfg.mode.toUpperCase()}`);
  log(`  ${label}`);
  log(bar);
  log(`  Escuchando en   http://${cfg.host}:${port}  (API en /api/mc/*)`);
  if (cfg.mode === 'paperclip') log(`  Paperclip       ${cfg.paperclipUrl}${cfg.companyId ? `  empresa ${cfg.companyId}` : '  (primera empresa)'}`);
  log(`  Datos propios   ${cfg.dataDir}/mc.sqlite`);
  log(`  Catálogo        ${cfg.catalogDir}`);
  log(`  UI estática     ${existsSync(resolve(cfg.staticDir, 'index.html')) ? cfg.staticDir : 'no encontrada (solo API)'}`);
  log(`  Node-agent      ${cfg.nodeAgentToken ? 'token configurado' : cfg.mode === 'paperclip' ? 'SIN TOKEN: latidos desactivados' : 'sin token: latidos solo desde loopback'}`);
  log(bar);

  return {
    app,
    backend,
    services,
    port,
    async close() {
      await backend.stop();
      app.close();
      await new Promise<void>((res) => {
        server.close(() => res());
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      services.db.close();
    },
  };
}

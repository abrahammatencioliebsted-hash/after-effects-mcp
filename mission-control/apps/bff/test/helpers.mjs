import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemoBackend, buildServices, createApp } from '../dist/index.js';

export const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, 'fixtures', 'Registro de elecciones.md');
export const CATALOG_DIR = join(here, '..', '..', '..', 'packages', 'catalog', 'catalog');
export const FIXED_NOW = new Date('2026-10-08T12:00:00.000Z');

export function demoApp(extra = {}) {
  const services = buildServices({ dataDir: ':memory:', catalogDir: CATALOG_DIR });
  const backend = new DemoBackend({ ...services, now: () => FIXED_NOW });
  const app = createApp({
    backend,
    services,
    electionsFile: FIXTURE,
    nodeAgentToken: 'token-de-prueba-0123456789',
    sseHeartbeatMs: 100,
    quiet: true,
    ...extra,
  });
  return { app, backend, services };
}

export async function getJson(app, path, init) {
  const res = await app.request(path, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

export function post(app, path, body, headers = {}) {
  return getJson(app, path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
}

export function missionBody(over = {}) {
  return {
    title: 'Prueba de misión',
    objective: 'Objetivo de prueba para el BFF.',
    priority: 'medium',
    team: { mode: 'manual', agentIds: ['demo-agent-investigacion'] },
    limits: { maxMinutes: 30, maxSteps: 5, reportLength: 'short' },
    finish: 'deliver',
    scope: 'proyectos',
    ...over,
  };
}

export function heartbeatBody(id, over = {}) {
  return {
    machineId: id,
    name: 'Equipo de prueba',
    os: 'windows',
    nodeAgentVersion: '0.0.1',
    health: { at: new Date().toISOString(), cpuPercent: 10, memUsedBytes: 1, memTotalBytes: 2, diskUsedBytes: 1, diskTotalBytes: 2, uptimeSec: 5 },
    hermes: { installed: true, apiServer: { reachable: true, baseUrl: 'http://127.0.0.1:8642' } },
    allowedCommandIds: ['hermes-status'],
    ...over,
  };
}

export function assertKeys(assert, obj, keys, label = 'objeto') {
  for (const k of keys) assert.ok(k in obj, `${label}: falta la clave "${k}"`);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MachineRegistry, SettingsStore, activityToTimeline, commentsToTimeline, estadoFromDecision, isRetryRun, machineStatus, mapIssueStatus, mergeTimeline, openDb, parseIdeas, runsToTimeline } from '../dist/index.js';
import { FIXTURE, heartbeatBody } from './helpers.mjs';

test('parseIdeas lee las tres ideas del Registro de elecciones como sin-decision', () => {
  const ideas = parseIdeas(readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(ideas.map((i) => i.id), ['N01', 'N02', 'N05']);
  assert.ok(ideas.every((i) => i.estado === 'sin-decision'));
  assert.equal(ideas[0].idea, 'Ensayo con un prospecto real (ENVOLVEX)');
  assert.equal(ideas[2].fecha, '2026-10-08');
  assert.equal(ideas[0].razonLiteral, undefined, '"—" no es una razón');
  assert.equal(ideas[0].dondeLoDijiste, 'Chat de rebote, ciclo 1');
});

test('parseIdeas reconoce otros estados y celdas con \\|', () => {
  const md = '| Fecha | ID | Idea | Decisión | Tu razón (literal) | Dónde lo dijiste | Qué cambia para la próxima ronda |\n| --- | --- | --- | --- | --- | --- | --- |\n| 2026-10-09 | N06 | A \\| B | Elegida | "porque sí" | Chat | Más de esto |\n| 2026-10-09 | N07 | C | Descartada | — | — | — |\n';
  const ideas = parseIdeas(md);
  assert.equal(ideas[0].idea, 'A | B');
  assert.equal(ideas[0].estado, 'elegida');
  assert.equal(ideas[0].razonLiteral, '"porque sí"');
  assert.equal(ideas[0].cambioProximaRonda, 'Más de esto');
  assert.equal(ideas[1].estado, 'descartada');
  assert.equal(estadoFromDecision('Aplazada hasta nuevo aviso'), 'aplazada');
  assert.equal(estadoFromDecision('Modificada por ti'), 'modificada');
  assert.deepEqual(parseIdeas('# nada\n\ntexto'), []);
});

test('mapeo de estados issue -> misión', () => {
  const table = { backlog: 'briefing', todo: 'briefing', in_progress: 'ongoing', in_review: 'review', done: 'delivered', blocked: 'blocked', cancelled: 'cancelled' };
  for (const [k, v] of Object.entries(table)) assert.equal(mapIssueStatus(k), v, k);
  assert.equal(mapIssueStatus('raro'), 'briefing');
  assert.equal(mapIssueStatus(undefined), 'briefing');
});

test('machineStatus: online < 90 s, stale < 10 min, offline después, unknown sin latido', () => {
  const now = 1_000_000_000;
  assert.equal(machineStatus(undefined, now), 'unknown');
  assert.equal(machineStatus(now - 89_000, now), 'online');
  assert.equal(machineStatus(now - 90_000, now), 'stale');
  assert.equal(machineStatus(now - 599_000, now), 'stale');
  assert.equal(machineStatus(now - 600_000, now), 'offline');
});

test('registro de máquinas: transiciones con reloj inyectado y eventos de cambio', () => {
  let t = Date.parse('2026-10-08T10:00:00Z');
  const reg = new MachineRegistry(openDb(':memory:'), { now: () => t });
  assert.deepEqual(reg.list().map((m) => m.id), ['win-principal', 'win-laptop-1', 'win-laptop-2', 'mac']);
  assert.equal(reg.statusOf(reg.get('mac')), 'unknown');
  const r = reg.heartbeat('mac', heartbeatBody('mac', { os: 'macos' }));
  assert.deepEqual(r.changed, { from: 'unknown', to: 'online' });
  assert.equal(reg.hermesBaseUrl('mac'), 'http://127.0.0.1:8642');
  assert.deepEqual(reg.detectTransitions(), []);
  t += 100_000;
  assert.equal(reg.statusOf(reg.get('mac')), 'stale');
  assert.deepEqual(reg.detectTransitions(), [{ machineId: 'mac', status: 'stale' }]);
  t += 11 * 60_000;
  assert.deepEqual(reg.detectTransitions(), [{ machineId: 'mac', status: 'offline' }]);
  const again = reg.heartbeat('mac', heartbeatBody('mac', { os: 'macos' }));
  assert.deepEqual(again.changed, { from: 'offline', to: 'online' });
  assert.equal(reg.commandsFor('mac')[0].id, 'hermes-status');
  // un equipo nuevo también se registra
  reg.heartbeat('nube', heartbeatBody('nube', { os: 'linux' }));
  assert.ok(reg.get('nube'));
});

test('mergeTimeline ordena por tiempo y desempata por orden lógico', () => {
  const e = (id, at, kind) => ({ id, at, kind, actorType: 'system', summary: id });
  const merged = mergeTimeline(
    [e('c', '2026-10-08T10:00:02.000Z', 'run_finished'), e('a', '2026-10-08T10:00:00.000Z', 'created')],
    [e('m', '2026-10-08T10:00:02.000Z', 'message'), e('r', '2026-10-08T10:00:02.000Z', 'run_started'), e('z', '2026-10-08T09:59:59.000Z', 'system')],
  );
  assert.deepEqual(merged.map((x) => x.id), ['z', 'a', 'r', 'm', 'c']);
});

test('línea de tiempo desde datos de Paperclip: tipos mapeados y ordenados', () => {
  const actors = { agentName: (id) => (id === 'ag1' ? 'Ejecutor' : undefined) };
  const activity = [
    { id: '1', action: 'issue.created', actorType: 'user', actorId: 'local-board', createdAt: '2026-10-08T08:10:31.478Z', details: { title: 'T' } },
    { id: '2', action: 'issue.comment_added', actorType: 'agent', agentId: 'ag1', createdAt: '2026-10-08T08:10:33.853Z', details: {} },
    { id: '3', action: 'issue.disposition_repair_escalated', actorType: 'system', runId: 'r1', createdAt: '2026-10-08T08:11:37.667Z', details: { maxAttempts: 2, attemptCount: 2, terminalReason: 'unchanged_source_state_exhausted' } },
    { id: '4', action: 'issue.updated', actorType: 'user', createdAt: '2026-10-08T08:14:00.600Z', details: { changes: { status: { from: 'blocked', to: 'in_review' } } } },
    { id: '5', action: 'issue.updated', actorType: 'user', createdAt: '2026-10-08T08:14:00.997Z', details: { changes: { status: { from: 'in_review', to: 'done' } } } },
    { id: '6', action: 'issue.updated', actorType: 'agent', agentId: 'ag1', createdAt: '2026-10-08T08:12:00.000Z', details: { changes: { status: { from: 'todo', to: 'in_progress' } } } },
    { id: '7', action: 'issue.inbox_archived', actorType: 'user', createdAt: '2026-10-08T08:14:00.866Z', details: {} },
  ];
  const comments = [{ id: 'c1', body: 'Respuesta ... MC-STUB-OK', authorType: 'agent', authorAgentId: 'ag1', createdAt: '2026-10-08T08:10:33.842Z' }, { id: 'c2', body: 'Aviso', authorType: 'system', createdAt: '2026-10-08T08:11:37.654Z' }];
  const runs = [
    { id: 'r1', agentId: 'ag1', agentName: 'Ejecutor', status: 'succeeded', source: 'automation', startedAt: '2026-10-08T08:11:36.059Z', finishedAt: '2026-10-08T08:11:37.342Z', durationSec: 1, tokens: { input: 1, output: 1, cachedInput: 0, estimatedCents: null, costStatus: 'unpriced' } },
    { id: 'r2', agentId: 'ag1', agentName: 'Ejecutor', status: 'failed', source: 'assignment', startedAt: '2026-10-08T08:10:31.658Z', finishedAt: '2026-10-08T08:10:32.606Z', errorCode: 'boom', error: 'x', tokens: { input: 1, output: 1, cachedInput: 0, estimatedCents: null, costStatus: 'unpriced' } },
  ];
  const raw = new Map([['r1', { invocationSource: 'automation', createdAt: '2026-10-08T08:10:33.979Z' }], ['r2', { invocationSource: 'assignment', createdAt: '2026-10-08T08:10:31.530Z' }]]);
  const tl = mergeTimeline(activityToTimeline(activity, actors), commentsToTimeline(comments, actors), runsToTimeline(runs, raw));
  const kinds = tl.map((x) => x.kind);
  assert.equal(kinds[0], 'created');
  for (const k of ['assigned', 'run_started', 'run_failed', 'run_finished', 'message', 'escalated', 'review_requested', 'accepted', 'status_changed', 'retry', 'system']) assert.ok(kinds.includes(k), k);
  assert.ok(!tl.some((x) => x.summary.includes('inbox')), 'el ruido no aparece en la vista normal');
  const times = tl.map((x) => Date.parse(x.at));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.equal(tl.find((x) => x.kind === 'message').actorName, 'Ejecutor');
  assert.ok(tl.find((x) => x.kind === 'message').body.includes('MC-STUB-OK'));
  assert.ok(activityToTimeline(activity, actors, { includeNoise: true }).some((x) => x.summary === 'issue.inbox_archived'));
  assert.equal(isRetryRun({ invocationSource: 'automation' }), true);
  assert.equal(isRetryRun({ invocationSource: 'assignment', scheduledRetryAttempt: 1 }), true);
  assert.equal(isRetryRun({ invocationSource: 'assignment', retryOfRunId: 'x' }), true);
  assert.equal(isRetryRun({ invocationSource: 'on_demand' }), false);
});

test('precios: solo se estima coste cuando se conoce el modelo', () => {
  const s = new SettingsStore(openDb(':memory:'));
  assert.equal(s.estimateCents('modelo-desconocido', 1_000_000, 1_000_000), null);
  assert.equal(s.estimateCents('unknown', 100, 100), null);
  assert.equal(s.estimateCents(undefined, 100, 100), null);
  const c = s.estimateCents('mimo-v2.6-pro', 1_000_000, 1_000_000);
  assert.equal(c, 150); // (0.3 + 1.2) USD = 150 centavos con los números de ejemplo
  const t = s.applyEstimate({ input: 1_000_000, output: 0, cachedInput: 0, estimatedCents: null, costStatus: 'unpriced' }, 'mimo-v2.6-pro');
  assert.equal(t.costStatus, 'estimated');
  assert.equal(t.estimatedCents, 30);
  assert.equal(s.applyEstimate({ input: 5, output: 5, cachedInput: 0, estimatedCents: null, costStatus: 'unpriced' }, undefined).costStatus, 'unpriced');
});

test('secretos de Hermes por equipo: SQLite tiene prioridad sobre la variable de entorno', () => {
  const s = new SettingsStore(openDb(':memory:'), { env: { MC_HERMES_SECRET_WIN_LAPTOP_1: 'del-entorno' } });
  assert.equal(s.getHermesSecretId('win-laptop-1'), 'del-entorno');
  assert.equal(s.getHermesSecretId('mac'), undefined);
  s.setHermesSecret('win-laptop-1', 'de-sqlite');
  assert.equal(s.getHermesSecretId('win-laptop-1'), 'de-sqlite');
});

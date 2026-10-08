import test from 'node:test';
import assert from 'node:assert/strict';
import { missionStatusInfo, agentStateInfo, priorityInfo, comparePriority, severityFor, severityTone, compatInfo, machineStatusInfo, toneVar, KANBAN_COLUMNS, MISSION_STATUSES } from '../src/lib/status.ts';
import { availableActions } from '../src/lib/actions.ts';

test('estados de misión: etiqueta en español, tono e icono (nunca solo color)', () => {
  for (const s of MISSION_STATUSES) {
    const i = missionStatusInfo(s);
    assert.ok(i.label.length > 0 && i.icon.length > 0 && i.tone);
  }
  assert.equal(missionStatusInfo('review').label, 'Revisión');
  assert.deepEqual(KANBAN_COLUMNS, ['briefing', 'ongoing', 'review', 'delivered']);
});

test('estados de agente: trabajando usa el acento y disponible el tono cálido', () => {
  assert.equal(agentStateInfo('working').tone, 'accent');
  assert.equal(agentStateInfo('available').tone, 'idle');
  assert.equal(agentStateInfo('paused').tone, 'muted');
  assert.equal(agentStateInfo('error').tone, 'crit');
  assert.equal(toneVar('idle'), 'var(--tone-idle)');
});

test('prioridad: orden crítica < alta < estándar < baja', () => {
  const order = ['low', 'critical', 'medium', 'high'].sort(comparePriority);
  assert.deepEqual(order, ['critical', 'high', 'medium', 'low']);
  assert.equal(priorityInfo('medium').label, 'Estándar');
});

test('severidad contra umbral: normal, atención (15 puntos antes) y crítico', () => {
  assert.equal(severityFor(40, 85), 'ok');
  assert.equal(severityFor(70, 85), 'warn');
  assert.equal(severityFor(85, 85), 'crit');
  assert.equal(severityFor(Number.NaN, 85), 'ok');
  assert.equal(severityTone('crit'), 'crit');
});

test('compatibilidad NC/FV/VL/PF y estado de máquina', () => {
  assert.equal(compatInfo('PF').long, 'Listo para usar');
  assert.equal(compatInfo('NC').tone, 'crit');
  assert.equal(machineStatusInfo('stale').label, 'Latido atrasado');
});

test('acciones disponibles según estado de la misión', () => {
  assert.deepEqual(availableActions({ status: 'briefing', approvalPending: true }), ['approve', 'reject', 'stop']);
  assert.deepEqual(availableActions({ status: 'briefing', approvalPending: false, plan: { status: 'rejected' } }), ['stop']);
  assert.deepEqual(availableActions({ status: 'review', approvalPending: false }), ['accept', 'changes', 'rerun']);
  assert.deepEqual(availableActions({ status: 'cancelled', approvalPending: false }), []);
});

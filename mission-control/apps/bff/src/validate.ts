import type { AgentCreateRequest, MissionCreateRequest } from '@mc/contracts';
import { badRequest } from './errors.js';
import { isPriority } from './status.js';
import { asRecord } from './util.js';

const SCOPES = ['trabajo', 'proyectos', 'personal'] as const;
const PLATFORMS = ['hermes', 'claude', 'codex', 'grok', 'mimo'] as const;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'unknown'] as const;

function text(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw badRequest(`${field} es obligatorio (texto)`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw badRequest(`${field} debe tener entre ${min} y ${max} caracteres`);
  return t;
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${field} debe ser un entero entre ${min} y ${max}`);
  return v;
}

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw badRequest(`${field} debe ser uno de: ${allowed.join(', ')}`);
  return v as T;
}

function strList(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.length > 0 && x.length < 200)) throw badRequest(`${field} debe ser una lista de textos`);
  return v as string[];
}

export function validateMissionCreate(body: unknown): MissionCreateRequest {
  const b = asRecord(body);
  const team = asRecord(b.team);
  const limits = asRecord(b.limits);
  if (!isPriority(b.priority)) throw badRequest('priority debe ser critical, high, medium o low');
  const mode = oneOf(team.mode, 'team.mode', ['boss', 'manual', 'rules'] as const);
  const req: MissionCreateRequest = {
    title: text(b.title, 'title', 1, 200),
    objective: text(b.objective, 'objective', 1, 20_000),
    priority: b.priority,
    team: { mode, agentIds: strList(team.agentIds, 'team.agentIds'), ...(typeof team.bossAgentId === 'string' && team.bossAgentId ? { bossAgentId: team.bossAgentId } : {}) },
    limits: {
      maxMinutes: int(limits.maxMinutes, 'limits.maxMinutes', 1, 1440),
      maxSteps: int(limits.maxSteps, 'limits.maxSteps', 1, 50),
      reportLength: oneOf(limits.reportLength, 'limits.reportLength', ['short', 'medium', 'long'] as const),
    },
    finish: oneOf(b.finish, 'finish', ['deliver', 'review_first'] as const),
    scope: oneOf(b.scope, 'scope', SCOPES),
  };
  if (b.targetDate !== undefined) {
    if (typeof b.targetDate !== 'string' || Number.isNaN(Date.parse(b.targetDate))) throw badRequest('targetDate debe ser una fecha ISO 8601');
    req.targetDate = b.targetDate;
  }
  if (b.requiredCapabilities !== undefined) req.requiredCapabilities = strList(b.requiredCapabilities, 'requiredCapabilities');
  if (b.ideaId !== undefined) {
    if (typeof b.ideaId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(b.ideaId)) throw badRequest('ideaId inválido');
    req.ideaId = b.ideaId;
  }
  return req;
}

export function validateAgentCreate(body: unknown): AgentCreateRequest {
  const b = asRecord(body);
  const req: AgentCreateRequest = {
    name: text(b.name, 'name', 1, 80),
    role: text(b.role, 'role', 1, 60),
    platform: oneOf(b.platform, 'platform', PLATFORMS),
    machineId: text(b.machineId, 'machineId', 1, 60),
  };
  if (b.shortName !== undefined) req.shortName = text(b.shortName, 'shortName', 1, 24);
  if (b.modelLabel !== undefined) req.modelLabel = text(b.modelLabel, 'modelLabel', 1, 120);
  if (b.effort !== undefined) req.effort = oneOf(b.effort, 'effort', EFFORTS);
  if (b.instructions !== undefined) req.instructions = text(b.instructions, 'instructions', 0, 20_000);
  if (b.budgetMonthlyCents !== undefined) req.budgetMonthlyCents = int(b.budgetMonthlyCents, 'budgetMonthlyCents', 0, 100_000_000);
  if (b.reportsTo !== undefined) req.reportsTo = text(b.reportsTo, 'reportsTo', 1, 80);
  return req;
}

export function validateDocCreate(body: unknown): { title: string; markdown: string; missionId?: string } {
  const b = asRecord(body);
  const out: { title: string; markdown: string; missionId?: string } = {
    title: text(b.title, 'title', 1, 200),
    markdown: text(b.markdown, 'markdown', 1, 1_000_000),
  };
  if (b.missionId !== undefined) out.missionId = text(b.missionId, 'missionId', 1, 80);
  return out;
}

export function optNote(body: unknown): string | undefined {
  const n = asRecord(body).note;
  if (n === undefined || n === null) return undefined;
  if (typeof n !== 'string') throw badRequest('note debe ser texto');
  return n.trim() || undefined;
}

export function reqNote(body: unknown): string {
  const n = optNote(body);
  if (!n) throw badRequest('note es obligatorio');
  return n;
}

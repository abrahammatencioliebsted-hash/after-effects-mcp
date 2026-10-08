// Backend simulado en memoria para ?mock=1. Responde con la misma forma que el BFF. Todo es SIMULADO.
import type {
  AgentCreateRequest,
  AgentSummary,
  DocumentSummary,
  MissionCreateRequest,
  MissionDetail,
  MissionStatus,
  MissionSummary,
  SharedSettings,
  TimelineEvent,
} from '@mc/contracts';
import { ApiRequestError } from '../lib/api.ts';
import type { Query } from '../lib/api.ts';
import {
  COMMANDS,
  buildHealth,
  buildOverview,
  nowMs,
  seedActivity,
  seedAgents,
  seedCatalog,
  seedDocs,
  seedIdeas,
  seedMachines,
  seedMissions,
  seedRoutines,
  seedSettings,
} from './fixtures.ts';

const state = {
  agents: seedAgents(),
  machines: seedMachines(),
  missions: seedMissions(),
  docs: [] as Array<{ summary: DocumentSummary; markdown: string }>,
  routines: seedRoutines(),
  activity: seedActivity(),
  catalog: seedCatalog(),
  ideas: seedIdeas(),
  settings: seedSettings(),
  idem: new Map<string, string>(),
  counter: 12,
};
state.docs = seedDocs(state.missions);

const wait = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms));

function notFound(what: string): never {
  throw new ApiRequestError(`${what} no existe`, 404, 'not_found');
}
function invalid(msg: string): never {
  throw new ApiRequestError(msg, 400, 'invalid_request');
}

function toSummary(m: MissionDetail): MissionSummary {
  const { objective: _o, team: _t, limits: _l, finish: _f, timeline: _tl, runs: _r, children: _c, plan: _p, documents: _d, result: _res, provenance: _pr, ...summary } = m;
  return summary;
}

function addEvent(m: MissionDetail, e: Omit<TimelineEvent, 'id' | 'at'>) {
  m.timeline.push({ id: `${m.id}-e${m.timeline.length + 1}`, at: new Date(nowMs()).toISOString(), ...e });
}

function logActivity(summary: string, action: string, m?: MissionDetail) {
  state.activity.unshift({ id: `act-${nowMs()}`, at: new Date(nowMs()).toISOString(), actorType: 'user', actorName: 'Tú', action, summary, ...(m ? { missionIdentifier: m.identifier } : {}) });
}

function getMission(id: string): MissionDetail {
  return state.missions.find((m) => m.id === id) ?? notFound('La misión');
}

function str(q: Query | undefined, k: string): string | undefined {
  const v = q?.[k];
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

function noteOf(body: unknown): string | undefined {
  return (body as { note?: string } | undefined)?.note;
}

export async function handleMock(method: string, path: string, query: Query | undefined, body: unknown): Promise<unknown> {
  await wait();
  const parts = path.split('/').filter(Boolean);
  const [res, id, sub, sub2] = parts;
  const key = `${method} ${res}`;

  switch (key) {
    case 'GET health':
      return buildHealth('demo');
    case 'GET overview':
      return buildOverview(state.missions, state.agents, state.machines);
    case 'GET settings':
      return state.settings;
    case 'PUT settings':
      state.settings = body as SharedSettings;
      return state.settings;
    case 'GET machines':
      if (id && sub === 'commands') return COMMANDS;
      return state.machines;
    case 'POST machines': {
      if (id && sub === 'commands' && sub2) {
        const cmd = COMMANDS.find((c) => c.id === sub2) ?? notFound('El comando');
        await wait(500);
        return { ok: true, stdout: `[SIMULADO] ${cmd.argv.join(' ')}\nprofile: mc\ngateway: running (pid 4242)\n`, stderr: '', exitCode: 0, durationMs: 512 };
      }
      return notFound('La ruta');
    }
    case 'GET catalog': {
      if (id === 'validate') return { ok: true, issues: [{ capabilityId: 'cap-slack', path: 'necesita[0]', message: 'Falta referencia al secreto (simulado).', severity: 'warning' }, { capabilityId: 'cap-browser', path: 'evidencia', message: 'Sin evidencia registrada (simulado).', severity: 'warning' }] };
      if (id === 'match') return { candidates: state.agents.slice(0, 3).map((a, i) => ({ agentId: a.id, machineId: a.machineId ?? 'nube', score: 90 - i * 15, reasons: ['Compatible con la capacidad', 'Menor carga'] })) };
      let items = state.catalog;
      const tipo = str(query, 'tipo'); const equipo = str(query, 'equipo'); const ejecutor = str(query, 'ejecutor'); const estado = str(query, 'estado');
      if (tipo) items = items.filter((c) => c.tipo === tipo);
      if (equipo) items = items.filter((c) => c.equipos.includes(equipo));
      if (ejecutor) items = items.filter((c) => c.ejecutores.includes(ejecutor as never));
      if (estado) items = items.filter((c) => c.estado === estado);
      return items;
    }
    case 'GET ideas':
      return state.ideas;
    case 'GET schedule':
      return state.routines;
    case 'POST schedule': {
      const r = state.routines.find((x) => x.id === id) ?? notFound('La rutina');
      if (!r.canRunNow) throw new ApiRequestError('Esta rutina es de solo lectura', 409, 'conflict');
      r.lastRunAt = new Date(nowMs()).toISOString();
      logActivity(`Rutina ejecutada ahora: ${r.title}`, 'routine.run_now');
      return { ok: true };
    }
    case 'GET activity':
      return { items: state.activity.slice(0, Number(str(query, 'limit') ?? 50)) };
    case 'GET docs': {
      if (id) {
        const d = state.docs.find((x) => x.summary.id === id) ?? notFound('El documento');
        return d;
      }
      const q = str(query, 'q')?.toLowerCase();
      const mid = str(query, 'missionId');
      return state.docs
        .map((d) => d.summary)
        .filter((d) => (!q || `${d.title} ${d.excerpt}`.toLowerCase().includes(q)) && (!mid || d.missionId === mid))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    case 'POST docs': {
      const b = body as { title?: string; markdown?: string; missionId?: string };
      if (!b.title?.trim() || !b.markdown?.trim()) invalid('Título y contenido son obligatorios');
      const summary: DocumentSummary = { id: `doc-n${++state.counter}`, title: b.title.trim(), ...(b.missionId ? { missionId: b.missionId } : {}), authorName: 'Tú', authorType: 'user', createdAt: new Date(nowMs()).toISOString(), excerpt: b.markdown.replace(/[#>*\n]+/g, ' ').trim().slice(0, 140), wordCount: (b.markdown.match(/\S+/g) ?? []).length, source: 'mc-note' };
      state.docs.unshift({ summary, markdown: b.markdown });
      return summary;
    }
    case 'GET agents': {
      if (id && sub === 'runs') return state.missions.flatMap((m) => m.runs).filter((r) => r.agentId === id).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, Number(str(query, 'limit') ?? 10));
      return state.agents;
    }
    case 'POST agents': {
      const b = body as AgentCreateRequest;
      if (!b.name?.trim()) invalid('El nombre es obligatorio');
      const a: AgentSummary = {
        id: `ag-${++state.counter}`, name: b.name.trim(), shortName: b.shortName?.trim() || b.name.trim().split(/\s+/)[0] || b.name, role: b.role, platform: b.platform, machineId: b.machineId,
        state: 'available', ...(b.modelLabel ? { modelLabel: b.modelLabel } : {}), effort: b.effort ?? 'medium', isBoss: false, reportsTo: b.reportsTo ?? 'ag-executor', workloadShare: 0, avgDurationSec: 0,
        runsTotal: 0, runsSucceeded: 0, runsFailed: 0, tokens: { input: 0, output: 0, cachedInput: 0, estimatedCents: 0, costStatus: 'estimated' }, budgetMonthlyCents: b.budgetMonthlyCents ?? 2500, spentMonthlyCents: 0, origin: 'demo',
      };
      state.agents.push(a);
      logActivity(`Agente creado: ${a.name}`, 'agent.created');
      return a;
    }
    case 'DELETE agents': {
      const i = state.agents.findIndex((a) => a.id === id);
      if (i < 0) notFound('El agente');
      state.agents.splice(i, 1);
      return { ok: true };
    }
    case 'GET missions': {
      if (id && sub === 'replay') return { events: getMission(id).timeline.map((e) => ({ ...e, raw: { source: 'simulado', id: e.id } })) };
      if (id) return getMission(id);
      let items = state.missions.map(toSummary);
      const statuses = str(query, 'status')?.split(',');
      if (statuses?.length) items = items.filter((m) => statuses.includes(m.status));
      const scope = str(query, 'scope');
      if (scope) items = items.filter((m) => m.scope === scope);
      const q = str(query, 'q')?.toLowerCase();
      if (q) items = items.filter((m) => `${m.title} ${m.identifier} ${m.assigneeName ?? ''}`.toLowerCase().includes(q));
      // Paginación como el BFF: `cursor` opaco (aquí, el desplazamiento) y `nextCursor` si quedan más.
      const sorted = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const offset = Math.max(0, Number(str(query, 'cursor') ?? 0) || 0);
      const limit = Number(str(query, 'limit') ?? 200);
      const page = sorted.slice(offset, offset + limit);
      return offset + limit < sorted.length ? { items: page, nextCursor: String(offset + limit) } : { items: page };
    }
    case 'POST missions': {
      if (!id) {
        const b = body as MissionCreateRequest;
        if (!b.title?.trim() || !b.objective?.trim()) invalid('Título y objetivo son obligatorios');
        // Idempotencia: misma clave => misma misión (la clave la envía api.ts en la cabecera; aquí se emula con el título).
        const dupe = state.idem.get(`${b.title}|${b.objective}`);
        if (dupe) return getMission(dupe);
        const n = ++state.counter;
        const boss = state.agents.find((a) => a.isBoss);
        const mission: MissionDetail = {
          id: `mis-${n}`, identifier: `DEMO-${n}`, title: b.title.trim(), status: 'briefing', paperclipStatus: 'todo', priority: b.priority, scope: b.scope,
          createdAt: new Date(nowMs()).toISOString(), durationSec: 0, tokens: { input: 0, output: 0, cachedInput: 0, estimatedCents: 0, costStatus: 'estimated' }, retryCount: 0, approvalPending: true,
          childCount: 0, childDoneCount: 0, ...(b.ideaId ? { ideaId: b.ideaId } : {}), ...(b.targetDate ? { targetDate: b.targetDate } : {}),
          objective: b.objective, team: b.team, limits: b.limits, finish: b.finish, timeline: [], runs: [], children: [], documents: [],
          plan: {
            id: `plan-${n}`, proposedAt: new Date(nowMs()).toISOString(), proposedBy: { type: b.team.mode === 'boss' ? 'agent' : 'rules', name: boss?.name ?? 'Reglas' }, status: 'pending',
            rationale: b.team.mode === 'manual' ? 'Equipo elegido a mano; el plan reparte los pasos entre los agentes seleccionados.' : 'Plan propuesto automáticamente (simulado).',
            steps: (b.team.mode === 'manual' && b.team.agentIds.length ? b.team.agentIds : state.agents.filter((a) => !a.isBoss && a.state !== 'paused').slice(0, 2).map((a) => a.id)).slice(0, b.limits.maxSteps).map((aid, i) => {
              const ag = state.agents.find((a) => a.id === aid);
              return { order: i + 1, title: i === 0 ? 'Reunir contexto y fuentes' : `Paso ${i + 1}`, agentId: aid, agentName: ag?.name ?? aid, ...(ag?.machineId ? { machineId: ag.machineId } : {}), minutes: Math.max(5, Math.round(b.limits.maxMinutes / Math.max(1, b.limits.maxSteps))) };
            }),
          },
          provenance: [{ component: 'Misión', state: 'simulado', note: 'Creada en el navegador (?mock=1).' }],
        };
        addEvent(mission, { kind: 'created', actorType: 'user', actorName: 'Tú', summary: 'Misión creada desde el asistente' });
        addEvent(mission, { kind: 'plan_proposed', actorType: 'agent', actorName: boss?.name ?? 'Reglas', summary: 'Plan propuesto', body: mission.plan?.rationale });
        state.missions.unshift(mission);
        state.idem.set(`${b.title}|${b.objective}`, mission.id);
        logActivity(`Misión creada: ${mission.title}`, 'mission.created', mission);
        return mission;
      }
      const m = getMission(id);
      const note = noteOf(body);
      const set = (status: MissionStatus, e: Omit<TimelineEvent, 'id' | 'at'>) => { m.status = status; addEvent(m, e); };
      switch (`${sub}${sub2 ? `/${sub2}` : ''}`) {
        case 'plan/approve':
          m.approvalPending = false;
          if (m.plan) m.plan.status = 'approved';
          m.startedAt = new Date(nowMs()).toISOString();
          m.paperclipStatus = 'in_progress';
          set('ongoing', { kind: 'plan_approved', actorType: 'user', actorName: 'Tú', summary: 'Plan aprobado', ...(note ? { body: note } : {}) });
          addEvent(m, { kind: 'message', actorType: 'agent', actorName: 'Executor', summary: `Executor → ${m.assigneeName ?? 'equipo'}`, body: 'Misión aprobada. Empieza con el paso 1 y reporta avances.' });
          break;
        case 'plan/reject':
          m.approvalPending = false;
          if (m.plan) m.plan.status = 'rejected';
          set('briefing', { kind: 'rejected', actorType: 'user', actorName: 'Tú', summary: 'Plan rechazado', ...(note ? { body: note } : {}) });
          break;
        case 'accept':
          m.completedAt = new Date(nowMs()).toISOString();
          m.paperclipStatus = 'done';
          set('delivered', { kind: 'accepted', actorType: 'user', actorName: 'Tú', summary: 'Resultados aceptados', ...(note ? { body: note } : {}) });
          break;
        case 'request-changes':
          m.paperclipStatus = 'in_progress';
          set('ongoing', { kind: 'status_changed', actorType: 'user', actorName: 'Tú', summary: 'Cambios solicitados', ...(note ? { body: note } : {}) });
          break;
        case 'rerun':
          m.retryCount += 1;
          m.paperclipStatus = 'in_progress';
          set('ongoing', { kind: 'retry', actorType: 'user', actorName: 'Tú', summary: `Reejecución ${m.retryCount}`, ...(note ? { body: note } : {}) });
          break;
        case 'stop':
          m.paperclipStatus = 'cancelled';
          set('cancelled', { kind: 'status_changed', actorType: 'user', actorName: 'Tú', summary: 'Misión detenida', ...(note ? { body: note } : {}) });
          break;
        default:
          notFound('La acción');
      }
      logActivity(`${m.identifier}: ${m.timeline[m.timeline.length - 1]?.summary ?? ''}`, `mission.${sub}`, m);
      return m;
    }
    default:
      return notFound(`La ruta ${method} ${path}`);
  }
}

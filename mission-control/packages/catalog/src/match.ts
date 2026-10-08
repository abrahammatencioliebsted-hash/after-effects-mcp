import type { AgentSummary, Capability, MachineSummary } from '@mc/contracts';

export interface MatchContext {
  capabilities: Capability[];
  agents: AgentSummary[];
  machines: MachineSummary[];
  /**
   * Ámbito de la misión (trabajo | proyectos | personal). En el hito 1 no filtra candidatos:
   * se acepta para que el contrato del BFF no cambie cuando el catálogo declare ámbitos.
   */
  scope?: string;
}

export interface MatchCandidate {
  agentId: string;
  machineId: string;
  score: number;
  reasons: string[];
}

/**
 * Regla de asignación del hito 1 (docs/03-arquitectura.md §5, paso 2).
 *
 * Un par (agente, equipo) es candidato si cumple TODAS las capacidades requeridas:
 * `agent.platform ∈ cap.ejecutores`, `machine.id ∈ cap.equipos` y
 * (`agent.machineId` sin definir o igual a `machine.id`).
 *
 * Puntaje: +3 capacidad «probada», +2 «configurada», +1 otra; −3 si el equipo no está «online»;
 * −1 por cada trabajo pesado activo; +1 si el agente está «available».
 * Se EXCLUYEN los agentes paused|error|offline y cualquier requerida en estado «incompatible».
 * Orden: puntaje desc, trabajos pesados activos asc, nombre del agente.
 *
 * No lanza nunca: sin requisitos, con ids desconocidos o sin coincidencias devuelve [].
 */
export function matchCapabilities(required: string[], ctx: MatchContext): MatchCandidate[] {
  const ids = [...new Set((required ?? []).map((r) => String(r).trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const byId = new Map((ctx.capabilities ?? []).map((c) => [c.id, c] as const));
  const caps: Capability[] = [];
  for (const id of ids) {
    const cap = byId.get(id);
    if (!cap) return []; // capacidad inexistente: nadie puede cumplirla
    if (cap.estado === 'incompatible') return []; // una requerida incompatible excluye a todos
    caps.push(cap);
  }

  const out: Array<MatchCandidate & { heavy: number; name: string }> = [];
  for (const agent of ctx.agents ?? []) {
    if (agent.state === 'paused' || agent.state === 'error' || agent.state === 'offline') continue; // excluidos
    if (!caps.every((c) => c.ejecutores.includes(agent.platform))) continue;
    for (const machine of ctx.machines ?? []) {
      if (agent.machineId !== undefined && agent.machineId !== machine.id) continue;
      if (!caps.every((c) => c.equipos.includes(machine.id))) continue;

      let score = 0;
      const reasons: string[] = [];
      for (const c of caps) {
        const pts = c.estado === 'probada' ? 3 : c.estado === 'configurada' ? 2 : 1;
        score += pts;
        reasons.push(`Capacidad «${c.id}» en estado ${c.estado}: +${pts}.`);
      }
      if (machine.status !== 'online') {
        score -= 3;
        reasons.push(`El equipo «${machine.id}» no está en línea (estado ${machine.status}): −3.`);
      }
      const heavy = machine.activeHeavyJobs ?? 0;
      if (heavy > 0) {
        score -= heavy;
        reasons.push(`El equipo «${machine.id}» tiene ${heavy} trabajo(s) pesado(s) activo(s): −${heavy}.`);
      }
      if (agent.state === 'available') {
        score += 1;
        reasons.push(`El agente «${agent.name}» está disponible: +1.`);
      }
      out.push({ agentId: agent.id, machineId: machine.id, score, reasons, heavy, name: agent.name });
    }
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.heavy - b.heavy ||
      a.name.localeCompare(b.name, 'es') ||
      a.agentId.localeCompare(b.agentId) ||
      a.machineId.localeCompare(b.machineId),
  );
  return out.map(({ agentId, machineId, score, reasons }) => ({ agentId, machineId, score, reasons }));
}

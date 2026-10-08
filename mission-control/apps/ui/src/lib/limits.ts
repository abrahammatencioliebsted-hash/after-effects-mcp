// Topes por agente: mínimos reales que aplica el BFF (descarta lo que no los cumple y conserva el valor anterior).
export type LimitKey = 'maxDailyRuns' | 'maxDailyCostCents' | 'maxConcurrentRuns' | 'timeoutSec';

export interface LimitSpec { key: LimitKey; label: string; min: number; max?: number; hint: string }

export const AGENT_LIMITS: readonly LimitSpec[] = [
  { key: 'maxDailyRuns', label: 'Runs por día', min: 1, hint: 'mínimo 1' },
  { key: 'maxDailyCostCents', label: 'Coste diario (centavos)', min: 0, hint: 'mínimo 0' },
  { key: 'maxConcurrentRuns', label: 'Runs simultáneos', min: 1, max: 8, hint: 'entre 1 y 8' },
  { key: 'timeoutSec', label: 'Tiempo máximo por run (s)', min: 10, hint: 'mínimo 10 s' },
];

export type AgentLimits = Partial<Record<LimitKey, number>>;

/** Entero dentro del rango del tope (NaN o vacío -> el mínimo). */
export function clampLimit(spec: LimitSpec, value: number): number {
  const v = Number.isFinite(value) ? Math.floor(value) : spec.min;
  return Math.min(spec.max ?? Infinity, Math.max(spec.min, v));
}

/** Valor mostrado/enviado: el del borrador, o el mínimo si falta. */
export function limitValue(spec: LimitSpec, limits: AgentLimits | undefined): number {
  const v = limits?.[spec.key];
  return typeof v === 'number' && Number.isFinite(v) ? v : spec.min;
}

/** Aviso en español si el valor está por debajo del mínimo (o por encima del máximo); si es válido, `undefined`. */
export function limitWarning(spec: LimitSpec, value: number): string | undefined {
  if (!Number.isFinite(value) || value < spec.min) return `El mínimo es ${spec.min}: el BFF ignora valores menores y conserva el anterior.`;
  if (spec.max !== undefined && value > spec.max) return `El máximo es ${spec.max}.`;
  return undefined;
}

/** Los cuatro topes completos y válidos, listos para enviar al BFF. */
export function completeLimits(limits: AgentLimits | undefined): Record<LimitKey, number> {
  const out = {} as Record<LimitKey, number>;
  for (const spec of AGENT_LIMITS) out[spec.key] = clampLimit(spec, limitValue(spec, limits));
  return out;
}

export function limitsInvalid(limits: AgentLimits | undefined): boolean {
  return AGENT_LIMITS.some((spec) => limitWarning(spec, limitValue(spec, limits)) !== undefined);
}

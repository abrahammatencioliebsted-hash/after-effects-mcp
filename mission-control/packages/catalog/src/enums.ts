import type {
  CapabilityState,
  CapabilityType,
  CompatibilityState,
  ConsumptionClass,
  Capability,
  Platform,
} from '@mc/contracts';

/** Comprobación en tiempo de compilación: la lista cubre exactamente la unión del contrato. */
type Exact<T, U extends readonly T[]> = [T] extends [U[number]] ? U : never;

export const CAPABILITY_TYPES = [
  'skill',
  'mcp',
  'plugin',
  'api',
  'conector',
  'herramienta-local',
  'navegador',
  'automatizacion',
  'modelo',
] as const satisfies readonly CapabilityType[];
export const CAPABILITY_STATES = [
  'descubierta',
  'configurada',
  'probada',
  'pendiente',
  'incompatible',
] as const satisfies readonly CapabilityState[];
export const CONSUMPTION_CLASSES = [
  'local',
  'suscripcion',
  'api-facturada',
  'sin-modelo',
] as const satisfies readonly ConsumptionClass[];
export const COMPATIBILITY_STATES = ['NC', 'FV', 'VL', 'PF'] as const satisfies readonly CompatibilityState[];
export const PLATFORMS = ['hermes', 'claude', 'codex', 'grok', 'mimo', 'operador'] as const satisfies readonly Platform[];
export const CONTEXT_LEVELS = ['A', 'B', 'C'] as const;
export const PROVENANCE = ['C', 'H', 'P', 'F', 'I', 'Pr'] as const satisfies readonly Capability['procedencia'][];
export const PAPERCLIP_REF_KINDS = ['skill', 'mcp', 'plugin'] as const;

// Si el contrato añade un valor, estas líneas dejan de compilar y avisan que hay que actualizar la lista.
type _ExactChecks = [
  Exact<CapabilityType, typeof CAPABILITY_TYPES>,
  Exact<CapabilityState, typeof CAPABILITY_STATES>,
  Exact<ConsumptionClass, typeof CONSUMPTION_CLASSES>,
  Exact<CompatibilityState, typeof COMPATIBILITY_STATES>,
  Exact<Platform, typeof PLATFORMS>,
  Exact<Capability['procedencia'], typeof PROVENANCE>,
];

/** Versión del formato YAML del catálogo. */
export const CATALOG_SCHEMA_VERSION = '1.0.0';

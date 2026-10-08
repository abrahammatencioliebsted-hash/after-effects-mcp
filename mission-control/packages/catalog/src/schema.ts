import {
  CAPABILITY_STATES,
  CAPABILITY_TYPES,
  CATALOG_SCHEMA_VERSION,
  COMPATIBILITY_STATES,
  CONSUMPTION_CLASSES,
  CONTEXT_LEVELS,
  PAPERCLIP_REF_KINDS,
  PLATFORMS,
  PROVENANCE,
} from './enums.js';

const stringList = (description: string) => ({
  type: 'array',
  description,
  items: { type: 'string', minLength: 1 },
});

const capability = {
  type: 'object',
  description: 'Una capacidad del catálogo de Mission Control (equivale al tipo `Capability` de @mc/contracts).',
  required: [
    'id', 'nombre', 'tipo', 'que_hace', 'necesita', 'ejecutores', 'equipos', 'contexto',
    'permisos', 'consumo', 'estado', 'compatibilidad', 'evidencia', 'procedencia',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', description: 'Identificador único en kebab-case.' },
    nombre: { type: 'string', minLength: 1, description: 'Nombre legible.' },
    tipo: { enum: [...CAPABILITY_TYPES], description: 'Clase de capacidad.' },
    que_hace: { type: 'string', minLength: 1, description: 'Qué hace, en una o dos frases (incluye avisos y riesgos).' },
    necesita: stringList('Requisitos previos (cuentas, programas, conexiones, otras capacidades).'),
    ejecutores: {
      type: 'array',
      description: 'Plataformas que pueden ejecutarla.',
      items: { enum: [...PLATFORMS] },
    },
    equipos: stringList('Ids de equipos donde está disponible (win-principal, win-laptop-1, win-laptop-2, mac, nube...).'),
    contexto: {
      type: 'array',
      description: 'Niveles de contexto: A común breve, B proyecto, C tarea.',
      items: { enum: [...CONTEXT_LEVELS] },
    },
    permisos: {
      type: 'object',
      required: ['lectura', 'escritura'],
      additionalProperties: false,
      properties: {
        lectura: stringList('Qué lee.'),
        escritura: stringList('Qué escribe o modifica.'),
      },
    },
    consumo: { enum: [...CONSUMPTION_CLASSES], description: 'De dónde sale el gasto al usarla.' },
    estado: {
      enum: [...CAPABILITY_STATES],
      description: '«probada» solo con evidencia fechada; «pendiente» = aún no comprobada en este contexto.',
    },
    compatibilidad: {
      type: 'object',
      description: 'Estado NC/FV/VL/PF por plataforma.',
      propertyNames: { enum: [...PLATFORMS] },
      additionalProperties: { enum: [...COMPATIBILITY_STATES] },
    },
    evidencia: {
      type: 'array',
      description: 'Pruebas fechadas. Vacía si no hay ninguna.',
      items: {
        type: 'object',
        required: ['fecha', 'donde', 'resultado'],
        additionalProperties: false,
        properties: {
          fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'AAAA-MM-DD.' },
          donde: { type: 'string', minLength: 1, description: 'Id de equipo, «nube» o «documentacion».' },
          resultado: { type: 'string', minLength: 1 },
          referencia: { type: 'string', description: 'Ruta o URL de la prueba o fuente.' },
        },
      },
    },
    version: { type: 'string' },
    fuente: { type: 'string', description: 'Ruta en Obsidian o URL de la documentación.' },
    procedencia: { enum: [...PROVENANCE], description: 'C confirmado · H comprobado · P plan histórico · F fuente externa · I inferencia · Pr propuesta.' },
    paperclipRef: {
      type: 'object',
      required: ['kind', 'id'],
      additionalProperties: false,
      properties: { kind: { enum: [...PAPERCLIP_REF_KINDS] }, id: { type: 'string', minLength: 1 } },
    },
    hermesRef: { type: 'string' },
  },
} as const;

/** JSON Schema (2020-12) del formato YAML del catálogo, para personas y editores. */
export const catalogSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mission-control.local/schema/capability.schema.json',
  title: 'Catálogo de capacidades de Mission Control',
  description: `Formato del catálogo (versión ${CATALOG_SCHEMA_VERSION}). Un archivo YAML contiene una capacidad, una lista de capacidades, o un objeto con la clave «capabilities».`,
  $defs: { capability },
  oneOf: [
    { $ref: '#/$defs/capability' },
    { type: 'array', items: { $ref: '#/$defs/capability' } },
    {
      type: 'object',
      required: ['capabilities'],
      additionalProperties: false,
      properties: { capabilities: { type: 'array', items: { $ref: '#/$defs/capability' } } },
    },
  ],
  'x-catalog-schema-version': CATALOG_SCHEMA_VERSION,
} as const;

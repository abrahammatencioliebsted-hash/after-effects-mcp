// Roles prediseñados para el asistente de "añadir agente" (el video los "hornea" en el panel; aquí son editables).
import type { Platform } from '@mc/contracts';

export interface RolePreset {
  id: string;
  name: string;
  shortName: string;
  role: string;
  icon: string;
  platform: Platform;
  instructions: string;
}

export const ROLE_PRESETS: RolePreset[] = [
  { id: 'investigador', name: 'Investigador', shortName: 'Research', role: 'Investigación con fuentes en vivo', icon: 'search', platform: 'hermes', instructions: 'Investiga con fuentes verificables, cita cada afirmación y nunca inventes datos.' },
  { id: 'redactor', name: 'Redactor', shortName: 'Contenido', role: 'Redacción de informes y artículos', icon: 'edit', platform: 'hermes', instructions: 'Redacta con claridad. Los textos largos van al módulo Docs, no al chat.' },
  { id: 'desarrollador', name: 'Desarrollador', shortName: 'Código', role: 'Software y revisión de código', icon: 'terminal', platform: 'codex', instructions: 'Trabaja en ramas, explica los cambios y no ejecutes comandos destructivos.' },
  { id: 'datos', name: 'Analista de datos', shortName: 'Datos', role: 'Limpieza, análisis y gráficas', icon: 'chart', platform: 'claude', instructions: 'Documenta supuestos y fuentes de cada cifra.' },
  { id: 'disenador', name: 'Diseñador', shortName: 'Diseño', role: 'Piezas visuales y maquetación', icon: 'sparkle', platform: 'claude', instructions: 'Propón variantes y justifica las decisiones de diseño.' },
  { id: 'pm', name: 'Gestor de proyectos', shortName: 'Project', role: 'Planificación y seguimiento', icon: 'clipboard', platform: 'hermes', instructions: 'Divide el trabajo en pasos con responsables y plazos.' },
  { id: 'marketing', name: 'Marketing', shortName: 'Marketing', role: 'Campañas y mensajes', icon: 'bolt', platform: 'hermes', instructions: 'Adapta el tono al público y cuida la marca.' },
  { id: 'seo', name: 'Especialista SEO', shortName: 'SEO', role: 'Posicionamiento y palabras clave', icon: 'target', platform: 'hermes', instructions: 'Basa las recomendaciones en datos de búsqueda reales.' },
  { id: 'finanzas', name: 'Finanzas', shortName: 'Finanzas', role: 'Presupuestos y control de gasto', icon: 'layers', platform: 'hermes', instructions: 'Muestra los cálculos y marca la incertidumbre.' },
  { id: 'custom', name: 'Personalizado', shortName: '', role: '', icon: 'user', platform: 'hermes', instructions: '' },
];

/** Nombre corto sugerido a partir del nombre completo. */
export function suggestShortName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.slice(0, 14);
}

// Temas, layouts y tipografía. Se guardan en localStorage (siempre con try/catch) y se aplican como
// atributos data-* en <html>; todos los colores viven en variables CSS (styles/themes.css).

export type ThemeId = 'ambar' | 'azul' | 'propio';
export type SchemePref = 'dark' | 'light' | 'auto';
export type Scheme = 'dark' | 'light';
export type LayoutId = 'rail-full' | 'rail-icon' | 'bottom-deck' | 'top';
export type TypographyId = 'sistema' | 'humanista' | 'tecnica' | 'editorial';
export type TextSize = 'sm' | 'md' | 'lg';

export interface CustomTheme {
  accent: string;
  bg: string;
  ink: string;
}

export interface LocalSettings {
  theme: ThemeId;
  scheme: SchemePref;
  layout: LayoutId;
  typography: TypographyId;
  textSize: TextSize;
  custom: CustomTheme;
}

export const STORAGE_KEY = 'mc.ui.settings.v1';

export const THEMES: Array<{ id: ThemeId; label: string; hint: string; swatch: string }> = [
  { id: 'ambar', label: 'Ámbar', hint: 'Por defecto: cabina oscura con acento ámbar', swatch: '#ffb020' },
  { id: 'azul', label: 'Azul', hint: 'Acento azul, ideal para trabajo prolongado', swatch: '#4c9aff' },
  { id: 'propio', label: 'Propio', hint: 'Tres colores de tu identidad', swatch: '#8b5cf6' },
];

export const LAYOUTS: Array<{ id: LayoutId; label: string; hint: string }> = [
  { id: 'rail-full', label: 'Riel completo', hint: 'Navegación lateral con etiquetas' },
  { id: 'rail-icon', label: 'Riel de iconos', hint: 'Lateral compacto, más espacio de trabajo' },
  { id: 'bottom-deck', label: 'Cubierta inferior', hint: 'Barra inferior, pensada para pantallas medianas' },
  { id: 'top', label: 'Superior', hint: 'Navegación horizontal bajo la cabecera' },
];

export const TYPOGRAPHY: Array<{ id: TypographyId; label: string; hint: string; stack: string }> = [
  { id: 'sistema', label: 'Sistema', hint: 'Tipografía nativa del equipo', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'humanista', label: 'Humanista', hint: 'Cálida y abierta', stack: '"Segoe UI Variable", "Gill Sans", "Gill Sans MT", Candara, "Trebuchet MS", sans-serif' },
  { id: 'tecnica', label: 'Técnica', hint: 'Monoespaciada, estilo terminal', stack: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace' },
  { id: 'editorial', label: 'Editorial', hint: 'Serif de lectura', stack: 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif' },
];

export const TEXT_SIZES: Array<{ id: TextSize; label: string; px: number }> = [
  { id: 'sm', label: 'Compacto', px: 14 },
  { id: 'md', label: 'Normal', px: 15 },
  { id: 'lg', label: 'Amplio', px: 16.5 },
];

export const DEFAULT_CUSTOM: CustomTheme = { accent: '#8b5cf6', bg: '#0f1014', ink: '#ececf1' };

export const DEFAULT_SETTINGS: LocalSettings = {
  theme: 'ambar',
  scheme: 'dark',
  layout: 'rail-full',
  typography: 'sistema',
  textSize: 'md',
  custom: DEFAULT_CUSTOM,
};

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Valida y completa ajustes locales de origen desconocido (localStorage o archivo importado). */
export function sanitizeLocalSettings(input: unknown): LocalSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const c = (o.custom && typeof o.custom === 'object' ? o.custom : {}) as Record<string, unknown>;
  return {
    theme: oneOf(o.theme, THEMES.map((t) => t.id), DEFAULT_SETTINGS.theme),
    scheme: oneOf(o.scheme, ['dark', 'light', 'auto'] as const, DEFAULT_SETTINGS.scheme),
    layout: oneOf(o.layout, LAYOUTS.map((l) => l.id), DEFAULT_SETTINGS.layout),
    typography: oneOf(o.typography, TYPOGRAPHY.map((t) => t.id), DEFAULT_SETTINGS.typography),
    textSize: oneOf(o.textSize, TEXT_SIZES.map((t) => t.id), DEFAULT_SETTINGS.textSize),
    custom: {
      accent: isHexColor(c.accent) ? c.accent : DEFAULT_CUSTOM.accent,
      bg: isHexColor(c.bg) ? c.bg : DEFAULT_CUSTOM.bg,
      ink: isHexColor(c.ink) ? c.ink : DEFAULT_CUSTOM.ink,
    },
  };
}

export function loadLocalSettings(storage?: Pick<Storage, 'getItem'>): LocalSettings {
  try {
    const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = st?.getItem(STORAGE_KEY);
    return raw ? sanitizeLocalSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLocalSettings(s: LocalSettings, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!st) return false;
    st.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function resolveScheme(pref: SchemePref, prefersLight: boolean): Scheme {
  if (pref === 'auto') return prefersLight ? 'light' : 'dark';
  return pref;
}

/** Atributos data-* y variables que se aplican a <html>. */
export function themeAttributes(s: LocalSettings, prefersLight: boolean): { attrs: Record<string, string>; vars: Record<string, string> } {
  // En el tema "propio" el esquema (claro/oscuro) se deduce de la luminancia del fondo elegido.
  const scheme: Scheme = s.theme === 'propio' ? (relativeLuminance(s.custom.bg) > 0.4 ? 'light' : 'dark') : resolveScheme(s.scheme, prefersLight);
  return {
    attrs: {
      'data-theme': s.theme,
      'data-scheme': scheme,
      'data-layout': s.layout,
      'data-type': s.typography,
      'data-size': s.textSize,
    },
    vars: {
      '--c-accent': s.custom.accent,
      '--c-bg': s.custom.bg,
      '--c-ink': s.custom.ink,
      '--c-accent-ink': readableOn(s.custom.accent),
    },
  };
}

/** true si el esquema efectivo es oscuro, derivado del estado (no del DOM, que se actualiza después del render). */
export function isDarkScheme(s: LocalSettings, prefersLight: boolean): boolean {
  return themeAttributes(s, prefersLight).attrs['data-scheme'] !== 'light';
}

export function applyTheme(s: LocalSettings, root?: HTMLElement): void {
  try {
    const el = root ?? document.documentElement;
    const prefersLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    const { attrs, vars } = themeAttributes(s, prefersLight);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  } catch {
    /* sin DOM (pruebas) */
  }
}

// --- color ---------------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores hex. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Tinta (negra o blanca) legible sobre un fondo dado. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, '#111111') >= contrastRatio(bg, '#ffffff') ? '#111111' : '#ffffff';
}

export interface CustomThemeCheck {
  inkOnBg: number;
  accentOnBg: number;
  ok: boolean;
  messages: string[];
}

/** Comprueba que los tres colores propios sean legibles (texto 4.5:1, acento 3:1). */
export function checkCustomTheme(c: CustomTheme): CustomThemeCheck {
  const inkOnBg = contrastRatio(c.ink, c.bg);
  const accentOnBg = contrastRatio(c.accent, c.bg);
  const messages: string[] = [];
  if (inkOnBg < 4.5) messages.push(`El texto sobre el fondo tiene contraste ${inkOnBg.toFixed(1)}:1 (mínimo recomendado 4,5:1).`);
  if (accentOnBg < 3) messages.push(`El acento sobre el fondo tiene contraste ${accentOnBg.toFixed(1)}:1 (mínimo recomendado 3:1).`);
  return { inkOnBg, accentOnBg, ok: messages.length === 0, messages };
}

export function exportLocalSettings(s: LocalSettings): string {
  return JSON.stringify({ kind: 'mission-control/ajustes-locales', version: 1, settings: s }, null, 2);
}

export function importLocalSettings(text: string): LocalSettings {
  const parsed = JSON.parse(text) as unknown;
  const inner = parsed && typeof parsed === 'object' && 'settings' in parsed ? (parsed as { settings: unknown }).settings : parsed;
  return sanitizeLocalSettings(inner);
}

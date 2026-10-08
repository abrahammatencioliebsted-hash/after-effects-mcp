# Mission Control (hito 1)

Panel personal para coordinar tareas, contexto y herramientas entre **Hermes, Claude, Codex, Grok y MiMo** en tres Windows y una Mac, construido **sobre Paperclip** (plano de control mantenido) en lugar de reinventar orquestación, persistencia, reintentos, secretos y aprobaciones.

> Estado honesto: lo que aquí se llama **probado** se ejecutó en el entorno Cloud (Linux, un solo equipo, modelo **simulado** detrás de Hermes) y está registrado con fecha en `docs/06-evidencias.md`. Nada se ha instalado todavía en tus equipos. Tabla completa en `docs/02-componentes-y-estado.md`.

## Qué hay

| Carpeta | Qué es | Estado |
| --- | --- | --- |
| `docs/` | Contexto vigente, componentes y estado, arquitectura, runbooks, etapas y encargos, evidencias, decisiones, continuidad | ver cada archivo |
| `packages/contracts` | Tipos compartidos (misiones, agentes, máquinas, catálogo, eventos) | probado (typecheck) |
| `packages/catalog` | Catálogo de capacidades en YAML + validador + regla de asignación | ver su README |
| `packages/hermes-mock` | Doble del API server de Hermes con inyección de fallos (**simulación**) | ver su README |
| `packages/paperclip-client` | Cliente tipado de la API de Paperclip | ver su README |
| `apps/bff` | API `/api/mc/*` con backends `paperclip` (real) y `demo` (simulado, etiquetado) | ver su README |
| `apps/ui` | Panel estilo cockpit (ámbar) con Cockpit, Misiones, Agentes/Ciudad, Docs, Schedule, Salud, Catálogo, Ideas, Ajustes | ver su README |
| `apps/node-agent` | Servicio por equipo: salud, estado de Hermes, comandos con lista permitida | probado aquí (Linux) |
| `scripts/` | Instalar, actualizar, respaldar y restaurar (PowerShell y bash) | ver `scripts/README.md` |
| `lab/` | Reproducir el recorrido real en un solo equipo (`lab/e2e.mjs`) | probado aquí: 16/16 |

## Empezar a leer

1. `docs/CONTINUIDAD.md` — dónde quedamos, qué cambió, qué sigue, cómo sabremos que terminó.
2. `docs/00-contexto-vigente.md` — contexto breve y fuentes que faltan.
3. `docs/03-arquitectura.md` — decisiones de diseño y el hallazgo sobre Windows (Paperclip va en WSL2).
4. `docs/05-etapas-y-encargos.md` — qué modelo, esfuerzo y encargo usar en cada etapa.
5. `docs/06-evidencias.md` — qué se ejecutó de verdad y qué no demuestra.

## Correr el panel con datos simulados (sin Paperclip)

```sh
corepack enable && pnpm install
pnpm --filter @mc/contracts build && pnpm --filter @mc/ui build
MC_BACKEND=demo pnpm --filter @mc/bff start      # http://127.0.0.1:3300 (banda "DATOS SIMULADOS")
```

## Correr el panel contra Paperclip real

Requiere Paperclip ≥ 2026.1005.0 corriendo (`docs/04-runbooks/`), Node ≥ 24.11:

```sh
MC_BACKEND=paperclip MC_PAPERCLIP_URL=http://127.0.0.1:3100 MC_NODE_AGENT_TOKEN=<token> pnpm --filter @mc/bff start
```

## Reglas del proyecto

- Credenciales nunca en el repositorio; se referencian por id de secreto de Paperclip o por variables de entorno locales.
- Todo lo simulado se etiqueta como tal en pantalla y en los documentos.
- El rebote recurrente de ideas vive en Codex; Mission Control solo lee el Registro de elecciones.
- Trabajo, proyectos y contexto personal se mantienen separados; `Privado/` nunca se lee.

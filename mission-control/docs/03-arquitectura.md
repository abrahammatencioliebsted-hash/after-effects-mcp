---
tipo: diseño
proyecto: Mission Control
revisado: 2026-10-08
estado: "Base (Paperclip + Hermes) tomada del plan que compartiste el 8 oct 2026 ~01:28 CDMX [C] y comprobada en Cloud ~02:10 CDMX [H]; el resto del diseño está marcado [Pr] y espera tu confirmación"
---

# Arquitectura de Mission Control

Claves: **[C]** confirmado por ti · **[H]** comprobado en este entorno Cloud · **[F]** fuente externa/documentación · **[I]** inferencia · **[Pr]** propuesta sin aprobar.

## 1. Decisión central

**Paperclip es el plano de control; Mission Control es el panel, el catálogo y el pegamento entre tus equipos.** No reescribimos orquestación, persistencia, reintentos, secretos ni aprobaciones: Paperclip (npm `paperclipai`, MIT, versión 2026.1005.0, commits diarios) ya los trae y los comprobamos aquí **[H]** (ver `06-evidencias.md`). Lo que construimos nosotros es lo que Paperclip no tiene y tú pediste: un panel estilo NEXORA, un catálogo de capacidades por equipo, un agente ligero por computadora y los adaptadores de entrada (Slack, Registro de elecciones, Obsidian).

Razones **[I]**: reutilizar componentes mantenidos **[C]**; el adaptador `hermes_gateway` existe en la versión publicada y funciona de punta a punta **[H]**; Paperclip registra ejecutor, tokens, errores y actividad por tarea **[H]**; su vigilante corta los reintentos (2/2) y escala al humano **[H]**.

Alternativas descartadas por ahora: (A) ampliar la app de escritorio de Hermes como panel: ata todo a Hermes y no cubre Claude/Codex/Grok como ejecutores de primera clase; (B) construir orquestador propio desde cero: contradice "reutilizar componentes mantenidos" y no cabe en el crédito.

## 2. Vista general

```
   Tú (Slack · navegador · Obsidian)                 Codex (rebote de ideas, fuera de MC)
         │                                                   │  escribe Registro de elecciones
         ▼                                                   ▼
┌─────────────────────────── Windows principal (96 GB / 24 GB VRAM) ───────────────────────────┐
│  Mission Control UI (React) ─► BFF (Node 24, Hono) ─► Paperclip API (127.0.0.1:3100, local)  │
│        ▲  SSE                    │  ├─ Catálogo de capacidades (YAML validado)                │
│        │                         │  ├─ Registro de máquinas (latidos de node-agent)           │
│        │                         │  └─ Lector del Registro de elecciones (solo lectura)       │
│  node-agent (salud, Hermes, comandos permitidos)    Hermes API server (127.0.0.1:8642)        │
│  Modelos locales opcionales (Ollama)  ◄── Hermes provider custom                              │
└──────────────────────────────┬────────────────── Tailscale (red privada) ─────────────────────┘
                               │ HTTPS (tailscale serve) · claves por equipo
      ┌────────────────────────┼────────────────────────┬──────────────────────────┐
      ▼                        ▼                        ▼                          ▼
 Windows laptop 1         Windows laptop 2             Mac                     Nube (opcional)
 Hermes API server        Hermes API server            Hermes API server       Claude Code Cloud
 node-agent               node-agent                   node-agent · Obsidian   (construcción)
 adapt.: hermes_gateway   adapt.: hermes_gateway       adapt.: hermes_gateway
```

Ejecutores por plataforma (adaptadores de Paperclip, todos integrados en la versión publicada **[H]**): Hermes → `hermes_gateway` (remoto, por equipo) y `hermes_local` (mismo equipo que Paperclip); Claude → `claude_local` (CLI de Claude Code en la Windows principal, inicio de sesión por suscripción o clave); Codex → `codex_local`; Grok → `grok_local` (4 modelos listados) **[H]**; MiMo → **sin adaptador propio**: se usa como modelo dentro de Hermes (`model.provider: custom`, `base_url` de Token Plan) **[H, F]** o vía conexión OpenAI-compatible; MiMo Desktop queda fuera (puente MCP desde Codex, sin comprobar aquí) **[P]**.

## 3. Componentes que construimos

| Componente | Carpeta | Responsabilidad | Modelo recomendado para construirlo |
| --- | --- | --- | --- |
| Contratos | `packages/contracts` | Tipos TypeScript y esquemas JSON compartidos por UI, BFF, node-agent y catálogo | Fable (diseño) |
| Catálogo | `packages/catalog` | Esquema YAML, validador CLI, semilla con procedimientos P1–P5 y plataformas; estados descubierta/configurada/probada/pendiente con evidencia | Sonnet · Alto |
| Hermes mock | `packages/hermes-mock` | Servidor que imita el contrato real del API server de Hermes (`/health`, `/v1/capabilities`, `POST /v1/runs` con Idempotency-Key, `GET /v1/runs/{id}`, `/events` SSE, stop) con **inyección de fallos** (corte de SSE, duplicado, timeout) para pruebas de integración | Sonnet · Alto |
| Cliente Paperclip | `packages/paperclip-client` | Cliente tipado mínimo de las rutas que usamos (companies, agents, issues, comments, heartbeat-runs, approvals, routines, costs, activity, dashboard, secrets) | Sonnet · Alto |
| BFF | `apps/bff` | API `/api/mc/*` para la UI; dos backends con la misma forma: `paperclip` (real) y `demo` (simulado, etiquetado); SSE de cambios; registro de máquinas; catálogo; lector de elecciones | Sonnet · Alto |
| UI | `apps/ui` | Panel estilo NEXORA: Cockpit, Misiones (lanzar, aprobar plan, hilo en vivo, kanban Briefing/Ongoing/Review/Delivered, replay), Agentes/Ciudad, Docs, Schedule, Salud, Catálogo, Ideas, Ajustes (temas ámbar/azul/propio, layouts, tipografía, modelos) | Sonnet · Alto |
| node-agent | `apps/node-agent` | Servicio por equipo: CPU/RAM/disco/GPU, estado del API server de Hermes, comandos rápidos con lista permitida, latido al BFF con token | Sonnet · Alto |
| Scripts | `scripts/` | Instalar, actualizar, respaldar y restaurar (PowerShell y bash), envolviendo `paperclipai` y `hermes` | Sonnet · Medio |
| Laboratorio | `lab/` | Reproducción del recorrido en un solo equipo: modelo simulado, HERMES_HOME de prueba, e2e | Sonnet · Alto |
| Pruebas | `tests/` | Integración (recorrido completo contra Paperclip + mock) y fallos principales (duplicado, corte, reinicio, timeout, presupuesto) | Sonnet · Alto |

## 4. Modelo de datos (proyección sobre Paperclip)

| Concepto MC | En Paperclip | Notas |
| --- | --- | --- |
| **Misión** | `issue` (padre) con `reviewPolicy: human_only` cuando pides revisión previa; subtareas = issues hijas (`parentId`) | Estados MC: Briefing = `todo`/`backlog` con plan pendiente · Ongoing = `in_progress` · Review = `in_review` · Delivered = `done` · Bloqueada = `blocked` · Cancelada = `cancelled` |
| **Plan y aprobación** | `approvals` (aprobar/rechazar/pedir revisión) o, en el hito 1, comentario del coordinador + aprobación del operador | Con agente jefe real, el plan lo escribe el agente; sin él, lo propone la regla del catálogo **[Pr]** |
| **Mensajes entre agentes** | `issue comments` (`authorType: agent`) y actividad | Es la vista "qué se dicen los agentes" del video |
| **Ejecución** | `heartbeat run` (status, usageJson con tokens, error, adapter.invoke, logs) | El BFF fusiona runs + comentarios + actividad en una línea de tiempo con replay |
| **Agente** | `agent` (adapterType, adapterConfig, budgetMonthlyCents, permissions, reportsTo) | Estado MC: working si hay run activo; available si idle; paused/error según Paperclip |
| **Equipo (máquina)** | No existe en Paperclip | Lo añade MC: tabla `machines` en el BFF (SQLite `node:sqlite`) alimentada por node-agent; un agente `hermes_gateway` por equipo lleva `metadata.machineId` |
| **Capacidad** | Skills de Paperclip (`company skills`), MCP y plugins existen, pero sin equipo, coste ni evidencia | Lo añade MC: catálogo YAML con `equipos[]`, `consumo`, `estado`, `evidencia` y referencia a la skill/MCP de Paperclip cuando exista |
| **Documento** | Documentos de la issue y adjuntos; comentarios largos del agente | MC los lista en Docs y permite escribir notas propias (guardadas en Paperclip como documento de la issue "Docs") |
| **Programación** | `routines` (crear, pausar, ejecutar ahora) | Cron de Hermes se muestra como solo lectura en el hito 1 |
| **Consumo** | `costs/by-agent`, `costs/by-agent-model`, `budgets`, `budget-incidents` | `hermes_gateway` informa tokens pero no modelo ni precio (**unpriced**) **[H]**: MC añade una tabla de precios por modelo configurable para estimar |
| **Ideas** | No existe | Lector de `Registro de elecciones.md` (solo lectura): ideas "sin decisión tuya" se muestran en Ideas, nunca se convierten en misiones solas **[C]** |

## 5. Flujo del recorrido (comprobado aquí con modelo simulado) **[H]**

1. **Solicitud**: la UI/BFF crea la issue con objetivo, prioridad, fecha objetivo, límites (minutos, pasos, longitud del informe) y política de revisión.
2. **Asignación**: equipo manual (agentes elegidos) o "agente jefe" (si existe un coordinador con modelo real) o **regla del catálogo** (hito 1): capacidad requerida → ejecutores compatibles → equipo disponible con menor carga.
3. **Ejecución**: Paperclip despierta al agente en cuanto se asigna; el adaptador llama `POST /v1/runs` del Hermes del equipo con clave propia y `X-Hermes-Session-Key` por tarea; el resultado vuelve como comentario.
4. **Revisión**: con `human_only` nada se cierra sin ti; MC muestra el resultado y botones Aceptar / Pedir cambios / Reintentar.
5. **Resultado**: `done` con `completedAt`; el informe largo va a Docs, no al chat.

Fallos previstos y quién los cubre: duplicados → Idempotency-Key en Hermes (409 comprobado) y wake único por asignación en Paperclip; reintentos → tope 2 y escalado al tablero (comprobado); corte de SSE → `eventReconnectMs`; timeout → `timeoutSec` y stop; reinicio del servidor → recuperación de runs huérfanos al arrancar ("startup reap", comprobado en el log); presupuesto → `budgetMonthlyCents` por agente e incidentes de presupuesto (pendiente de prueba).

## 5b. Dónde corre Paperclip: hallazgo que cambia el plan **[H, por lectura del código y la documentación de Paperclip]**

Paperclip **no soporta Windows nativo** para la instalación gestionada ni como servicio: su documentación dice "macOS, Linux, or WSL2" y `paperclipai service` devuelve "no soportado" en win32 (detalle y citas en `04-runbooks/windows.md`). Hermes sí tiene instalador nativo para Windows y macOS.

**Acción principal [Pr]:** en la Windows principal, Paperclip corre dentro de **WSL2 (Ubuntu con systemd)** con la instalación gestionada oficial y servicio de usuario; Hermes y el node-agent corren nativos en Windows (o Hermes también dentro de WSL2 para que la conexión sea loopback). Mantiene la GPU y los modelos locales en el mismo equipo.
**Alternativa 1:** la **Mac** como plano de control (LaunchAgent soportado oficialmente) y las Windows solo como ejecutores Hermes. Menos fricción de red, pero carga tu puesto de trabajo.
**Alternativa 2:** Windows nativo con `npm i -g paperclipai@2026.1005.0` y una tarea programada. Funciona "a medias" según el código y **no está verificado**; solo para pruebas.

Consecuencias ya incorporadas: respaldo completo = volcado SQL + `secrets/master.key` + `decision-signing.key` + `.env` + `config.json` + adjuntos (Paperclip no trae `db:restore`; `scripts/common/restore-db.mjs` lo cubre); un Hermes remoto necesita HTTPS en la tailnet (`tailscale serve`); Paperclip debe pasar a modo `authenticated` + `bind tailnet` para que otros equipos lo alcancen; el presupuesto en centavos **no detecta** el consumo de `hermes_gateway` (llega sin precio), así que los topes son por número de runs diarios.

## 6. Red, seguridad y credenciales

- **Red privada**: Tailscale entre los cuatro equipos **[Pr]**. Paperclip trae `--bind tailnet` y un paquete `tailscale-https-broker` **[H, por inspección del repo]**; el adaptador exige HTTPS para gateways remotos (hay un interruptor inseguro solo para pruebas) **[H]**.
- **Credenciales**: nunca en el repositorio. Clave de API server de Hermes distinta por equipo, guardada como secreto cifrado de Paperclip (`secret_ref`) **[H]**; `.env` con permisos 600; token compartido BFF⇄node-agent; lista permitida de comandos en node-agent con confirmación en la UI.
- **Permisos por herramienta**: en Paperclip, `permissions`/`trustPreset` por agente y gobernanza de acceso MCP; en Hermes, `platform_toolsets` y `command_allowlist` del perfil que use MC. El catálogo registra qué permisos requiere cada capacidad.
- **Contexto personal**: Obsidian sigue siendo la fuente de estado; MC no copia `Privado/`. Trabajo, proyectos y contexto personal viven separados (empresas o proyectos distintos en Paperclip) **[C]**.

## 7. Qué es real, qué es simulado y qué queda pendiente (hito 1)

| Elemento | Estado |
| --- | --- |
| Paperclip + `hermes_gateway` + Hermes API server, recorrido completo | **Real, comprobado aquí** (Linux, un solo equipo) |
| Modelo detrás de Hermes | **Simulado** (stub determinista); con tu Token Plan de MiMo sería real |
| Revisión y cierre | Humano por API (comprobado); el agente moverá el estado cuando tenga modelo con herramientas |
| Panel MC, BFF, catálogo, node-agent, mock de Hermes | **Construidos en este hito**, probados contra Paperclip real y contra el mock aquí |
| Backend demo del panel | **Simulado y etiquetado** en pantalla |
| Windows/macOS, Tailscale, HTTPS, segundo equipo, Slack, Claude/Codex/Grok locales | **Pendientes de tus equipos y cuentas** (guías en `04-runbooks/`) |

## 8. Pila técnica y por qué

Node 24 LTS (lo exige Paperclip, así que no añadimos otra versión), TypeScript, Hono para el BFF (ligero, SSE sencillo), React 19 + Vite para la UI (misma base que la UI de Paperclip), CSS con variables (temas sin dependencias), `node:sqlite` para el estado propio del BFF (sin binarios nativos), YAML para el catálogo (legible en Obsidian), `node:test` para pruebas (sin dependencias). Python 3.14 + uv solo para Hermes (su requisito).

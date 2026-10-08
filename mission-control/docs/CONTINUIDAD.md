---
tipo: continuidad
proyecto: Mission Control
actualizado: 2026-10-08 ~09:55 UTC (~03:55 CDMX)
regla: "una sesión nueva debe poder retomar desde este archivo sin inventar; lo que no esté aquí o en 06-evidencias.md no está hecho"
---

# Continuidad — Mission Control, hito 1

## Dónde quedamos

El **hito 1 está cerrado en el entorno Cloud** (Linux, un solo equipo): base verificada, recorrido real completo, panel y componentes construidos y probados, runbooks escritos, restauración probada. **Nada está instalado en tus equipos** y nada se ha probado con un modelo real ni con red entre máquinas. Rama: `claude/mission-control-plan-zr0kvl` en `abrahammatencioliebsted-hash/after-effects-mcp`, carpeta `mission-control/`.

| Pieza | Estado | Dónde mirar |
| --- | --- | --- |
| Base Paperclip + `hermes_gateway` + Hermes API server | **Real, comprobada** (modelo simulado) | `docs/01-compatibilidad-paperclip-hermes.md`, `docs/06-evidencias.md` |
| Recorrido solicitud → asignación → ejecución → revisión → resultado | **Real**, manual (MIS-1) y por script (MIS-2, `lab/e2e.mjs` 16/16) y desde el BFF (MIS-17) | `docs/evidencias/e2e-*.md`, `06-evidencias.md` |
| Fallos principales con el adaptador real | 8/8 escenarios registrados (2 parciales: 429, reinicio del ejecutor) | `docs/evidencias/fallos-adaptador-mock.md` |
| Restauración completa | **Probada** entre dos instancias (8/8) | `docs/evidencias/restauracion-lab.md`, `scripts/README.md` |
| Paquetes y apps | contracts, catalog (23 capacidades), paperclip-client (16 + 15/15 en vivo), hermes-mock (26), bff (56 + 6 en vivo), ui (44 + capturas reales), node-agent (20), tests (9); **202 pruebas, 187 pasan, 15 omitidas (en vivo), 0 fallan** | `docs/02-componentes-y-estado.md` §6 |
| Runbooks Windows/macOS/segundo equipo/actualizar-restaurar | Redactados con citas; **no ejecutados en tus equipos** | `docs/04-runbooks/` |
| Revisión independiente | 5 de 6 dimensiones entregadas: 32 hallazgos, 30 corregidos en esta sesión | Sección "Revisión independiente" de abajo; `06-evidencias.md` 09:4x |

## Qué cambió respecto al plan original

1. **Paperclip no soporta Windows nativo** como servicio → propuesta: WSL2 en la Windows principal (alternativas: Mac como plano de control; Windows nativo sin soporte). Pendiente de tu confirmación (`07-decisiones.md`, P18 y `03-arquitectura.md` §5b).
2. **El presupuesto en centavos de Paperclip no ve el consumo de Hermes** (`unpriced`) → topes por número de runs diarios por agente y tabla de precios en Ajustes.
3. **Sin `db:restore` en Paperclip** → `scripts/common/restore-db.mjs` (probado). El respaldo completo incluye `master.key`, `decision-signing.key`, `.env`, `config.json` y adjuntos.
4. **Hermes remoto exige HTTPS** en la tailnet (`tailscale serve`); HTTP a una IP 100.x se deniega (comprobado).
5. **Fallos del ejecutor no se reintentan solos** (failed/401/429/reinicio): Mission Control debe detectar y re-despachar; el panel ya muestra `retryCount`, `errorCode` y escalados.
6. El reparto de modelos acordado: Fable 5.1 Alto para diseño y revisión; Sonnet 5.5 Alto para construir; Sonnet 5.5 Medio para documentación (`05-etapas-y-encargos.md`).
7. **La revisión independiente endureció el BFF** (`08-contrato-bff.md` reglas 8–10): `Host` conocido obligatorio, `Origin` del propio panel en mutaciones, JSON explícito, cuerpo ≤ 2 MiB, lista de destinos permitidos para la URL de Hermes de los latidos, `MC_HERMES_URL_<MACHINEID>` manda sobre el latido y `MC_LOCAL_MACHINE_ID` (= `win-principal`) es el único equipo cuyo Hermes puede ser loopback. Además: claves de idempotencia hacia Paperclip derivadas de la cabecera del cliente, "primero Paperclip y después SQLite" al aprobar/reintentar/detener, y el gasto mensual sale del agente de Paperclip (su API ignora `period`). Dos variables nuevas para E2: `MC_ALLOWED_HOSTS` (si abres el panel por un nombre que no sea localhost/IP/`*.ts.net`) y `MC_LOCAL_MACHINE_ID` (si Paperclip no corre en la Windows principal).

## Qué sigue (acción principal y alternativas)

**Acción principal: E2 — primer equipo real.** En tu Windows principal, seguir `docs/04-runbooks/windows.md` con Claude Code local (Sonnet 5.5 · Medio, confirmando cada comando): Paperclip en WSL2 como servicio, Hermes nativo con API server y tu proveedor (decidir MiMo Token Plan vs clave de pago: P06), node-agent, BFF + panel. Primer recorrido con **modelo real**: el agente debe mover la tarea a `in_review` él solo (hoy lo hace el operador porque el modelo es simulado).

**Alternativa 1:** empezar por la **Mac** (ruta soportada oficialmente) y dejar las Windows como ejecutores Hermes.
**Alternativa 2:** antes de instalar nada, una sesión Cloud corta (Sonnet · Alto) que pruebe `claude_local`/`codex_local` creando agentes reales en el laboratorio y cierre los dos límites documentados de la revisión (secretos de prueba y resincronización inicial del SSE).

Decisiones que solo tú puedes tomar antes de E2: dónde corre Paperclip (WSL2 / Mac / nativo), proveedor de modelo para Hermes en Mission Control (P06), qué equipo es el segundo del piloto, y si Mission Control sustituye a la nota "Panel de control" de Obsidian (P17). Lista completa en `07-decisiones.md` §3.

## Cómo sabremos que terminó (criterios del hito 2)

- Una tarea creada desde el panel en tu Windows principal se ejecuta en Hermes con modelo real y el **agente** la deja en `in_review` sin intervención.
- `scripts/common/backup-full.mjs` y la restauración funcionan en tu equipo (no solo aquí), con un secreto descifrado tras restaurar.
- El node-agent de la Windows principal aparece "online" en Salud con CPU/RAM/disco/GPU reales.
- Consumo visible: tokens por agente en el panel y, con la tabla de precios, una estimación en USD por misión.

## Retomar en cinco minutos (sesión Cloud)

```sh
export PATH=/opt/node24/bin:$PATH           # el contenedor trae Node 22; Paperclip exige >= 24.11
cd mission-control && pnpm install && pnpm -r build && pnpm -r test
MC_BACKEND=demo node apps/bff/dist/main.js  # panel con datos simulados en http://127.0.0.1:3300
```

Para el laboratorio real (Paperclip + Hermes + modelo simulado) sigue `lab/README.md`; el recorrido se verifica con `node lab/e2e.mjs`. En **esta** sesión quedaron corriendo: Paperclip en 127.0.0.1:3101 (datos en `/home/user/mc-lab/paperclip-data`, usuario `mc`), Hermes API server en 8642 (`HERMES_HOME=/home/user/mc-lab/hermes-home`), modelo simulado en 8700, BFF en 3300. El contenedor es efímero: nada de eso sobrevive; el repositorio sí.

## Consumo visible de esta sesión

- Contexto principal (Fable 5.1): ≈ 0,75 M tokens de contexto acumulado (aprox.; el contador de la sesión se reinició una vez).
- Subagentes y flujos de trabajo (Sonnet 5.5 y Fable 5.1): lectura/verificación ≈ 2,1 M; construcción de paquetes y apps ≈ 2,3 M; runbooks + restauración ≈ 0,47 M; revisión independiente (6 revisores Fable 5.1 + verificación) ≈ 4,3 M de transcripciones (aprox., medido por tamaño de los registros); corrección de la UI tras la revisión (Sonnet 5.5 Alto) ≈ 0,18 M; las correcciones del BFF, pruebas y documentación se hicieron en el contexto principal.
- El importe en dólares del crédito de sesiones Cloud **solo se ve en tu menú de Uso**; anótalo aquí al retomar: `gasto al cierre del hito 1: ___ USD (fecha)`.

## Reglas que esta sesión respetó y la siguiente debe mantener

- Nada se instala ni se activa en tus equipos sin tu autorización; el crédito Cloud no cubre sesiones locales.
- Lo simulado se etiqueta como tal (modelo stub, mock de Hermes, backend demo).
- El rebote de ideas vive en Codex; Mission Control solo lee `Registro de elecciones.md`.
- Credenciales fuera del repositorio; secretos de Paperclip por referencia (`secret_ref`).
- Ideas laterales a `docs/ideas-laterales.md`, nunca a tareas automáticamente.

## Revisión independiente (cerrada 2026-10-08 ~09:55 UTC)

Seis revisores independientes (Fable 5.1 · Alto, uno por dimensión, con acceso al código, al Paperclip vivo y a un BFF propio en puerto efímero) y una pasada de verificación adversarial por hallazgo. Cinco dimensiones entregaron informe; la de **reproducibilidad** (runbooks/scripts) no terminó antes del cierre y queda como pendiente de la siguiente sesión.

| Dimensión | Hallazgos (alto/medio/bajo) | Corregidos aquí | Abiertos |
| --- | --- | --- | --- |
| Seguridad | 4 (2/1/1): CSRF y Host sin validar; URL de Hermes del latido sin validar (SSRF + exfiltración de la clave); loopback del latido preferido a la URL del operador; cuerpo sin límite | 4 | — |
| Corrección del BFF | 5 (0/3/2): `period` ignorado por Paperclip; idempotencia parcial; demo con agente borrado → 500; ajustes desalineados; hijas sin runs en el detalle | 5 | — |
| Fiabilidad | 7 (1/3/3): aprobar/reintentar/detener escribían antes de confirmar con Paperclip; errores tragados al decidir; plan pendiente fantasma; backoff del latido; secretos de laboratorio acumulados | 6 | F7 (bajo): los secretos de prueba se acumulan; este build de Paperclip no expone `DELETE` de secretos → documentado en `tests/README.md` y `lab/e2e.mjs` acepta `HERMES_SECRET_ID` |
| UI | 9 (2/2/5): mapa de calor con día/hora equivocados; modo degradado solo en la primera carga; sin resincronizar tras SSE; topes con texto falso; alternador de tema; pestañas sin foco; paginación; errores de asistentes; clave de idempotencia | 9 (44/44 pruebas) | Límite residual (bajo): los eventos perdidos entre la primera carga y la primera conexión SSE no se resincronizan; las pestañas con flechas no tienen prueba automática |
| Pruebas | 7 (1/1/5): `pnpm test` fallaba en clon limpio; el informe de fallos pisaba la evidencia; evidencia desactualizada; aserción tautológica; misión en vivo sin limpiar; secreto e2e sin reutilizar; prueba del cliente atada a ids | 7 | — |
| Reproducibilidad | sin informe al cierre | — | Repetir en la siguiente sesión (Fable 5.1 · Alto, ~0,5 M) |

Todo lo corregido tiene prueba (`apps/bff/test/hardening.test.mjs`, pruebas nuevas de `apps/ui/test`, `node-agent.test.mjs`) y se volvió a ejecutar en vivo contra el Paperclip real (BFF 6/6, cliente 15/15) y contra un servidor real del BFF (códigos 400/403/413/415 literales en `06-evidencias.md`). Los informes completos de los revisores viven en el registro del flujo de trabajo de esta sesión (no en el repositorio); el resumen por hallazgo está en `06-evidencias.md` 09:4x.

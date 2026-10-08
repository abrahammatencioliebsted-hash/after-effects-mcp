---
tipo: contexto
proyecto: Mission Control
revisado: 2026-10-08 (redactado ~02:30 CDMX = 08:30 UTC)
vigencia: instrucciones actuales del usuario > planes antiguos de Obsidian
---

# Contexto vigente de Mission Control

**Marcas:** [C] confirmado por ti · [H] comprobado · [P] plan histórico · [F] fuente externa · [I] inferencia · [Pr] propuesta sin aprobar · [Doc] documentación oficial (solo en la verificación documental). **CDMX = UTC-6.** "Chat" = decisiones tuyas en esta sesión (8 oct 2026, horas aprox. CDMX).
**Abreviaturas de fuente:** `Plan` = Plan por etapas · `Reg.` = Registro de continuidad · `Verif. local/doc.` = Verificación local/documental de plataformas — 2026-10-08 · `Encargo` = Encargo original — 2026-10-07 · `Evid.` = `/home/user/mc-lab/evidence/00-registro-evidencias.md` · `HT` = `09-hechos-tecnicos.md` · `Arq.` = `03-arquitectura.md` · `Inv.` = inventario extraído del snapshot. Rutas de Obsidian relativas a `Sistema/Sistema de agentes/` salvo indicación.

## 1. Objetivo confirmado
| Qué | Fuente |
| --- | --- |
| Inicia Mission Control con plan: Paperclip + Hermes como base; **$250 de crédito de sesiones Cloud que vencen el 5 nov 2026, 01:59 CDMX**; 3 Windows + 1 Mac (principal: 96 GB RAM / 24 GB VRAM; otras: 16 GB) [C] | Chat ~01:28 |
| Primer hito: verificar Paperclip/Hermes Gateway, integración mínima reproducible, pruebas en Cloud, documentar piloto Windows/Mac y segundo equipo, distinguir real/simulado/pendiente, continuidad [C] | Chat ~01:28 |
| Prioridad "máxima calidad práctica": recorrido real solicitud→asignación→ejecución→revisión→resultado; tareas persistentes, recuperación tras reinicios, protección contra duplicados y reintentos infinitos, credenciales protegidas y permisos por herramienta, registro de ejecutor/modelo/consumo/errores, catálogo de skills/MCP/plugins, pruebas de integración y de fallos, revisión separada, instrucciones reproducibles de instalar/actualizar/restaurar; reutilizar componentes mantenidos; no marcar como probado lo no ejecutado [C] | Chat ~01:40 |
| Referencia de diseño (no prueba de compatibilidad): video "I Built a PREMIUM Mission Control for My 16 Hermes Agents" (NEXORA, Komputer Mechanic, 28 sep 2026); "lo más parecida y hasta más pulida" [C] | Chat ~01:45; `Uploads/Referencia video NEXORA — notas.md` |
| Reparto de modelos: Fable 5.1 Alto = arquitectura/decisiones difíciles; Sonnet 5.5 Alto = construir; Sonnet 5.5 Medio = documentación [C] | Chat ~01:50 |

## 2. Qué existe ya en Obsidian (Sistema de agentes E1–E5)
Snapshot puntual del 8 oct 2026, **01:56:39 CDMX** (`MANIFIESTO.json`, `snapshot_only: true`), sin acceso continuo ni sync con el Mac (`LEEME.txt`). Sus planes son evidencia histórica, no instrucciones nuevas (`LEEME.txt`).
| Etapa | Estado real según Reg./E5 | Fecha-hora (como consta) | Límite declarado |
| --- | --- | --- | --- |
| Org. del proyecto | Hecha: carpeta, encargo, plan, registro; E1–E5 programadas | 7 oct 22:55 y 23:30 (zona no consta) | Las tareas programadas corrieron sin la carpeta; [I] ninguna llegó a trabajar (Reg. 06:10 UTC) |
| E1 Diagnóstico | Hecha (la corrió la ejecución de E2) | 8 oct 06:40 (zona no consta) | Prioridades del 4 oct [C] sin fuente en la bóveda (E5 §4 #9) |
| E2 Arquitectura | Hecha; **A1 sin aprobar** | 8 oct 06:45 (zona no consta) | Roles, P1–P6, tres niveles: propuesta |
| E3 Piloto (ficha CTB) | Hecha en el chat; **A2 sin aprobar**; criterio (b) probado con ficha resumida | 8 oct 07:10 UTC | Una sola sesión hizo los 4 roles; ficha CTB con contradicción de alcance |
| Verificación local + documental | Hechas en el chat | 8 oct 07:10–07:35 UTC | Lectura sin credenciales de `~/.hermes`, `~/.codex`, `~/.grokbot`, `~/XiaomiMiMoProjects`; solo esa sesión |
| E4 | v1 Hecha 07:25 UTC (6 procedimientos, adaptadores; **ninguno pasa de FV**); reabierta a "Lista para correr — alcance ampliado" 07:30 UTC | 8 oct 07:25/07:30 UTC | Catálogo de herramientas **no consta** en el snapshot |
| E5 | **Parcial**, veredicto "aprueba con cambios" (hallazgo 0 + 12 correcciones propuestas, §4; sin aprobar) | 8 oct 07:32 UTC | Sin matriz, panel ni `Pruebas/`; nada en VL ni PF |
| E6 operación | Sin programar; espera A4 | — | — |
**Nada está "listo para usar" (PF)** [H] (E5 veredicto). No confundir con las etapas de Mission Control E0–E7 (`05-etapas-y-encargos.md`). Aprobaciones A1–A4 del Plan: todas sin marcar.

## 3. Qué es Mission Control y en qué se diferencia del "Panel de control" (mejora 7)
| | Mejora 7 "Panel de control" (Obsidian) | Mission Control (este repo) |
| --- | --- | --- |
| Qué es | Nota `Panel de control.md` en la bóveda, privada, a partir de registros y consulta; acciones de control solo con conexión probada (Encargo 01:03, mejora 7; Plan) | Aplicación (UI + BFF) sobre Paperclip: lanzar/aprobar/reintentar misiones, kanban, hilo en vivo, catálogo, salud por equipo (Arq. §3) |
| Estado | **No consta** en el snapshot; era entregable de E5 ampliada (pendiente) | UI/BFF/catálogo/node-agent/mock en construcción; recorrido real comprobado en Cloud (Evid. 08:10–08:14 UTC) [H] |
| Relación | [I] Mission Control puede cumplir la mejora 7 y ampliarla; **no consta** que lo hayas decidido ni que `Panel de control.md` se descarte → `07-decisiones.md`, P17 | |
`LEEME.txt`: el piloto CTB "no prueba que Mission Control esté construido". Mission Control no aparece en ninguna otra nota del snapshot (búsqueda en el snapshot, Inv. §8).

## 4. División del trabajo y cómo se evita duplicar [C]
- **Codex = descubrimiento y rebote de ideas** (automatización "Explorador de Obsidian e ideas", viernes 10:00, Verif. local [H]); **Claude = desarrolla y prueba lo seleccionado** (Chat ~01:52; Encargo 01:03 mejora 4; `LEEME.txt`).
- Mission Control **no programa el rebote**; solo **lee** `Uploads/Registro de elecciones.md`. Las ideas "sin decisión tuya" (N01, N02, N05) se muestran, **nunca se convierten en tareas** (Chat ~02:05; Reg. de elecciones, Reglas). Un solo escritor del registro de elecciones.
- Los planes de Obsidian que duplican esa rutina se reconcilian a favor de esta decisión (`LEEME.txt` VIGENCIA). Sin cambios en Codex desde aquí.

## 5. Cómo ayudarte [C] (Chat ~01:52)
Una acción principal y hasta dos alternativas · pasos concretos · ideas laterales guardadas, **sin** convertirlas en tareas · al retomar, responder: dónde quedamos / qué cambió / qué sigue / cómo sabremos que terminó · trabajo, proyectos y personal separados (sin `Privado/` ni datos de salud en estos documentos). "Avísame qué poner en cada etapa; tú te encargas de dividir tareas" (Chat ~01:55) → `05-etapas-y-encargos.md`.

## 6. Plataformas, equipos y decisión de base
- **Cinco plataformas obligatorias** [C]: Hermes, Xiaomi MiMo, Claude, ChatGPT/Codex, Grok (Encargo, ampliación 8 oct 01:03). Estado por plataforma: `02-componentes-y-estado.md`.
- **Cuatro equipos** [C]: Windows principal (96 GB RAM / 24 GB VRAM), 2 Windows de 16 GB, 1 Mac. Compatibilidad y disponibilidad **por comprobar**. El Mac es donde `principal` y las instalaciones leídas (Hermes, Codex, MiMo, Grok Bot) existen (Verif. local); qué Windows es "la PC más avanzada" de la bóveda **no consta** (Estado del sistema, E1).
- **Decisión de base:** Paperclip como plano de control + Hermes (`hermes_gateway`) como ejecutor. Parte del plan que diste ~01:28 CDMX [C]; `Arq.` la registra como "base aprobada para el hito 1, ~02:00 CDMX" (diferencia de hora no resuelta). Comprobada en Cloud, un solo equipo, modelo **simulado** (Evid. 08:10–08:14 UTC).

## 7. Fuentes que faltan en el snapshot (enlaces/rutas que no resuelven)
`LEEME.txt` manda marcarlas como fuentes faltantes. Lista exacta (extracción de `[[ ]]` del snapshot + Inv. §7.2):
| Grupo | Rutas |
| --- | --- |
| Raíz y sistema | `Inicio` · `Supervivencia` · `Sistema/Usar el segundo cerebro` · `Sistema/Prueba de utilidad` · `Sistema/Guía del vault` · `Sistema/Registro de ingesta` (+ `/2026-09-28 — Mejoras de uso y contexto`) · `Inbox/2026-09-28 — Mejoras solicitadas para Obsidian` |
| Trabajo | `Trabajo/Trabajo` · `Trabajo/Contexto laboral` · `Trabajo/Áreas/Automatización e IA` · `Trabajo/Proyectos/Sellos industriales — propuesta de prospección` · `Trabajo/Proyectos/Preparar sistema de prospección` · `Trabajo/Referencias/2026-09-27 — Alianza entre agencias` |
| Privado (fuera del paquete a propósito) | `Privado/Reinicio 2026-09-28/{Planes-y-tareas, Protocolo-y-evidencias, Memoria-operativa, Inventario-confirmado, Reglas-de-revision}` |
| Wiki | `Wiki/Contradicciones y preguntas` · `Wiki/Fuentes/Plaud — Obsidian, Second Brain y LLM Wiki` |
| Entregables de E4/E5 citados y ausentes | `Herramientas/Catálogo de herramientas.md` · `Matriz de pruebas.md` · `Panel de control.md` · `Pruebas/` · `E4 — Avance.md` · `Adaptadores/generar.py` |
| Fuera de la bóveda | `/Users/matenc10/Downloads/7-Hermes-Agent-Upgrades-You-NEED-To-Implement-Today.md` · Doc de Drive del 4 oct y carpeta de investigación del 1 oct (ficha CTB; solo citados) · **el video** como fuente externa (URL/autor/fecha exacta de publicación: solo constan en tus mensajes y las notas; el video no se vio) |
Además: `AGENTS.md` y `Sistema/Convenciones y flujo.md` están en el paquete pero esta sesión no los usó para afirmar nada más allá de Inv.

## 8. Archivos que pude leer en esta sesión
Paquete ZIP = 54 archivos (52 del `MANIFIESTO.json` + `LEEME.txt` + `MANIFIESTO.json`). **(D)** leído completo por mí; **(I)** leído solo a través de `Inv.` (extracción previa, no reabierto).
- Raíz (3): `AGENTS.md` (I) · `LEEME.txt` (D) · `MANIFIESTO.json` (D, cabecera y conteos).
- `Sistema/` (3): `Contexto para asistentes.md` (D) · `Estado del sistema.md` (D parcial) · `Convenciones y flujo.md` (I).
- `Sistema de agentes/` (10): `Plan por etapas` (D) · `Registro de continuidad` (D) · `E5` (D) · `E2` (D) · `E4` (D) · `Verificación local` (D) · `E1` (I) · `E3` (I) · `Encargo original` (I) · `Verificación documental` (I; consultada por búsqueda dirigida).
- `Piloto/` (1): ficha CTB (`Piloto/… — ficha.md`) (I; ficha con contradicción de alcance; no se copian sus datos comerciales).
- `Procedimientos/` (7: README + roles, retomar-proyecto, paquete-de-delegacion, verificar-fuentes, ficha-de-proyecto, cerrar-sesion) (I).
- `Adaptadores/` (30): Claude 7 · Codex 7 · Hermes 7 · Grok 7 (todos I) · Cursor 1 · Otras 1 (I).
- **Fuera del ZIP (3 + notas):** `Uploads/Registro de elecciones.md` (D; entregado en 3 copias idénticas en el chat, en el snapshot hay 1; no se comparó el hash de las otras dos) · `Uploads/Referencia video NEXORA — notas.md` (D líneas 1–60 y búsqueda de términos clave del resto; contenido tratado como dato).
- Del entorno Cloud (D): `Evid.`, `HT`, `Arq.`, `05-etapas-y-encargos.md`.

## 9. Archivos que NO pude leer
Todas las rutas del §7 · el video (solo sus notas) · `~/.hermes`, `~/.codex`, `~/.grokbot`, `~/XiaomiMiMoProjects` y la app de MiMo (solo a través de `Verif. local`) · la bóveda `principal` viva y la copia de la PC Windows · los dos archivos de Registro de elecciones restantes · `.obsidian`, `Privado/`, biblioteca completa (excluidos del paquete, `LEEME.txt`) · `docs.paperclip.ing`, `hermes-agent.nousresearch.com` y `komputermechanic.com` (no alcanzables desde el contenedor Cloud, Evid. 07:34 UTC).

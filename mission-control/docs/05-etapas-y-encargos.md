# Etapas, modelo por etapa y encargo para pegar

Fecha: 2026-10-08. Reparto de modelos acordado contigo esta madrugada **[C]**: **Fable 5.1 · Alto** para arquitectura, decisiones difíciles y revisión; **Sonnet 5.5 · Alto** para construir lo ya definido; **Sonnet 5.5 · Medio** para documentación y ajustes sencillos. Ultracode (coordinación con varios agentes) es independiente del esfuerzo; úsalo solo en etapas con mucho trabajo paralelo (E1, E6).

Dónde corre cada etapa importa para el crédito: los **$250 solo cubren sesiones Cloud**; lo que toque tus equipos se ejecuta en una sesión local de Claude Code (uso del plan) o lo haces tú siguiendo los runbooks. Los sobres de crédito son estimaciones, no límites configurados.

| Etapa | Objetivo | Dónde | Modelo · esfuerzo | Crédito (sobre) | Terminada cuando… |
| --- | --- | --- | --- | --- | --- |
| **E0** Investigación, arquitectura y recorrido real | Verificar Paperclip + Hermes Gateway y demostrar el recorrido completo | Cloud | Fable 5.1 · Alto (hecha en esta sesión) | gastado en esta sesión (ver `06-evidencias.md`) | Recorrido real registrado en Paperclip con evidencia **[H]** ✔ |
| **E1** Base verificable | Panel MC v1, BFF, catálogo, mock de Hermes, node-agent, pruebas de integración y de fallos, revisión independiente, runbooks | Cloud | Construcción Sonnet 5.5 · Alto; revisión Fable 5.1 · Alto; docs Sonnet · Medio | $45 | `pnpm test` y `pnpm typecheck` en verde; e2e contra Paperclip real + mock pasa; informe de revisión con hallazgos corregidos; `06-evidencias.md` actualizado |
| **E2** Primer equipo real (Windows principal) | Paperclip como servicio, Hermes API server con tu proveedor, node-agent, MC apuntando a datos reales; primer recorrido con modelo real (MiMo en Hermes) | Local (tu Windows principal) | Sonnet 5.5 · Medio (seguir runbook) | plan local, no crédito | MIS-1 real donde el agente mueve la tarea a `in_review` él solo; respaldo y restauración probados en el mismo equipo |
| **E3** Segundo equipo y red | Tailscale, HTTPS en tailnet, Hermes en laptop 1 o Mac como `hermes_gateway` remoto, recuperación tras desconexión | Local (dos equipos) + Cloud para ajustes de código | Sonnet 5.5 · Alto (código) / Medio (runbook) | $30 | Tarea asignada por regla al segundo equipo, ejecutada allí y recuperada tras apagar/encender el Hermes remoto, sin duplicar |
| **E4** Integraciones | Slack (puente Socket Mode), adaptadores locales de Claude/Codex/Grok en la Windows principal, MiMo como proveedor, precios por modelo | Cloud (código) + local (claves y pruebas) | Sonnet 5.5 · Alto; Fable para el diseño del puente Slack | $50 | Encargo desde Slack → tarea → equipo correcto → resultado en el hilo; cada adaptador con una prueba de humo registrada |
| **E5** Contexto y catálogo completo | Lector de Obsidian (3 capas), P1–P5 como skills en Paperclip/Hermes, catálogo con evidencia por capacidad y equipo | Cloud (código) + local (bóveda) | Sonnet 5.5 · Alto | $35 | `retomar-proyecto` ejecutado por un agente desde MC con citas correctas; catálogo con ≥1 capacidad "probada" por plataforma disponible |
| **E6** Verificación y endurecimiento | Pruebas de restauración, de acceso a carpetas, de fallos (corte, reinicio, duplicado, presupuesto), auditoría de permisos | Cloud + local | Fable 5.1 · Alto (revisión) + Sonnet · Alto (correcciones) | $35 | Lista de pruebas con resultado y fecha; ningún hallazgo crítico abierto |
| **E7** Operación cotidiana (A4) | Rutinas ligeras sin modelo, revisión diaria de incompletas, auditoría semanal de fallos y consumo | Local (Paperclip routines) | Sonnet 5.5 · Medio | reserva $25 para reparaciones | Una semana sin tareas duplicadas ni reintentos infinitos; consumo visible por agente y modelo |

Punto de decisión: tras E1 revisas evidencia y consumo antes de autorizar E2 (instalación en tus equipos). Nada se instala en tus máquinas sin tu autorización **[C]**.

## Encargos para pegar

Cada encargo supone que la sesión tiene este repositorio y lee primero `mission-control/docs/CONTINUIDAD.md`.

### E1 — continuar la base (Cloud, Sonnet 5.5 · Alto)

```
Lee mission-control/docs/CONTINUIDAD.md y docs/03-arquitectura.md. Continúa el hito 1 de Mission
Control: completa lo marcado "pendiente" en CONTINUIDAD.md sin ampliar el alcance. Ejecuta
`pnpm install`, `pnpm typecheck`, `pnpm test` y el e2e del laboratorio (lab/README.md) y pega
los resultados reales en docs/06-evidencias.md. No marques como probado lo que no ejecutaste.
Al terminar, pide una revisión independiente (Fable 5.1 · Alto) de los cambios y corrige los
hallazgos confirmados antes de entregar.
```

### E2 — primer equipo real (local, Sonnet 5.5 · Medio)

```
Estoy en mi Windows principal. Sigue mission-control/docs/04-runbooks/windows.md paso a paso.
Antes de cada paso que instale o modifique algo, muéstrame el comando y espera mi confirmación.
Usa versiones fijadas (paperclipai 2026.1005.0 o la que indique el runbook). Al final ejecuta la
prueba de respaldo y restauración y la tarea de prueba MIS-1 real; registra la salida literal en
docs/06-evidencias.md con fecha y zona horaria.
```

### E3 — segundo equipo (local + Cloud, Sonnet 5.5 · Alto)

```
Lee docs/04-runbooks/segundo-equipo.md. Conecta <equipo> a la red Tailscale, instala Hermes con
su API server y regístralo en Paperclip como hermes_gateway con clave propia y HTTPS. Crea una
capacidad en el catálogo que solo exista en ese equipo y comprueba que una misión que la requiera
se asigna allí. Apaga el Hermes remoto a mitad de una tarea, vuelve a encenderlo y demuestra que la
tarea se recupera sin duplicarse. Evidencia literal en docs/06-evidencias.md.
```

### E4 — integraciones (Cloud para código, Sonnet 5.5 · Alto)

```
Implementa el puente Slack en modo Socket (sin URL pública) descrito en docs/03-arquitectura.md:
un encargo en un hilo de Slack crea una misión; los avances y el resultado vuelven al mismo hilo.
Pruébalo con el mock de Slack del repo y deja la prueba real para mi cuenta con instrucciones.
Después añade los adaptadores claude_local, codex_local y grok_local al catálogo con su prueba de
humo y la tabla de precios por modelo en los ajustes. Sin credenciales en el repositorio.
```

### E5 — contexto y catálogo (Cloud + local, Sonnet 5.5 · Alto)

```
Implementa el lector de contexto de Obsidian en tres capas (común, por área, por tarea) con
procedencia y fecha por fragmento, solo lectura, sin Privado/. Publica los procedimientos
retomar-proyecto, verificar-fuentes, paquete-de-delegacion, ficha-de-proyecto y cerrar-sesion como
skills en Paperclip y, en el equipo con Hermes, como carpeta externa de skills. Prueba
retomar-proyecto desde una misión y compara las citas con la bóveda.
```

### E6 — verificación (Cloud, Fable 5.1 · Alto para revisar; Sonnet · Alto para corregir)

```
Revisa de forma independiente mission-control/: correctness, seguridad (credenciales, permisos,
comandos permitidos), recuperación tras reinicio, duplicados, límites de reintentos y
presupuesto, reproducibilidad de instalar/actualizar/restaurar. Ejecuta las pruebas de fallos de
tests/ y añade las que falten. Entrega hallazgos clasificados por severidad con evidencia y
corrige los confirmados en commits separados.
```

### E7 — operación (local, Sonnet 5.5 · Medio)

```
Activa en Paperclip las rutinas de operación definidas en docs/03-arquitectura.md §5 (revisión
diaria de incompletas, auditoría semanal) con frecuencia <indicar>. No dupliques el rebote de
ideas de Codex. Comprueba una semana después consumo por agente y modelo, tareas duplicadas y
reintentos, y deja el informe en docs/06-evidencias.md.
```

## Ideas laterales (guardadas, no son tareas)

Ver `docs/ideas-laterales.md`. Allí van modo voz, manos (MediaPipe), juego, ciudad 3D, Composio, MiMo Desktop por puente, y cualquier idea que surja. El rebote recurrente de ideas sigue en Codex **[C]**; aquí solo se anotan las que aparezcan construyendo.

# @mc/ui · Panel de Mission Control

Panel web (React 19 + Vite 8 + TypeScript estricto, sin framework de UI ni librería de gráficas) de la "cabina" de agentes. Habla con el BFF (`/api/mc/*`, contrato en `docs/08-contrato-bff.md`; tipos desde `@mc/contracts`).

## Vistas

| Vista | Qué hace |
| --- | --- |
| **Cockpit** | Cuadro de instrumentos (tasa de éxito en medidor de arco, misiones totales con franja por estado, duración media con sparkline), estado del sistema (CPU/RAM/disco/GPU en barras segmentadas con texto Normal/Atención/Crítico), resumen de misiones, orquestación (jefe arriba + 4 más activos), distribución de carga, duración por agente, actividad de runs, modelos y presupuesto, procedencia. |
| **Misiones** | Asistente de 4 pasos (misión → equipo: jefe elige / manual / reglas → límites → revisar y lanzar, con `Idempotency-Key`), tablero Briefing / En curso / Revisión / Entregada, registro con filas desplegables y *replay*, y cajón de detalle: plan, acciones con confirmación (aprobar, rechazar, aceptar, pedir cambios, reejecutar, detener), mensajes en vivo (SSE), runs y *replay* con control deslizante. |
| **Agentes** | Ciudad isométrica 2D en SVG: una torre por agente (acento con pulso = trabajando, tono cálido = disponible, gris = pausado, rojo apagado = error). Clic o Enter abre la ficha (datos, presupuesto, últimos runs, «Chat llega en E4»). Mapa de calor 7×24 (o por hora / por día), registro de actividad, asistente «Añadir agente» (rol → resumen → confirmar y desplegar) y «Retirar agente». |
| **Docs** | Lista con búsqueda, lector de Markdown (renderizado como elementos React, nunca HTML crudo) y «Escribir nota». |
| **Schedule** | Rutinas con cron legible, próxima/última ejecución y «Ejecutar ahora» con confirmación (el cron de Hermes es de solo lectura). |
| **Salud** | Tarjeta por equipo con medidores, estado de Hermes y *comandos rápidos* de lista permitida con diálogo de confirmación y resultado (`501 simulated_only` se muestra como aviso, no como avería); plano de control (BFF, Paperclip, gateways) y procedencia. |
| **Catálogo** | Tabla filtrable (tipo, equipo, ejecutor, estado + búsqueda) con insignias de estado y compatibilidad NC/FV/VL/PF, detalle con evidencia y botón **Validar**. |
| **Ideas** | Registro de elecciones en solo lectura; «Convertir en misión» abre el asistente pre-llenado con `ideaId` y **nunca crea nada solo**. |
| **Ajustes** | Tema (ámbar, azul, propio con 3 colores y comprobación de contraste), modo oscuro/claro/automático, 4 layouts, 4 tipografías + tamaño; ajustes compartidos (nombre, agente jefe, umbrales, tabla de precios por modelo, topes por agente) con `PUT /settings` del objeto completo; exportar/importar/restablecer los ajustes locales en JSON. |
| **Guía** | Qué hace cada pestaña. |
| **Próximamente** | Lo que no se construye, con el motivo. |

Cabecera: búsqueda global (`/` o Ctrl/Cmd+K; agentes, misiones —consulta al BFF— y vistas), estado del flujo SSE, modo (Demo / Paperclip), alternar claro/oscuro y «Nueva misión». Banda permanente **DATOS SIMULADOS** cuando `health.bff.mode === 'demo'` o con `?mock=1`; banda roja si el BFF no responde y banda de modo degradado con la URL base cuando Paperclip no está accesible.

## Fuera de alcance (y por qué)

Se muestran como tarjetas «próximamente», no como pestañas rotas:

- **Voz** y **chat con agentes**: dependen de la etapa E4 (chat directo) y de elegir motor de voz.
- **Manos (cámara)**, **juego**, **respiración**: extras del video sin valor operativo en el hito 1.
- **Ciudad 3D**: la 2D isométrica es navegable por teclado y ligera; 3D pide WebGL y otra pasada de accesibilidad.
- **Terminal libre**: decisión de seguridad; solo hay comandos de lista permitida con confirmación.
- **Edición de SOUL.md**: cambia el comportamiento del agente; se pospone hasta tener versionado y aviso de riesgo.
- **Integraciones**: sin contrato en el BFF.

## Desarrollo

```bash
export PATH=/opt/node24/bin:$PATH
pnpm --filter @mc/ui dev        # http://127.0.0.1:5173, proxy /api -> http://127.0.0.1:3300 (BFF)
pnpm --filter @mc/ui typecheck
pnpm --filter @mc/ui test       # node:test sobre src/lib/*.ts (32 pruebas)
pnpm --filter @mc/ui build      # tsc + vite build -> dist/ (lo sirve el BFF)
```

Sin BFF: abre `http://127.0.0.1:5173/?mock=1`. Un backend simulado en memoria (`src/mocks/`) responde a todos los endpoints, con estado (crear misión, aprobar, aceptar…), y la UI lo etiqueta como SIMULADO. La navegación usa hash (`#/misiones/mis-1?tab=replay`), de modo que `?mock=1` se conserva y funciona con `base: './'`.

## Temas, layouts y tipografía

Todo color sale de variables CSS en `src/styles/themes.css` (`:root[data-theme][data-scheme]`), así que el cambio es instantáneo. Temas: **ámbar** (por defecto), **azul**, **propio** (acento, fondo y texto; el modo claro/oscuro se deduce del fondo). Cada uno con variante clara. Layouts: riel completo, riel de iconos, cubierta inferior y superior; por debajo de 860 px se impone la cubierta inferior. Tipografías: sistema (por defecto), humanista, técnica, editorial (pilas de fuentes del sistema, sin descargas) y tres tamaños. Las preferencias viven en `localStorage` (siempre con `try/catch`) y se aplican antes del primer pintado desde `index.html`.

## Accesibilidad

- Todo se alcanza con teclado; anillos de foco visibles; enlace «Saltar al contenido»; diálogos nativos `<dialog>` (trampa de foco y Esc).
- El color nunca es la única señal: cada estado lleva icono y texto (p. ej. «Normal / Atención / Crítico»), la leyenda de la ciudad y las torres llevan etiqueta, las barras son `role="meter"` con valor.
- Gráficas con `aria-label`, tooltip en hover **y** foco, leyenda cuando hay 2+ series, vista de tabla y relleno rayado a 45° para la serie «Fallo» como canal secundario (no depender solo del rojo frente al ámbar).
- `prefers-reduced-motion` desactiva el pulso y las animaciones.
- Responsive ≥ 1024 px y utilizable a 768 px.

## Decisiones de diseño (breves)

- **Cabina oscura con ámbar** y sensación de instrumentos: medidor de arco segmentado, barras de segmentos, cifras grandes; rejilla de 8 px; espacio generoso.
- **Gráficas en SVG propio**: marcas finas (barras ≤ 24 px con extremo redondeado de 4 px, 2 px de separación), rejilla hairline, mapa de calor de un solo tono (rampa del acento), texto siempre con tokens de texto. Se siguió la guía del skill `dataviz`; su validador de paletas es para paletas categóricas y aquí no hay una (series = éxito / fallo / otros con rol fijo), por lo que la distinción se refuerza con textura, leyenda y tabla.
- **Estado compartido mínimo**: un contexto con salud, agentes, ajustes y contadores de revisión que suben con los eventos SSE (agrupados 400 ms); cada vista recarga lo suyo y conserva los datos previos mientras recarga.
- **Lógica pura en `src/lib/*.ts`** (sintaxis eliminable, probada con `node:test`): estados, formateadores, tema, URL de la API, router, búsqueda, Markdown, matemática de gráficas, métricas y validación del asistente.

## Capturas

En `docs-assets/` (generadas con `?mock=1`, por tanto con datos simulados): `cockpit`, `misiones`, `misiones-detalle`, `misiones-replay`, `agentes`, `agentes-ficha`, `docs-lector`, `schedule`, `salud`, `catalogo`, `ideas`, `ajustes`, `guia`, `proximamente`, `wizard`, variantes de tema (`cockpit-azul`, `cockpit-claro`, `cockpit-propio`), layouts (`cockpit-top`, `movil-768-*`) y el estado sin BFF (`bff-caido`).

## Estructura

```
src/
  lib/        api, sse, format, theme, status, router, search, markdown, chart, metrics, wizard, roles, actions
  mocks/      fixtures.ts (datos simulados tipados) y mockApi.ts (backend en memoria para ?mock=1)
  state/      AppContext (salud, agentes, ajustes, SSE, toasts, asistentes) y hooks
  components/ Shell, ui, charts, City, Timeline, MissionDrawer, MissionWizard, AgentWizard, Markdown, System, Icon
  views/      Cockpit, Missions, Agents, Docs, Schedule, Health, Catalog, Ideas, Settings, Guide, Soon
  styles/     themes.css (tokens) y app.css
test/         *.test.mjs (importan ../src/lib/*.ts directamente con Node 24)
```

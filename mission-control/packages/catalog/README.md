# @mc/catalog — Catálogo de capacidades de Mission Control

Catálogo en YAML (legible en Obsidian) de lo que cada ejecutor puede hacer en cada equipo, con **estado**, **consumo**, **permisos** y **evidencia fechada**. Incluye el validador, un CLI y la regla de asignación del hito 1 (`matchCapabilities`).

Tipos: `Capability` y `CatalogValidationIssue` de `@mc/contracts`. Esquema JSON para editores: [`schema/capability.schema.json`](schema/capability.schema.json) (se regenera en cada `build`; versión del formato `CATALOG_SCHEMA_VERSION`).

## Formato YAML

Cada archivo `*.yaml`/`*.yml` de la carpeta del catálogo puede contener **una** capacidad, **una lista**, o un objeto con la clave `capabilities:` (lo que usa la semilla).

```yaml
capabilities:
  - id: hermes-api-server            # kebab-case, único en todo el catálogo
    nombre: "Hermes API server (nube)"
    tipo: api                        # skill | mcp | plugin | api | conector | herramienta-local | navegador | automatizacion | modelo
    que_hace: "API HTTP de Hermes Agent ... Comprobado SOLO en la nube con modelo simulado."
    necesita:                        # requisitos previos
      - "Hermes Agent instalado"
    ejecutores: [hermes]             # hermes | claude | codex | grok | mimo | operador
    equipos: [nube]                  # ids de equipo: win-principal, win-laptop-1, win-laptop-2, mac, nube
    contexto: [A, B, C]              # A común breve · B proyecto · C tarea
    permisos:
      lectura: ["Tareas que Paperclip le entrega"]
      escritura: ["Resultado del run"]
    consumo: sin-modelo              # local | suscripcion | api-facturada | sin-modelo
    estado: probada                  # descubierta | configurada | probada | pendiente | incompatible
    compatibilidad: { hermes: PF }   # por plataforma: NC | FV | VL | PF
    evidencia:                       # pruebas fechadas; [] si no hay
      - fecha: "2026-10-08"          # AAAA-MM-DD (entre comillas)
        donde: nube                  # id de equipo | nube | documentacion
        resultado: "POST /v1/runs → completed, SSE OK, 409 en duplicado"
        referencia: "docs/06-evidencias.md"
    version: "hermes-agent a28a5d03" # opcional
    fuente: "docs/09-hechos-tecnicos.md"   # opcional: ruta en Obsidian o URL
    procedencia: H                   # C confirmado · H comprobado · P plan histórico · F fuente externa · I inferencia · Pr propuesta
    paperclipRef: { kind: skill, id: "..." }   # opcional (skill | mcp | plugin)
    hermesRef: "..."                 # opcional
```

Obligatorios: `id, nombre, tipo, que_hace, necesita, ejecutores, equipos, contexto, permisos (lectura y escritura), consumo, estado, compatibilidad, evidencia, procedencia`.

## Estados

| `estado` | Significado |
| --- | --- |
| `descubierta` | Sabemos que existe (documentación, notas, un listado), pero no está instalada ni configurada en ese equipo. |
| `configurada` | Está instalada y configurada en el equipo, pero aún no se ha ejecutado una prueba que lo demuestre. |
| `probada` | Se ejecutó de verdad y hay **evidencia fechada** de ello (ver abajo). |
| `pendiente` | Queda por comprobar en ese contexto (equipo, ejecutor o entorno distinto de donde ya se probó). |
| `incompatible` | Se sabe que no funciona o no aplica. |

| `compatibilidad` (por plataforma) | Significado |
| --- | --- |
| `NC` | No compatible, o sin formato/adaptador publicado. |
| `FV` | Formato verificado en la documentación oficial; **no** se ha instalado ni comparado con la instalación real. |
| `VL` | Verificado en local: la instalación real coincide con el formato documentado. |
| `PF` | Probado funcionando: se ejecutó y produjo el resultado esperado. Pide evidencia. |

## Regla de asignación del hito 1

`matchCapabilities(required, { capabilities, agents, machines, scope? })` devuelve candidatos `(agente, equipo)`:

1. **Exclusiones**: se descartan los agentes `paused`, `error` u `offline`, y si alguna capacidad requerida está `incompatible` el resultado es `[]`.
2. **Filtro** (debe cumplirse para TODAS las capacidades requeridas): `agent.platform ∈ cap.ejecutores`, `machine.id ∈ cap.equipos` y (`agent.machineId` vacío o igual a `machine.id`).
3. **Puntaje**: +3 por capacidad `probada`, +2 `configurada`, +1 otro estado · −3 si el equipo no está `online` · −1 por cada trabajo pesado activo del equipo · +1 si el agente está `available`.
4. **Orden**: puntaje descendente, luego menos trabajos pesados activos, luego nombre del agente.
5. Cada candidato trae `reasons` en español, una por regla aplicada. Sin requisitos, con un id desconocido o sin coincidencias devuelve `[]` (nunca lanza).

Notas: `scope` se acepta pero en el hito 1 no filtra.

## Cómo validar

```bash
pnpm --filter @mc/catalog build
pnpm --filter @mc/catalog validate                    # = node dist/cli.js validate ./catalog
node dist/cli.js validate ./catalog [--json]          # sale 1 si hay errores; 0 con solo avisos
node dist/cli.js list ./catalog --tipo skill --equipo mac --ejecutor claude --estado descubierta
node dist/cli.js match ./catalog --required retomar-proyecto,cerrar-sesion --agents agents.json --machines machines.json
node dist/cli.js schema --out schema/capability.schema.json
pnpm --filter @mc/catalog test
```

Códigos de salida del CLI: `0` correcto · `1` errores de validación · `2` uso incorrecto.

`validate` marca como **error** (la capacidad queda fuera del catálogo): campo obligatorio ausente, valor fuera de los enumerados, id que no es kebab-case o repetido, fecha de evidencia que no es AAAA-MM-DD válida, listas con elementos que no son texto. Marca como **aviso** (la capacidad se conserva): `probada` sin evidencia o respaldada solo por documentación, compatibilidad `PF` sin evidencia, `equipos` vacío, `ejecutores` vacío, campos desconocidos (posibles erratas).

Desde código: `loadCatalog(dir)`, `validateCapability(raw, source?)`, `matchCapabilities(...)`, `catalogSchema`, `CATALOG_SCHEMA_VERSION`.

## Qué NO significa «probada»

`probada` **solo** vale con evidencia fechada: una entrada en `evidencia` con `fecha`, `donde` y `resultado` de una ejecución real. No significa:

- que esté documentada, instalada o que «el adaptador existe» (eso es `descubierta` o `configurada`);
- que funcione en otros equipos: la evidencia de `donde: nube` no prueba Windows, macOS ni la red entre equipos (por eso `hermes-api-server-equipos` está `pendiente`);
- que funcione con un modelo real: hoy el recorrido se probó con un **modelo simulado** (`modelo-simulado-stub`);
- que una lectura hecha desde otro entorno (p. ej. los conectores de Claude Cowork el 8 oct) valga para un ejecutor de MC.

Si algo cambia (nueva versión, otro equipo), añade una evidencia nueva o vuelve el estado a `pendiente`.

## Semilla (`catalog/`)

- `procedimientos.yaml`: los seis procedimientos neutrales (P1–P5 más `roles`) como `skill`, todos `descubierta`; Hermes, Claude y Codex `FV`, Grok `NC` (Grok Bot no publica formato de archivo). Equipos `mac` y `win-principal` son **[Pr]**: donde vive la bóveda.
- `plataformas.yaml`: Hermes API server y `hermes_gateway` (`probada` solo en la nube, con modelo simulado), adaptadores locales de Claude/Codex/Grok, MiMo vía Hermes (con el riesgo de términos del Token Plan), el stub simulado y `grok-bot-manual` (solo uso manual, `incompatible` para control desde MC); `grok-local` es el CLI Grok Build.
- `herramientas.yaml`: Obsidian, Drive, Calendar, Notion, Slack, Registro de elecciones, servidor MCP de Paperclip y GPU local, todas `pendiente`.

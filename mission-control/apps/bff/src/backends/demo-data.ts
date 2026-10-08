import type { MachineId, Platform } from '@mc/contracts';

export interface DemoAgentSeed {
  key: string;
  id: string;
  name: string;
  shortName: string;
  role: string;
  title: string;
  platform: Platform;
  adapterType: string;
  machineId: MachineId;
  modelLabel: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  isBoss: boolean;
  budgetMonthlyCents: number;
  state: 'available' | 'paused';
  /** Procedimiento/estilo para los mensajes simulados. */
  voice: string[];
}

export const DEMO_AGENTS: DemoAgentSeed[] = [
  {
    key: 'coord', id: 'demo-agent-coordinador', name: 'Coordinador', shortName: 'Coord', role: 'ceo', title: 'Agente jefe: planifica, reparte y revisa',
    platform: 'claude', adapterType: 'claude_local', machineId: 'win-principal', modelLabel: 'Claude Sonnet', effort: 'high', isBoss: true, budgetMonthlyCents: 4000, state: 'available',
    voice: ['Propongo dividir el trabajo en dos pasos y asignar la parte de lectura a {peer}.', 'Reviso el avance de {peer}: lo entregado cumple el objetivo, falta pulir el cierre.', 'Anoto el riesgo: si el equipo de {peer} se satura, muevo la tarea a otro ejecutor.'],
  },
  {
    key: 'inv', id: 'demo-agent-investigacion', name: 'Investigación', shortName: 'Research', role: 'researcher', title: 'Búsqueda y síntesis de fuentes',
    platform: 'hermes', adapterType: 'hermes_gateway', machineId: 'mac', modelLabel: 'hermes (modelo del perfil)', effort: 'medium', isBoss: false, budgetMonthlyCents: 1500, state: 'available',
    voice: ['Encontré cuatro fuentes relevantes; descarté dos por antigüedad y resumo las otras en una tabla.', '@{peer}: te paso los datos clave para que armes el documento; los citados están marcados.', 'Cruzando fuentes aparece una discrepancia en las fechas; la dejo señalada, no la resuelvo por mi cuenta.'],
  },
  {
    key: 'doc', id: 'demo-agent-documentos', name: 'Documentos', shortName: 'Docs', role: 'engineer', title: 'Redacción y formato de entregables',
    platform: 'codex', adapterType: 'codex_local', machineId: 'win-principal', modelLabel: 'GPT Codex', effort: 'high', isBoss: false, budgetMonthlyCents: 2500, state: 'available',
    voice: ['Borrador listo: estructura en cinco secciones, tono directo y sin relleno.', '@{peer}: necesito las cifras finales para cerrar la sección de resultados.', 'Apliqué el formato de la bóveda (frontmatter y enlaces) y dejé el informe largo en Docs.'],
  },
  {
    key: 'dat', id: 'demo-agent-datos', name: 'Datos', shortName: 'Data', role: 'engineer', title: 'Tablas, limpieza y análisis',
    platform: 'grok', adapterType: 'grok_local', machineId: 'win-laptop-2', modelLabel: 'Grok (4 modelos listados)', effort: 'high', isBoss: false, budgetMonthlyCents: 2000, state: 'available',
    voice: ['Normalicé las columnas y quité 14 filas duplicadas; el total cuadra con la fuente.', '@{peer}: la tabla ya está en el documento compartido; la gráfica queda para tu sección.', 'Detecté valores atípicos en la tercera semana; los marco y no los elimino sin tu visto bueno.'],
  },
  {
    key: 'rev', id: 'demo-agent-revision', name: 'Revisión', shortName: 'Review', role: 'qa', title: 'Control de calidad y consistencia',
    platform: 'mimo', adapterType: 'hermes_gateway', machineId: 'win-laptop-1', modelLabel: 'mimo-v2.6-pro', effort: 'medium', isBoss: false, budgetMonthlyCents: 1200, state: 'available',
    voice: ['Revisé el entregable contra el objetivo: cumple dos de tres criterios; falta el resumen ejecutivo.', '@{peer}: corrige la cifra de la sección 2, no coincide con la tabla.', 'Sin observaciones graves; dejo tres sugerencias menores de estilo.'],
  },
  {
    key: 'bib', id: 'demo-agent-biblioteca', name: 'Biblioteca', shortName: 'Library', role: 'pm', title: 'Orden de notas y bóveda',
    platform: 'hermes', adapterType: 'hermes_gateway', machineId: 'mac', modelLabel: 'hermes (modelo del perfil)', effort: 'low', isBoss: false, budgetMonthlyCents: 800, state: 'available',
    voice: ['Indexé las notas nuevas y detecté dos enlaces rotos; los listo sin tocar tu bóveda.', '@{peer}: la nota fuente está en Proyectos; solo lectura, no la modifico.', 'Resumen de la bóveda actualizado; nada en Privado fue leído.'],
  },
  {
    key: 'ops', id: 'demo-agent-operaciones', name: 'Operaciones', shortName: 'Ops', role: 'devops', title: 'Scripts, respaldos y salud de equipos',
    platform: 'codex', adapterType: 'codex_local', machineId: 'win-laptop-2', modelLabel: 'GPT Codex', effort: 'medium', isBoss: false, budgetMonthlyCents: 1800, state: 'available',
    voice: ['Corrí la comprobación de salud: CPU y disco dentro de umbral; GPU sin trabajos pesados.', '@{peer}: el script de respaldo termina bien en modo prueba; falta tu confirmación para activarlo.', 'El API server de Hermes responde; la latencia es normal.'],
  },
];

export interface DemoMissionSeed {
  title: string;
  objective: string;
  scope: 'trabajo' | 'proyectos' | 'personal';
  agent: string;
  caps: string[];
  ideaId?: string;
}

export const DEMO_MISSIONS: DemoMissionSeed[] = [
  { title: 'Ensayo de propuesta para ENVOLVEX (prospecto real)', objective: 'Preparar un ensayo de propuesta comercial con datos públicos del prospecto, sin enviar nada fuera.', scope: 'trabajo', agent: 'inv', caps: [], ideaId: 'N01' },
  { title: 'Escena sonora previa a la animación (OXXO)', objective: 'Proponer una escena sonora de referencia antes de animar y comparar dos enfoques.', scope: 'proyectos', agent: 'doc', caps: [], ideaId: 'N02' },
  { title: 'Comentarios de CTB a propuesta web', objective: 'Convertir los comentarios del cliente en una propuesta web ordenada por prioridad.', scope: 'trabajo', agent: 'dat', caps: [], ideaId: 'N05' },
  { title: 'Resumen semanal de pendientes de la bóveda', objective: 'Leer las notas de la semana y listar pendientes sin modificar ninguna nota.', scope: 'personal', agent: 'bib', caps: [] },
  { title: 'Inventario de skills de Hermes por equipo', objective: 'Listar las skills instaladas en cada Hermes y marcar cuáles están probadas.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Comparativa de proveedores de voz sintética', objective: 'Comparar cuatro proveedores por calidad en español, coste y límites de uso.', scope: 'proyectos', agent: 'inv', caps: [] },
  { title: 'Plan de respaldo de la bóveda', objective: 'Diseñar un respaldo semanal con restauración probada y sin tocar Privado.', scope: 'personal', agent: 'ops', caps: [] },
  { title: 'Auditoría de enlaces rotos en notas', objective: 'Encontrar enlaces rotos o con mayúsculas distintas y proponer correcciones.', scope: 'personal', agent: 'bib', caps: [] },
  { title: 'Guion para video de 90 segundos', objective: 'Redactar un guion con gancho, tres ideas y cierre, tono cercano.', scope: 'proyectos', agent: 'doc', caps: [] },
  { title: 'Análisis de ventas del trimestre (CSV)', objective: 'Limpiar el CSV y resumir ventas por mes, producto y canal.', scope: 'trabajo', agent: 'dat', caps: [] },
  { title: 'Revisión de borrador de contrato de servicios', objective: 'Marcar cláusulas ambiguas y proponer redacción alterna; no es asesoría legal.', scope: 'trabajo', agent: 'rev', caps: [] },
  { title: 'Tabla de precios de modelos y consumo', objective: 'Construir la tabla de precios por modelo para estimar el consumo no informado.', scope: 'proyectos', agent: 'dat', caps: [] },
  { title: 'Checklist de lanzamiento de la landing', objective: 'Armar una lista verificable de lanzamiento: contenido, SEO, formularios y analítica.', scope: 'trabajo', agent: 'doc', caps: [] },
  { title: 'Minuta de reunión con cliente', objective: 'Convertir las notas de la reunión en minuta con acuerdos y responsables.', scope: 'trabajo', agent: 'doc', caps: [] },
  { title: 'Herramientas MCP para navegador', objective: 'Investigar opciones de MCP de navegador y su compatibilidad con cada ejecutor.', scope: 'proyectos', agent: 'inv', caps: [] },
  { title: 'Normalizar nombres de archivos del proyecto OXXO', objective: 'Proponer una convención de nombres y un script de renombrado en modo simulación.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Resumen de artículo sobre agentes autónomos', objective: 'Resumir el artículo en una página y extraer tres ideas aplicables.', scope: 'personal', agent: 'inv', caps: [] },
  { title: 'Guía de instalación de Hermes en Windows laptop 2', objective: 'Redactar la guía paso a paso y listar los puntos que requieren tu confirmación.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Pruebas de humo del node-agent', objective: 'Verificar latido, lista de comandos y rechazo de comandos fuera de la lista.', scope: 'proyectos', agent: 'rev', caps: [] },
  { title: 'Informe de salud de equipos de la semana', objective: 'Resumir CPU, memoria, disco y GPU de los cuatro equipos con alertas.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Ficha técnica de la plataforma MiMo', objective: 'Documentar cómo se usa MiMo como modelo dentro de Hermes y sus límites.', scope: 'proyectos', agent: 'inv', caps: [] },
  { title: 'Traducción de manual de usuario', objective: 'Traducir el manual al español neutro conservando términos técnicos.', scope: 'trabajo', agent: 'doc', caps: [] },
  { title: 'Depuración del script de respaldo', objective: 'Reproducir el fallo del script en modo prueba y proponer el arreglo.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Plan de contenidos para redes (4 semanas)', objective: 'Calendario de cuatro semanas con tema, formato y objetivo por pieza.', scope: 'trabajo', agent: 'doc', caps: [] },
  { title: 'Revisión ortográfica del dossier', objective: 'Revisar ortografía, tono y consistencia de cifras en el dossier.', scope: 'trabajo', agent: 'rev', caps: [] },
  { title: 'Extracción de datos de facturas en PDF', objective: 'Extraer fecha, emisor y total de las facturas y dejarlas en una tabla.', scope: 'trabajo', agent: 'dat', caps: [] },
  { title: 'Mapa de dependencias del catálogo de capacidades', objective: 'Dibujar qué capacidad depende de qué y detectar huecos de evidencia.', scope: 'proyectos', agent: 'bib', caps: [] },
  { title: 'Propuesta de presupuesto para campaña', objective: 'Armar tres escenarios de presupuesto con supuestos explícitos.', scope: 'trabajo', agent: 'dat', caps: [] },
  { title: 'Lista de tareas del mes (personal)', objective: 'Ordenar las tareas del mes por impacto y esfuerzo sin tocar la agenda.', scope: 'personal', agent: 'bib', caps: [] },
  { title: 'Estudio de paneles de agentes de la competencia', objective: 'Comparar cinco paneles de agentes: funciones, límites y precios publicados.', scope: 'proyectos', agent: 'inv', caps: [] },
  { title: 'Actualización de dependencias del BFF', objective: 'Listar dependencias con versión nueva y riesgos de cada actualización.', scope: 'proyectos', agent: 'ops', caps: [] },
  { title: 'Borrador de política de revisión humana', objective: 'Definir cuándo una misión exige revisión humana antes de cerrarse.', scope: 'proyectos', agent: 'doc', caps: [] },
  { title: 'Clasificación de correos del cliente', objective: 'Clasificar correos por urgencia y tema; no responder ninguno.', scope: 'trabajo', agent: 'rev', caps: [] },
  { title: 'Resumen de la reunión de planeación', objective: 'Resumir decisiones y pendientes de la reunión de planeación del hito.', scope: 'proyectos', agent: 'doc', caps: [] },
  { title: 'Migración de notas a la nueva estructura', objective: 'Proponer el mapa de migración de carpetas sin mover nada todavía.', scope: 'personal', agent: 'bib', caps: [] },
  { title: 'Cotejo de precios de hardware para GPU', objective: 'Comparar precios publicados de tarjetas de 24 GB y su consumo eléctrico.', scope: 'personal', agent: 'inv', caps: [] },
  { title: 'Informe de tokens por modelo (semana)', objective: 'Sumar tokens por modelo y estimar coste solo donde se conoce el precio.', scope: 'proyectos', agent: 'dat', caps: [] },
  { title: 'Esquema de presentación para inversionistas', objective: 'Esquema de diez láminas con mensaje central y datos de respaldo.', scope: 'trabajo', agent: 'doc', caps: [] },
  { title: 'Pruebas de reintento de ejecución', objective: 'Provocar un fallo controlado y comprobar el tope de reintentos y el escalado.', scope: 'proyectos', agent: 'rev', caps: [] },
  { title: 'Revisión de metas del trimestre (personal)', objective: 'Cotejar las metas del trimestre con lo hecho y listar lo que conviene aplazar.', scope: 'personal', agent: 'bib', caps: [] },
];

export const REPORT_PARAGRAPHS = [
  'El objetivo de «{t}» se abordó en tres fases: lectura del material de partida, contraste con fuentes disponibles y redacción de conclusiones. Cada fase dejó evidencia en el hilo de la misión para que cualquiera pueda reproducir el recorrido.',
  'Hallazgo principal: la información disponible alcanza para tomar una decisión informada, pero no para cerrar todos los detalles. Se marcaron con claridad los supuestos que requieren tu confirmación antes de avanzar, y se evitó rellenar huecos con conjeturas.',
  'Datos de respaldo: se revisaron cuatro fuentes, dos propias y dos externas. Las cifras que no coincidieron entre fuentes se dejaron señaladas con ambas versiones, para que se elija cuál usar sin perder trazabilidad.',
  'Riesgos detectados: dependencia de un solo equipo para la parte más pesada, posibles diferencias de formato entre plataformas y un margen de error razonable en las estimaciones de tiempo. Ninguno bloquea la entrega actual.',
  'Recomendación: aprobar la versión actual como base y abrir una misión de seguimiento para los puntos pendientes. Si se prefiere más rigor, conviene programar una revisión humana adicional antes de compartir el resultado fuera.',
  'Alcance respetado: no se modificó ninguna nota privada, no se envió información a terceros y toda escritura quedó limitada a este informe. Los pasos que requerirían permisos adicionales se listan aparte como propuestas, sin ejecutarse.',
  'Siguientes pasos sugeridos: validar las cifras marcadas, decidir qué ideas pasan a misión propia y archivar el material auxiliar. El tiempo estimado para completarlo es de entre treinta y noventa minutos de trabajo de los ejecutores.',
  'Notas de método: cada afirmación se contrastó contra el texto de origen, se conservaron las citas literales cuando importaba el matiz y se redujo el resto a frases cortas. El informe completo vive en Docs, no en el chat.',
  'Consumo: la ejecución usó pocos tokens frente al límite acordado. En los ejecutores que no informan precio, el coste se muestra como no informado salvo que el modelo esté en la tabla de precios de Ajustes.',
  'Conclusión: el resultado cumple el objetivo planteado dentro de los límites de tiempo, pasos y longitud definidos al lanzar la misión, y queda listo para tu revisión o para su entrega directa según la política elegida.',
];

export const SPECIAL_PEERS_NOTE = 'Los mensajes entre agentes de este backend son simulados con plantillas; no provienen de ningún modelo.';

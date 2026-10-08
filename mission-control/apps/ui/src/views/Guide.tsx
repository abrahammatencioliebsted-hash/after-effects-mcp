import { Card, PageHead } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { NAV } from '../components/Shell.tsx';

const GUIDE: Record<string, { what: string; tips: string[] }> = {
  cockpit: { what: 'El cuadro de instrumentos: tasa de éxito, misiones totales, duración media, estado del sistema, orquestación (jefe + los cuatro más activos), distribución de carga y modelos en uso.', tips: ['Cambia la ventana (7/14/30 días) arriba a la derecha.', 'Los medidores de CPU, RAM y disco se repiten en varias vistas a propósito: no lances trabajo pesado con el sistema en rojo.', 'Pulsa un agente en la orquestación para abrir su ficha.'] },
  misiones: { what: 'Lanza misiones, aprueba planes, sigue mensajes entre agentes y acepta resultados. El tablero tiene Briefing, En curso, Revisión y Entregada.', tips: ['«Nueva misión» abre un asistente de 4 pasos: misión, equipo, límites y revisión.', 'Una misión en Briefing necesita que apruebes (o rechaces) el plan antes de empezar.', 'En el cajón de la misión: Mensajes (en vivo), Runs y Replay con control deslizante para repasar paso a paso.', 'Aceptar resultados envía el informe a Docs. «Reejecutar» cuenta como reintento.'] },
  agentes: { what: 'La ciudad: una torre por agente. Pulso de acento = trabajando; tono cálido = disponible; gris = pausado; rojo apagado = error.', tips: ['Clic (o Enter) en una torre abre su ficha con modelo, carga y últimos runs.', 'El mapa de calor muestra cuándo trabajan los agentes (7×24, por hora o por día).', '«Añadir agente» tiene 3 pasos: rol, resumen y confirmar y desplegar.', 'El chat directo con cada agente llega en la etapa E4.'] },
  docs: { what: 'Informes largos de los agentes y tus propias notas. Los agentes depositan aquí lo extenso para no llenar el chat.', tips: ['Busca por título o contenido.', '«Escribir nota» guarda Markdown en MC.'] },
  schedule: { what: 'Rutinas programadas de Paperclip y, en solo lectura, el cron de Hermes.', tips: ['«Ejecutar ahora» pide confirmación y lanza la rutina fuera de horario.'] },
  salud: { what: 'Estado de cada equipo (CPU, RAM, disco, GPU), de Hermes, de Paperclip y del BFF, más comandos rápidos.', tips: ['Los comandos son una lista permitida con argumentos fijos y siempre piden confirmación.', 'No hay terminal libre: es una decisión de seguridad.'] },
  catalogo: { what: 'Qué puede hacer cada plataforma en cada equipo. Estados: descubierta, configurada, probada, pendiente, incompatible; compatibilidad NC → FV → VL → PF.', tips: ['Filtra por tipo, equipo, ejecutor y estado.', '«Validar» revisa el YAML contra el esquema y lista avisos y errores.'] },
  ideas: { what: 'El Registro de elecciones en solo lectura.', tips: ['«Convertir en misión» abre el asistente pre-llenado con el id de la idea; nunca crea nada sola.'] },
  ajustes: { what: 'Tema (ámbar, azul, propio), layout (4), tipografía, tu nombre, agente jefe, umbrales de salud y precios por modelo.', tips: ['Lo visual se guarda en tu navegador; lo operativo, en el BFF.', 'Exporta tus ajustes locales a JSON para llevarlos a otro equipo.'] },
  guia: { what: 'Esta guía.', tips: ['Atajos: «/» o Ctrl/Cmd+K enfocan la búsqueda global.'] },
  proximamente: { what: 'Lo que queda fuera de este hito, con el motivo.', tips: [] },
};

export function GuideView() {
  return (
    <>
      <PageHead title="Guía" sub="Qué hace cada pestaña y cómo sacarle partido." />
      <div className="grid split guide">
        <div className="stack">
          {NAV.map((n) => {
            const g = GUIDE[n.id];
            if (!g) return null;
            return (
              <Card key={n.id} id={`g-${n.id}`} className="guide-sec" title={<span className="row" style={{ gap: 10 }}><Icon name={n.icon} size={18} />{n.label}</span>} right={<a href={`#/${n.id}`} className="btn ghost sm">Abrir</a>}>
                <p className="t2">{g.what}</p>
                {g.tips.length > 0 && <ul style={{ margin: '12px 0 0', paddingLeft: 20 }} className="stack">{g.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              </Card>
            );
          })}
        </div>
        <aside style={{ position: 'sticky', top: 80, alignSelf: 'start' }}>
          <Card title="Atajos y convenciones">
            <ul className="stack" style={{ paddingLeft: 20, margin: 0 }}>
              <li><kbd className="chip">/</kbd> o <kbd className="chip">Ctrl</kbd>+<kbd className="chip">K</kbd>: búsqueda global</li>
              <li>Banda «DATOS SIMULADOS»: el backend es demo o usas <code>?mock=1</code>.</li>
              <li>Insignias <strong>Real / Simulado / Pendiente</strong> indican la procedencia de cada dato.</li>
              <li>Las horas se muestran en tu zona horaria, con su etiqueta.</li>
              <li>El estado nunca va solo en color: siempre hay icono y texto.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

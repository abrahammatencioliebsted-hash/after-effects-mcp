import { Badge, Card, PageHead } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';

const SOON = [
  { icon: 'mic', title: 'Modo voz', why: 'Hablar con los agentes y que respondan. Depende del chat directo (etapa E4) y de elegir un motor de voz local.' },
  { icon: 'hand', title: 'Control con las manos', why: 'Cámara y seguimiento de manos. Experimental y sin valor para operar misiones en este hito.' },
  { icon: 'gamepad', title: 'Juego', why: 'Un extra de entretenimiento mientras esperas. Cero prioridad frente a lo operativo.' },
  { icon: 'wind', title: 'Respiración', why: 'Ejercicio guiado 4-7-8. Pospuesto: no aporta a la operación del equipo.' },
  { icon: 'cube', title: 'Ciudad 3D', why: 'La ciudad actual es 2D isométrica y accesible por teclado; una versión 3D requiere WebGL y una pasada de accesibilidad.' },
  { icon: 'terminal', title: 'Terminal libre', why: 'Por seguridad solo hay comandos de una lista permitida con confirmación (Salud). Una terminal abierta quedaría fuera del modelo de permisos.' },
  { icon: 'edit', title: 'Edición de SOUL.md', why: 'Cambiar la «alma» de un agente altera su comportamiento. Se pospone hasta tener control de versiones y aviso de riesgo.' },
  { icon: 'plug', title: 'Integraciones', why: 'Conectores externos (GitHub, Notion…). Aún sin contrato en el BFF.' },
];

export function SoonView() {
  return (
    <>
      <PageHead title="Próximamente" sub="Lo que está fuera de alcance en este hito y por qué. Nada de esto es una pestaña rota: simplemente aún no se construye." />
      <div className="grid auto">
        {SOON.map((s) => (
          <Card key={s.title} className="soon-card" title={<span className="row" style={{ gap: 10 }}><Icon name={s.icon} size={18} />{s.title}</span>} right={<Badge tone="muted" icon="clock">Próximamente</Badge>}>
            <p className="t2">{s.why}</p>
          </Card>
        ))}
      </div>
    </>
  );
}

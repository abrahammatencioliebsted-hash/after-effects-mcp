import type { McEvent } from '@mc/contracts';

/** Bus en memoria entre los backends/registro de máquinas y los clientes SSE. */
export class EventBus {
  private readonly listeners = new Set<(e: McEvent) => void>();

  emit(e: McEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        /* un oyente roto no debe tumbar a los demás */
      }
    }
  }

  subscribe(l: (e: McEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** Serializa un evento en el formato SSE del contrato: `event: <type>` + `data: <json>`. */
export function formatSse(e: McEvent): { event: string; data: string } {
  return { event: e.type, data: JSON.stringify(e) };
}

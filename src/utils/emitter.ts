/** Tiny typed pub/sub used by services so they stay independent of React and the store. */
export type Unsubscribe = () => void;

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error('[Emitter] listener threw', error);
      }
    }
  }
}

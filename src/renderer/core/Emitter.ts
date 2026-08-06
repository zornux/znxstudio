import type { Disposable } from './Module';

export type Listener<T> = (event: T) => void;
/** A subscribable event: call it with a listener, get back a Disposable. */
export type Event<T> = (listener: Listener<T>) => Disposable;

/**
 * Minimal typed event emitter (VS Code-style). Modules expose `emitter.event`
 * as their public `Event<T>` and keep `fire` private. This is the seam used for
 * live settings sync and workspace-change notifications.
 */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // One throwing listener must not abort delivery to the rest — otherwise a
        // single module's bug silently desyncs every other subscriber to this event.
        console.error('[Emitter] a listener threw during fire():', error);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

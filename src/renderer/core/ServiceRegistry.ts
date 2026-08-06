/**
 * A tiny dependency-injection container keyed by string service ids. Modules
 * register their public service here; other modules resolve by key so no direct
 * module-to-module imports are required.
 */
export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<T>(id: string, instance: T): void {
    if (this.services.has(id)) {
      throw new Error(`Service already registered: ${id}`);
    }
    this.services.set(id, instance);
  }

  get<T>(id: string): T {
    const instance = this.services.get(id);
    if (instance === undefined) {
      throw new Error(`Service not found: ${id}`);
    }
    return instance as T;
  }

  tryGet<T>(id: string): T | undefined {
    return this.services.get(id) as T | undefined;
  }

  has(id: string): boolean {
    return this.services.has(id);
  }
}

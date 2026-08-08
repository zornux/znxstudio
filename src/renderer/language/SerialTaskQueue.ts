/** Runs tasks for the same key in invocation order while allowing different keys in parallel. */
export class SerialTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(task);
    this.tails.set(key, queued);
    void queued.finally(() => {
      if (this.tails.get(key) === queued) this.tails.delete(key);
    }).catch(() => undefined);
    return queued;
  }

  forget(key: string): void {
    this.tails.delete(key);
  }

  /** Resolves once every task currently queued for `key` has settled. */
  async whenIdle(key: string): Promise<void> {
    await this.tails.get(key)?.catch(() => undefined);
  }
}

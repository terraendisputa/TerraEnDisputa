export class PerGameCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  run<T>(gameId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(gameId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(gameId, settled);
    void settled.finally(() => {
      if (this.queues.get(gameId) === settled) this.queues.delete(gameId);
    });
    return result;
  }
}

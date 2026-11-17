/**
 * Undo steps registered as the job makes changes. They run in reverse order (last in, first out)
 * in a finally block. A failing step never stops the others.
 */
export class CleanupStack {
  private readonly steps: Array<{ name: string; run: () => Promise<unknown> }> = [];

  add(name: string, run: () => Promise<unknown>): void {
    this.steps.push({ name, run });
  }

  async runAll(onFailure?: (name: string) => void): Promise<void> {
    const pending = this.steps.splice(0).reverse();
    for (const step of pending) {
      try {
        await step.run();
      } catch {
        onFailure?.(step.name);
      }
    }
  }
}

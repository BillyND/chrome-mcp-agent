// Runs tasks so that tasks on different lanes overlap while tasks on one lane
// run strictly one after another in arrival order. A global cap keeps the
// browser from being flooded. Pure logic, no browser APIs.

interface Job {
  lane: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class Scheduler {
  private pending: Job[] = [];
  private busy = new Set<string>();
  private running = 0;

  constructor(readonly maxConcurrent = 6) {}

  run<T>(lane: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ lane, task, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Rejects every task that has not started yet; running tasks are left to finish. */
  cancelPending(reason: unknown): number {
    const dropped = this.pending.splice(0);
    for (const job of dropped) job.reject(reason);
    return dropped.length;
  }

  get stats() {
    return { running: this.running, queued: this.pending.length };
  }

  private pump(): void {
    let i = 0;
    while (i < this.pending.length && this.running < this.maxConcurrent) {
      const job = this.pending[i];
      if (this.busy.has(job.lane)) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      this.busy.add(job.lane);
      this.running++;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.busy.delete(job.lane);
          this.running--;
          this.pump();
        });
    }
  }
}

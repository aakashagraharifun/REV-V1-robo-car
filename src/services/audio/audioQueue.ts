/**
 * Serial playback queue so speech and sound effects never talk over each
 * other. Each job gets an AbortSignal; `clear()` aborts the running job and
 * drops everything waiting.
 */
export type AudioJobKind = 'speech' | 'sound';

export interface AudioJob {
  kind: AudioJobKind;
  run(signal: AbortSignal): Promise<void>;
}

interface QueuedJob extends AudioJob {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class AudioQueue {
  private queue: QueuedJob[] = [];
  private current: { job: QueuedJob; controller: AbortController } | null = null;

  /** Called whenever playback starts (with its kind) or the queue drains (null). */
  onActivity: ((kind: AudioJobKind | null) => void) | null = null;

  get isBusy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** Resolves when the job finishes or is cancelled; rejects if it fails. */
  enqueue(job: AudioJob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      if (!this.current) void this.next();
    });
  }

  clear(): void {
    const pending = this.queue;
    this.queue = [];
    pending.forEach((job) => job.resolve());
    this.current?.controller.abort();
  }

  private async next(): Promise<void> {
    const job = this.queue.shift();
    if (!job) {
      this.current = null;
      this.onActivity?.(null);
      return;
    }
    const controller = new AbortController();
    this.current = { job, controller };
    this.onActivity?.(job.kind);
    try {
      await job.run(controller.signal);
      job.resolve();
    } catch (error) {
      if (controller.signal.aborted) job.resolve();
      else job.reject(error);
    }
    void this.next();
  }
}

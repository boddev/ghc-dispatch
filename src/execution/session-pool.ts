import type { CopilotAdapter, CopilotSession, SessionOptions } from './copilot-adapter.js';

export interface PoolOptions {
  maxConcurrent: number;
}

interface PoolEntry {
  session: CopilotSession;
  taskId: string;
  acquiredAt: Date;
}

export class SessionPool {
  private active = new Map<string, PoolEntry>();
  private maxConcurrent: number;

  constructor(
    private adapter: CopilotAdapter,
    options: PoolOptions,
  ) {
    this.maxConcurrent = options.maxConcurrent;
  }

  get size(): number {
    return this.active.size;
  }

  get available(): number {
    return this.maxConcurrent - this.active.size;
  }

  isFull(): boolean {
    return this.active.size >= this.maxConcurrent;
  }

  async acquire(taskId: string, options: SessionOptions): Promise<CopilotSession> {
    if (this.isFull()) {
      throw new Error(
        `Session pool full (${this.maxConcurrent} max). ` +
        `Active sessions: ${[...this.active.values()].map(e => e.taskId).join(', ')}`
      );
    }

    const session = await this.adapter.createSession(options);
    this.active.set(session.id, { session, taskId, acquiredAt: new Date() });
    return session;
  }

  async release(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (entry) {
      try {
        await entry.session.disconnect();
      } catch {
        // Best effort cleanup
      }
      this.active.delete(sessionId);
    }
  }

  async releaseByTask(taskId: string): Promise<void> {
    for (const [sessionId, entry] of this.active) {
      if (entry.taskId === taskId) {
        await this.release(sessionId);
        return;
      }
    }
  }

  async releaseAll(): Promise<void> {
    const releases = [...this.active.keys()].map(id => this.release(id));
    await Promise.allSettled(releases);
  }

  getActiveEntries(): Array<{ sessionId: string; taskId: string; acquiredAt: Date; model: string }> {
    return [...this.active.entries()].map(([sessionId, entry]) => ({
      sessionId,
      taskId: entry.taskId,
      acquiredAt: entry.acquiredAt,
      model: entry.session.model,
    }));
  }
}

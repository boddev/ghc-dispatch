import type { CopilotAdapter, CopilotSession, SessionOptions } from './copilot-adapter.js';

export interface PoolOptions {
  maxConcurrent: number;
  /**
   * When true, every newly acquired Copilot CLI session is steered into the
   * remote (cloud) runner by prepending `/remote\n` to its first prompt.
   * Subsequent sends on the same session are passed through unchanged.
   * Defaults to true so dispatched work runs on Copilot's remote agent runtime
   * by default.
   */
  defaultRemote?: boolean;
}

interface PoolEntry {
  session: CopilotSession;
  taskId: string;
  acquiredAt: Date;
}

/**
 * Wraps a session so the first call to `send` is prefixed with `/remote\n`.
 * Slash commands are interpreted by the Copilot CLI before the prompt is
 * dispatched to the model, so this switches the session into remote mode
 * without requiring per-call-site changes.
 */
function wrapWithRemoteSlashCommand(inner: CopilotSession): CopilotSession {
  let primed = false;
  return {
    id: inner.id,
    model: inner.model,
    async send(prompt: string) {
      if (!primed) {
        primed = true;
        await inner.send(`/remote\n${prompt}`);
        return;
      }
      await inner.send(prompt);
    },
    disconnect: () => inner.disconnect(),
    isActive: () => inner.isActive(),
  };
}

export class SessionPool {
  private active = new Map<string, PoolEntry>();
  private maxConcurrent: number;
  private defaultRemote: boolean;

  constructor(
    private adapter: CopilotAdapter,
    options: PoolOptions,
  ) {
    this.maxConcurrent = options.maxConcurrent;
    this.defaultRemote = options.defaultRemote ?? true;
  }

  get size(): number {
    return this.active.size;
  }

  get available(): number {
    return this.maxConcurrent - this.active.size;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  setMaxConcurrent(maxConcurrent: number): void {
    if (maxConcurrent < this.active.size) {
      throw new Error(`Cannot set max sessions to ${maxConcurrent}; ${this.active.size} session(s) are currently active`);
    }
    this.maxConcurrent = maxConcurrent;
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

    const rawSession = await this.adapter.createSession(options);
    const session = this.defaultRemote
      ? wrapWithRemoteSlashCommand(rawSession)
      : rawSession;
    this.active.set(rawSession.id, { session: rawSession, taskId, acquiredAt: new Date() });
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

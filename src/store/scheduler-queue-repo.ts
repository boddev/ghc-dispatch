import type Database from 'better-sqlite3';

export interface SchedulerQueueEntry {
  taskId: string;
  priority: number;
  enqueuedAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  heartbeatAt: number | null;
}

export class SchedulerQueueRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      enqueue: this.db.prepare(`
        INSERT INTO scheduler_queue (
          task_id, priority, enqueued_at, lease_owner, lease_expires_at,
          heartbeat_at, created_at, updated_at
        )
        VALUES (@taskId, @priority, @enqueuedAt, NULL, NULL, NULL, @nowIso, @nowIso)
        ON CONFLICT(task_id) DO UPDATE SET
          priority = @priority,
          enqueued_at = @enqueuedAt,
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = NULL,
          updated_at = @nowIso
      `),
      listAvailable: this.db.prepare(`
        SELECT * FROM scheduler_queue
        WHERE lease_owner IS NULL OR lease_expires_at <= @now
      `),
      listRunning: this.db.prepare(`
        SELECT * FROM scheduler_queue
        WHERE lease_owner IS NOT NULL AND lease_expires_at > @now
      `),
      acquire: this.db.prepare(`
        UPDATE scheduler_queue
        SET lease_owner = @leaseOwner,
            lease_expires_at = @leaseExpiresAt,
            heartbeat_at = @now,
            updated_at = @nowIso
        WHERE task_id = @taskId
          AND (lease_owner IS NULL OR lease_expires_at <= @now)
      `),
      heartbeatOwner: this.db.prepare(`
        UPDATE scheduler_queue
        SET lease_expires_at = @leaseExpiresAt,
            heartbeat_at = @now,
            updated_at = @nowIso
        WHERE lease_owner = @leaseOwner
          AND lease_expires_at > @now
      `),
      delete: this.db.prepare('DELETE FROM scheduler_queue WHERE task_id = ?'),
      countQueued: this.db.prepare(`
        SELECT COUNT(*) AS count FROM scheduler_queue
        WHERE lease_owner IS NULL OR lease_expires_at <= @now
      `),
      countRunning: this.db.prepare(`
        SELECT COUNT(*) AS count FROM scheduler_queue
        WHERE lease_owner IS NOT NULL AND lease_expires_at > @now
      `),
      getByTaskId: this.db.prepare('SELECT * FROM scheduler_queue WHERE task_id = ?'),
      deleteMissingTask: this.db.prepare('DELETE FROM scheduler_queue WHERE task_id = ?'),
    };
  }

  enqueue(taskId: string, priority: number, enqueuedAt = Date.now()): void {
    this.stmts.enqueue.run({
      taskId,
      priority,
      enqueuedAt,
      nowIso: new Date().toISOString(),
    });
  }

  listAvailable(now = Date.now()): SchedulerQueueEntry[] {
    return (this.stmts.listAvailable.all({ now }) as any[]).map(this.rowToEntry);
  }

  listRunning(now = Date.now()): SchedulerQueueEntry[] {
    return (this.stmts.listRunning.all({ now }) as any[]).map(this.rowToEntry);
  }

  acquire(taskId: string, leaseOwner: string, leaseMs: number, now = Date.now()): boolean {
    const changes = this.stmts.acquire.run({
      taskId,
      leaseOwner,
      now,
      leaseExpiresAt: now + leaseMs,
      nowIso: new Date(now).toISOString(),
    }).changes;
    return changes > 0;
  }

  heartbeatOwner(leaseOwner: string, leaseMs: number, now = Date.now()): number {
    return this.stmts.heartbeatOwner.run({
      leaseOwner,
      now,
      leaseExpiresAt: now + leaseMs,
      nowIso: new Date(now).toISOString(),
    }).changes;
  }

  delete(taskId: string): boolean {
    return this.stmts.delete.run(taskId).changes > 0;
  }

  countQueued(now = Date.now()): number {
    return (this.stmts.countQueued.get({ now }) as { count: number }).count;
  }

  countRunning(now = Date.now()): number {
    return (this.stmts.countRunning.get({ now }) as { count: number }).count;
  }

  getByTaskId(taskId: string): SchedulerQueueEntry | undefined {
    const row = this.stmts.getByTaskId.get(taskId) as any;
    return row ? this.rowToEntry(row) : undefined;
  }

  private rowToEntry(row: any): SchedulerQueueEntry {
    return {
      taskId: row.task_id,
      priority: row.priority,
      enqueuedAt: row.enqueued_at,
      leaseOwner: row.lease_owner ?? null,
      leaseExpiresAt: row.lease_expires_at ?? null,
      heartbeatAt: row.heartbeat_at ?? null,
    };
  }
}

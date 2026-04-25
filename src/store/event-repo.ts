import type Database from 'better-sqlite3';
import type { OrchestratorEvent } from '../control-plane/task-model.js';

export interface StoredEvent {
  id: number;
  type: string;
  taskId: string | null;
  payload: OrchestratorEvent;
  timestamp: string;
}

export class EventRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      append: this.db.prepare(`
        INSERT INTO events (type, task_id, payload, timestamp)
        VALUES (@type, @taskId, @payload, @timestamp)
      `),
      getByTaskId: this.db.prepare(`
        SELECT * FROM events WHERE task_id = ? ORDER BY id ASC
      `),
      getByType: this.db.prepare(`
        SELECT * FROM events WHERE type = ? ORDER BY id ASC LIMIT ? OFFSET ?
      `),
      getRecent: this.db.prepare(`
        SELECT * FROM events ORDER BY id DESC LIMIT ?
      `),
      getSince: this.db.prepare(`
        SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?
      `),
      getByTaskIdAndType: this.db.prepare(`
        SELECT * FROM events WHERE task_id = ? AND type = ? ORDER BY id ASC
      `),
      count: this.db.prepare('SELECT COUNT(*) as count FROM events'),
      countByType: this.db.prepare('SELECT type, COUNT(*) as count FROM events GROUP BY type'),
      deleteOlderThan: this.db.prepare('DELETE FROM events WHERE timestamp < ?'),
    };
  }

  append(event: OrchestratorEvent): number {
    const taskId = 'taskId' in event ? event.taskId : null;
    const result = this.stmts.append.run({
      type: event.type,
      taskId,
      payload: JSON.stringify(event),
      timestamp: new Date().toISOString(),
    });
    return result.lastInsertRowid as number;
  }

  appendBatch(events: OrchestratorEvent[]): void {
    const tx = this.db.transaction((evts: OrchestratorEvent[]) => {
      for (const event of evts) {
        this.append(event);
      }
    });
    tx(events);
  }

  getByTaskId(taskId: string): StoredEvent[] {
    return (this.stmts.getByTaskId.all(taskId) as any[]).map(this.rowToEvent);
  }

  getByType(type: string, limit = 100, offset = 0): StoredEvent[] {
    return (this.stmts.getByType.all(type, limit, offset) as any[]).map(this.rowToEvent);
  }

  getRecent(limit = 50): StoredEvent[] {
    return (this.stmts.getRecent.all(limit) as any[]).map(this.rowToEvent);
  }

  getSince(afterId: number, limit = 100): StoredEvent[] {
    return (this.stmts.getSince.all(afterId, limit) as any[]).map(this.rowToEvent);
  }

  getByTaskIdAndType(taskId: string, type: string): StoredEvent[] {
    return (this.stmts.getByTaskIdAndType.all(taskId, type) as any[]).map(this.rowToEvent);
  }

  count(): number {
    return (this.stmts.count.get() as { count: number }).count;
  }

  countByType(): Record<string, number> {
    const rows = this.stmts.countByType.all() as { type: string; count: number }[];
    return Object.fromEntries(rows.map(r => [r.type, r.count]));
  }

  deleteOlderThan(isoDate: string): number {
    return this.stmts.deleteOlderThan.run(isoDate).changes;
  }

  private rowToEvent(row: any): StoredEvent {
    return {
      id: row.id,
      type: row.type,
      taskId: row.task_id,
      payload: JSON.parse(row.payload),
      timestamp: row.timestamp,
    };
  }
}

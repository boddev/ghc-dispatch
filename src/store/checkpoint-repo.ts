import type Database from 'better-sqlite3';
import type { Checkpoint } from '../control-plane/task-model.js';

export class CheckpointRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO checkpoints (id, task_id, timestamp, description, session_state, artifacts)
        VALUES (@id, @taskId, @timestamp, @description, @sessionState, @artifacts)
      `),
      getLatestByTask: this.db.prepare(`
        SELECT * FROM checkpoints
        WHERE task_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `),
      getByTask: this.db.prepare(`
        SELECT * FROM checkpoints
        WHERE task_id = ?
        ORDER BY timestamp ASC
      `),
    };
  }

  insert(checkpoint: Checkpoint): void {
    this.stmts.insert.run({
      id: checkpoint.id,
      taskId: checkpoint.taskId,
      timestamp: checkpoint.timestamp,
      description: checkpoint.description,
      sessionState: checkpoint.sessionState,
      artifacts: JSON.stringify(checkpoint.artifacts),
    });
  }

  getLatestByTask(taskId: string): Checkpoint | undefined {
    const row = this.stmts.getLatestByTask.get(taskId) as any;
    return row ? this.rowToCheckpoint(row) : undefined;
  }

  getByTask(taskId: string): Checkpoint[] {
    return (this.stmts.getByTask.all(taskId) as any[]).map(this.rowToCheckpoint);
  }

  private rowToCheckpoint(row: any): Checkpoint {
    return {
      id: row.id,
      taskId: row.task_id,
      timestamp: row.timestamp,
      description: row.description,
      sessionState: row.session_state,
      artifacts: JSON.parse(row.artifacts),
    };
  }
}

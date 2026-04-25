import type Database from 'better-sqlite3';
import type { Task, CreateTaskInput, TaskStatus, TaskResult } from '../control-plane/task-model.js';
import { ulid } from 'ulid';

export class TaskRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO tasks (id, title, description, status, priority, agent, repo,
          parent_task_id, depends_on, created_by, created_at, updated_at, max_retries, metadata)
        VALUES (@id, @title, @description, @status, @priority, @agent, @repo,
          @parentTaskId, @dependsOn, @createdBy, @createdAt, @updatedAt, @maxRetries, @metadata)
      `),
      getById: this.db.prepare('SELECT * FROM tasks WHERE id = ?'),
      updateStatus: this.db.prepare(`
        UPDATE tasks SET status = @status, updated_at = @updatedAt WHERE id = @id
      `),
      setResult: this.db.prepare(`
        UPDATE tasks SET result = @result, completed_at = @completedAt, status = @status, updated_at = @updatedAt
        WHERE id = @id
      `),
      incrementRetry: this.db.prepare(`
        UPDATE tasks SET retry_count = retry_count + 1, updated_at = @updatedAt WHERE id = @id
      `),
      listByStatus: this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority, created_at'),
      listAll: this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?'),
      listByParent: this.db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at'),
      countByStatus: this.db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
      setWorkingDirectory: this.db.prepare(`
        UPDATE tasks SET working_directory = @workingDirectory, updated_at = @updatedAt WHERE id = @id
      `),
    };
  }

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const id = ulid();
    const row = {
      id,
      title: input.title,
      description: input.description,
      status: 'pending' as const,
      priority: input.priority,
      agent: input.agent,
      repo: input.repo ?? null,
      parentTaskId: input.parentTaskId ?? null,
      dependsOn: JSON.stringify(input.dependsOn),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      maxRetries: input.maxRetries,
      metadata: JSON.stringify(input.metadata),
    };
    this.stmts.insert.run(row);
    return this.getById(id)!;
  }

  getById(id: string): Task | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToTask(row) : undefined;
  }

  updateStatus(id: string, status: TaskStatus): void {
    this.stmts.updateStatus.run({ id, status, updatedAt: new Date().toISOString() });
  }

  setResult(id: string, status: 'completed' | 'failed', result: TaskResult): void {
    this.stmts.setResult.run({
      id,
      status,
      result: JSON.stringify(result),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  incrementRetry(id: string): void {
    this.stmts.incrementRetry.run({ id, updatedAt: new Date().toISOString() });
  }

  listByStatus(status: TaskStatus): Task[] {
    const rows = this.stmts.listByStatus.all(status) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  listAll(limit = 50, offset = 0): Task[] {
    const rows = this.stmts.listAll.all(limit, offset) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  listByParent(parentId: string): Task[] {
    const rows = this.stmts.listByParent.all(parentId) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  countByStatus(): Record<string, number> {
    const rows = this.stmts.countByStatus.all() as { status: string; count: number }[];
    return Object.fromEntries(rows.map(r => [r.status, r.count]));
  }

  setWorkingDirectory(id: string, workingDirectory: string): void {
    this.stmts.setWorkingDirectory.run({ id, workingDirectory, updatedAt: new Date().toISOString() });
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      agent: row.agent,
      repo: row.repo ?? undefined,
      workingDirectory: row.working_directory ?? undefined,
      parentTaskId: row.parent_task_id ?? undefined,
      dependsOn: JSON.parse(row.depends_on),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      metadata: JSON.parse(row.metadata),
    };
  }
}

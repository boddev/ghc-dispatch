import type Database from 'better-sqlite3';
import type { Task, CreateTaskInput, TaskStatus, TaskResult, UpdateTaskInput } from '../control-plane/task-model.js';
import { ulid } from 'ulid';

export class TaskRepo {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO tasks (id, title, description, status, priority, agent, repo, working_directory,
          parent_task_id, depends_on, created_by, created_at, updated_at, max_retries, metadata)
        VALUES (@id, @title, @description, @status, @priority, @agent, @repo, @workingDirectory,
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
      listByStatus: this.db.prepare(`
        SELECT * FROM tasks WHERE status = ?
        ORDER BY CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high'     THEN 1
          WHEN 'normal'   THEN 2
          WHEN 'low'      THEN 3
          ELSE 4 END,
        created_at
      `),
      listAll: this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?'),
      listByParent: this.db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at'),
      countByStatus: this.db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
      setWorkingDirectory: this.db.prepare(`
        UPDATE tasks SET working_directory = @workingDirectory, updated_at = @updatedAt WHERE id = @id
      `),
      updateMetadata: this.db.prepare(`
        UPDATE tasks SET metadata = @metadata, updated_at = @updatedAt WHERE id = @id
      `),
      updateTask: this.db.prepare(`
        UPDATE tasks SET
          title = @title,
          description = @description,
          priority = @priority,
          agent = @agent,
          repo = @repo,
          working_directory = @workingDirectory,
          depends_on = @dependsOn,
          max_retries = @maxRetries,
          metadata = @metadata,
          updated_at = @updatedAt
        WHERE id = @id
      `),
      deleteTaskData: this.db.prepare(`
        DELETE FROM scheduler_queue WHERE task_id = ?
      `),
      deleteApprovals: this.db.prepare(`
        DELETE FROM approvals WHERE task_id = ?
      `),
      deleteCheckpoints: this.db.prepare(`
        DELETE FROM checkpoints WHERE task_id = ?
      `),
      deleteEvents: this.db.prepare(`
        DELETE FROM events WHERE task_id = ?
      `),
      deleteTask: this.db.prepare(`
        DELETE FROM tasks WHERE id = ?
      `),
      listDependencyRows: this.db.prepare(`
        SELECT id, depends_on FROM tasks
      `),
      updateDependsOn: this.db.prepare(`
        UPDATE tasks SET depends_on = @dependsOn, updated_at = @updatedAt WHERE id = @id
      `),
    };
  }

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const id = ulid();
    const metadata = { ...(input.metadata ?? {}) };
    if (input.model) metadata.model = input.model;
    const row = {
      id,
      title: input.title,
      description: input.description ?? '',
      status: 'pending' as const,
      priority: input.priority ?? 'normal',
      agent: input.agent ?? '@general-purpose',
      repo: input.repo ?? null,
      workingDirectory: input.workingDirectory ?? null,
      parentTaskId: input.parentTaskId ?? null,
      dependsOn: JSON.stringify(input.dependsOn ?? []),
      createdBy: input.createdBy ?? 'cli',
      createdAt: now,
      updatedAt: now,
      maxRetries: input.maxRetries ?? 3,
      metadata: JSON.stringify(metadata),
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

  setWorkingDirectory(id: string, workingDirectory: string | null): void {
    this.stmts.setWorkingDirectory.run({ id, workingDirectory, updatedAt: new Date().toISOString() });
  }

  updateMetadata(id: string, metadata: Record<string, unknown>): void {
    this.stmts.updateMetadata.run({
      id,
      metadata: JSON.stringify(metadata),
      updatedAt: new Date().toISOString(),
    });
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const current = this.getById(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    const metadata = { ...current.metadata };
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      if (value === null) delete metadata[key];
      else metadata[key] = value;
    }
    if (input.model === null) delete metadata.model;
    else if (typeof input.model === 'string') metadata.model = input.model;
    this.stmts.updateTask.run({
      id,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      priority: input.priority ?? current.priority,
      agent: input.agent ?? current.agent,
      repo: input.repo === undefined ? (current.repo ?? null) : input.repo,
      workingDirectory: input.workingDirectory === undefined ? (current.workingDirectory ?? null) : input.workingDirectory,
      dependsOn: JSON.stringify(input.dependsOn ?? current.dependsOn),
      maxRetries: input.maxRetries ?? current.maxRetries,
      metadata: JSON.stringify(metadata),
      updatedAt: new Date().toISOString(),
    });
    return this.getById(id)!;
  }

  deleteMany(ids: string[]): number {
    if (ids.length === 0) return 0;
    const uniqueIds = [...new Set(ids)];
    const deletedIds = new Set(uniqueIds);
    const tx = this.db.transaction(() => {
      this.removeDependencyReferences(deletedIds);
      let deleted = 0;
      for (const id of uniqueIds) {
        this.stmts.deleteTaskData.run(id);
        this.stmts.deleteApprovals.run(id);
        this.stmts.deleteCheckpoints.run(id);
        this.stmts.deleteEvents.run(id);
        deleted += this.stmts.deleteTask.run(id).changes;
      }
      return deleted;
    });
    return tx();
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

  private removeDependencyReferences(deletedIds: Set<string>): void {
    const rows = this.stmts.listDependencyRows.all() as Array<{ id: string; depends_on: string }>;
    const updatedAt = new Date().toISOString();
    for (const row of rows) {
      if (deletedIds.has(row.id)) continue;
      const dependsOn = JSON.parse(row.depends_on) as string[];
      const nextDependsOn = dependsOn.filter(id => !deletedIds.has(id));
      if (nextDependsOn.length === dependsOn.length) continue;
      this.stmts.updateDependsOn.run({
        id: row.id,
        dependsOn: JSON.stringify(nextDependsOn),
        updatedAt,
      });
    }
  }
}

import type { Checkpoint, Task, TaskStatus, TaskResult } from './task-model.js';
import { assertTransition, CreateTaskInput, UpdateTaskInput } from './task-model.js';
import type { TaskRepo } from '../store/task-repo.js';
import type { EventRepo } from '../store/event-repo.js';
import type { EventBus } from './event-bus.js';
import type { CheckpointRepo } from '../store/checkpoint-repo.js';
import type { z } from 'zod';

type CreateTaskInputType = z.input<typeof CreateTaskInput>;
type UpdateTaskInputType = z.input<typeof UpdateTaskInput>;

export class TaskManager {
  constructor(
    private taskRepo: TaskRepo,
    private eventRepo: EventRepo,
    private eventBus: EventBus,
    private checkpointRepo?: CheckpointRepo,
  ) {}

  createTask(rawInput: CreateTaskInputType): Task {
    const input = CreateTaskInput.parse(rawInput);
    let task!: Task;
    const event = this.eventRepo.transaction(() => {
      task = this.taskRepo.create(input);
      const created = { type: 'task.created' as const, taskId: task.id, data: { ...input } };
      this.eventRepo.append(created);
      return created;
    });
    this.eventBus.emit(event);

    return task;
  }

  getTask(id: string): Task | undefined {
    return this.taskRepo.getById(id);
  }

  listTasks(status?: TaskStatus, limit = 50, offset = 0): Task[] {
    if (status) {
      return this.taskRepo.listByStatus(status);
    }
    return this.taskRepo.listAll(limit, offset);
  }

  getSubtasks(parentId: string): Task[] {
    return this.taskRepo.listByParent(parentId);
  }

  getStats(): Record<string, number> {
    return this.taskRepo.countByStatus();
  }

  updateTask(id: string, rawInput: UpdateTaskInputType): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (task.status === 'running') throw new Error('Cannot edit a running task');
    const input = UpdateTaskInput.parse(rawInput);
    const updated = this.taskRepo.updateTask(id, input);
    const event = { type: 'task.updated' as const, taskId: id, data: input as Record<string, unknown> };
    this.eventRepo.append(event);
    this.eventBus.emit(event);
    return updated;
  }

  transitionTask(id: string, to: TaskStatus, detail?: Record<string, unknown>): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    assertTransition(task.status, to);

    const events = this.eventRepo.transaction(() => {
      this.taskRepo.updateStatus(id, to);

      const emitted: any[] = [];
      if (to === 'queued' && task.status === 'paused') {
        emitted.push({ type: 'task.resumed' as const, taskId: id });
      }

      const eventMap: Record<string, () => any> = {
        queued: () => ({ type: 'task.queued' as const, taskId: id, position: 0 }),
        running: () => ({ type: 'task.started' as const, taskId: id, sessionId: detail?.sessionId ?? 'unknown' }),
        paused: () => ({ type: 'task.paused' as const, taskId: id, reason: detail?.reason ?? '' }),
        cancelled: () => ({ type: 'task.cancelled' as const, taskId: id, reason: detail?.reason ?? '' }),
      };

      const eventFactory = eventMap[to];
      if (eventFactory) emitted.push(eventFactory());

      for (const event of emitted) this.eventRepo.append(event);
      return emitted;
    });

    for (const event of events) this.eventBus.emit(event);

    return this.taskRepo.getById(id)!;
  }

  completeTask(id: string, result: TaskResult): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    assertTransition(task.status, result.success ? 'completed' : 'failed');

    const event = this.eventRepo.transaction(() => {
      const status = result.success ? 'completed' : 'failed';
      this.taskRepo.setResult(id, status as 'completed' | 'failed', result);
      const completed = result.success
        ? { type: 'task.completed' as const, taskId: id, result }
        : { type: 'task.failed' as const, taskId: id, error: result.error ?? 'Unknown error' };
      this.eventRepo.append(completed);
      return completed;
    });
    this.eventBus.emit(event);

    return this.taskRepo.getById(id)!;
  }

  /** Queue a task for execution (pending → queued) */
  enqueueTask(id: string): Task {
    return this.transitionTask(id, 'queued');
  }

  /** Cancel a task that hasn't completed */
  cancelTask(id: string, reason = 'User cancelled'): Task {
    return this.transitionTask(id, 'cancelled', { reason });
  }

  deleteTask(id: string, options: { recursive?: boolean } = {}): { deletedTaskIds: string[] } {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const deletedTaskIds = this.collectTaskTreeIds(id);
    if (!options.recursive && deletedTaskIds.length > 1) {
      throw new Error(`Task ${id} has ${deletedTaskIds.length - 1} subtask(s). Use recursive deletion to delete them too.`);
    }

    const tasks = deletedTaskIds.map(taskId => this.taskRepo.getById(taskId)).filter(Boolean) as Task[];
    const running = tasks.find(t => t.status === 'running');
    if (running) {
      throw new Error(`Cannot delete running task ${running.id}. Cancel it before deleting.`);
    }

    const event = this.eventRepo.transaction(() => {
      this.taskRepo.deleteMany(deletedTaskIds);
      const deleted = { type: 'task.deleted' as const, taskId: id, deletedTaskIds };
      this.eventRepo.append(deleted);
      return deleted;
    });
    this.eventBus.emit(event);

    return { deletedTaskIds };
  }

  /** Retry a failed, cancelled, or paused task (→ queued, increments retry counter) */
  retryTask(id: string): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    if (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'paused') {
      throw new Error(`Can only retry failed, cancelled, or paused tasks, current status: ${task.status}`);
    }
    if (task.retryCount >= task.maxRetries) {
      throw new Error(`Max retries (${task.maxRetries}) exceeded for task ${id}`);
    }

    const retryEvent = this.eventRepo.transaction(() => {
      this.taskRepo.incrementRetry(id);
      const event = { type: 'task.retrying' as const, taskId: id, attempt: task.retryCount + 1 };
      this.eventRepo.append(event);
      return event;
    });
    this.eventBus.emit(retryEvent);

    return this.transitionTask(id, 'queued');
  }

  /** Record task output (append to event stream without state change) */
  recordOutput(taskId: string, content: string): void {
    const event = { type: 'task.output' as const, taskId, content };
    this.eventRepo.append(event);
    this.eventBus.emit(event);
  }

  /** Get the event history for a task */
  getTaskEvents(taskId: string) {
    return this.eventRepo.getByTaskId(taskId);
  }

  recordCheckpoint(checkpoint: Checkpoint): void {
    if (!this.checkpointRepo) throw new Error('Checkpoint repository not configured');
    const event = this.eventRepo.transaction(() => {
      this.checkpointRepo!.insert(checkpoint);
      const checkpointEvent = { type: 'task.checkpoint' as const, taskId: checkpoint.taskId, checkpoint };
      this.eventRepo.append(checkpointEvent);
      return checkpointEvent;
    });
    this.eventBus.emit(event);
  }

  getLatestCheckpoint(taskId: string): Checkpoint | undefined {
    return this.checkpointRepo?.getLatestByTask(taskId);
  }

  setWorkingDirectory(taskId: string, workingDirectory: string | null): void {
    this.taskRepo.setWorkingDirectory(taskId, workingDirectory);
  }

  updateTaskMetadata(taskId: string, metadata: Record<string, unknown>): Task {
    this.taskRepo.updateMetadata(taskId, metadata);
    const task = this.taskRepo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  prepareRecovery(taskId: string, recovery: Record<string, unknown>): Task {
    const task = this.taskRepo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    this.taskRepo.updateMetadata(taskId, { ...task.metadata, recovery });
    if (task.status === 'running') {
      return this.transitionTask(taskId, 'paused', { reason: 'Interrupted by daemon restart; awaiting recovery action' });
    }
    return this.taskRepo.getById(taskId)!;
  }

  resumeRecoveredTask(taskId: string, action: 'resume' | 'restart'): Task {
    const task = this.taskRepo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== 'paused') throw new Error(`Can only recover paused tasks, current status: ${task.status}`);

    const recovery = {
      ...(task.metadata.recovery as Record<string, unknown> | undefined),
      selectedAction: action,
      selectedAt: new Date().toISOString(),
    };
    this.taskRepo.updateMetadata(taskId, { ...task.metadata, recovery });
    if (action === 'restart') this.taskRepo.setWorkingDirectory(taskId, null);
    return this.transitionTask(taskId, 'queued');
  }

  /** Check if a task's dependencies are all completed */
  areDependenciesMet(task: Task): boolean {
    if (task.dependsOn.length === 0) return true;
    return task.dependsOn.every(depId => {
      const dep = this.taskRepo.getById(depId);
      return dep?.status === 'completed';
    });
  }

  private collectTaskTreeIds(rootTaskId: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const visit = (taskId: string) => {
      if (seen.has(taskId)) return;
      seen.add(taskId);
      ids.push(taskId);
      for (const child of this.taskRepo.listByParent(taskId)) {
        visit(child.id);
      }
    };
    visit(rootTaskId);
    return ids;
  }
}

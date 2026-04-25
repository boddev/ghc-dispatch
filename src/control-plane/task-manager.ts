import type { Task, TaskStatus, TaskResult } from './task-model.js';
import { assertTransition, CreateTaskInput } from './task-model.js';
import type { TaskRepo } from '../store/task-repo.js';
import type { EventRepo } from '../store/event-repo.js';
import type { EventBus } from './event-bus.js';
import type { z } from 'zod';

type CreateTaskInputType = z.input<typeof CreateTaskInput>;

export class TaskManager {
  constructor(
    private taskRepo: TaskRepo,
    private eventRepo: EventRepo,
    private eventBus: EventBus,
  ) {}

  createTask(rawInput: CreateTaskInputType): Task {
    const input = CreateTaskInput.parse(rawInput);
    const task = this.taskRepo.create(input);

    const event = { type: 'task.created' as const, taskId: task.id, data: { ...input } };
    this.eventRepo.append(event);
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

  transitionTask(id: string, to: TaskStatus, detail?: Record<string, unknown>): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    assertTransition(task.status, to);
    this.taskRepo.updateStatus(id, to);

    const eventMap: Record<string, () => any> = {
      queued: () => ({ type: 'task.queued' as const, taskId: id, position: 0 }),
      running: () => ({ type: 'task.started' as const, taskId: id, sessionId: detail?.sessionId ?? 'unknown' }),
      paused: () => ({ type: 'task.paused' as const, taskId: id, reason: detail?.reason ?? '' }),
      cancelled: () => ({ type: 'task.cancelled' as const, taskId: id, reason: detail?.reason ?? '' }),
    };

    const eventFactory = eventMap[to];
    if (eventFactory) {
      const event = eventFactory();
      this.eventRepo.append(event);
      this.eventBus.emit(event);
    }

    return this.taskRepo.getById(id)!;
  }

  completeTask(id: string, result: TaskResult): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    assertTransition(task.status, result.success ? 'completed' : 'failed');

    const status = result.success ? 'completed' : 'failed';
    this.taskRepo.setResult(id, status as 'completed' | 'failed', result);

    if (result.success) {
      const event = { type: 'task.completed' as const, taskId: id, result };
      this.eventRepo.append(event);
      this.eventBus.emit(event);
    } else {
      const event = { type: 'task.failed' as const, taskId: id, error: result.error ?? 'Unknown error' };
      this.eventRepo.append(event);
      this.eventBus.emit(event);
    }

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

  /** Retry a failed task (failed → queued, increments retry counter) */
  retryTask(id: string): Task {
    const task = this.taskRepo.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    if (task.status !== 'failed') {
      throw new Error(`Can only retry failed tasks, current status: ${task.status}`);
    }
    if (task.retryCount >= task.maxRetries) {
      throw new Error(`Max retries (${task.maxRetries}) exceeded for task ${id}`);
    }

    this.taskRepo.incrementRetry(id);

    const retryEvent = { type: 'task.retrying' as const, taskId: id, attempt: task.retryCount + 1 };
    this.eventRepo.append(retryEvent);
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

  /** Check if a task's dependencies are all completed */
  areDependenciesMet(task: Task): boolean {
    if (task.dependsOn.length === 0) return true;
    return task.dependsOn.every(depId => {
      const dep = this.taskRepo.getById(depId);
      return dep?.status === 'completed';
    });
  }
}

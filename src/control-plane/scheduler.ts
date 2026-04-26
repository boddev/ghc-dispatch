import type { Task, TaskStatus } from './task-model.js';
import type { TaskRepo } from '../store/task-repo.js';
import type { EventBus } from './event-bus.js';

export interface SchedulerConfig {
  maxGlobalConcurrent: number;
  maxPerRepo: number;
  maxPerUser: number;
  agingBoostMs: number;
}

interface QueueEntry {
  taskId: string;
  priority: number;
  enqueuedAt: number;
}

const PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export class Scheduler {
  private queue: QueueEntry[] = [];
  private runningByRepo = new Map<string, Set<string>>();
  private runningByUser = new Map<string, Set<string>>();
  private totalRunning = 0;

  constructor(
    private taskRepo: TaskRepo,
    private eventBus: EventBus,
    private config: SchedulerConfig,
  ) {}

  enqueue(task: Task): number {
    const entry: QueueEntry = {
      taskId: task.id,
      priority: PRIORITY_WEIGHTS[task.priority] ?? 2,
      enqueuedAt: Date.now(),
    };
    this.queue.push(entry);
    this.sortQueue();
    return this.queue.findIndex(e => e.taskId === task.id);
  }

  dequeue(): string | null {
    if (this.queue.length === 0) return null;
    if (this.totalRunning >= this.config.maxGlobalConcurrent) return null;

    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      const task = this.taskRepo.getById(entry.taskId);
      if (!task) { this.queue.splice(i, 1); i--; continue; }

      if (this.canAdmit(task)) {
        this.queue.splice(i, 1);
        this.markRunning(task);
        return task.id;
      }
    }
    return null;
  }

  markCompleted(task: Task): void {
    this.totalRunning = Math.max(0, this.totalRunning - 1);

    if (task.repo) {
      const repoSet = this.runningByRepo.get(task.repo);
      if (repoSet) { repoSet.delete(task.id); if (repoSet.size === 0) this.runningByRepo.delete(task.repo); }
    }
    const userSet = this.runningByUser.get(task.createdBy);
    if (userSet) { userSet.delete(task.id); if (userSet.size === 0) this.runningByUser.delete(task.createdBy); }
  }

  cancel(taskId: string): boolean {
    const idx = this.queue.findIndex(e => e.taskId === taskId);
    if (idx >= 0) { this.queue.splice(idx, 1); return true; }
    return false;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.totalRunning;
  }

  getQueueSnapshot(): Array<{ taskId: string; position: number; priority: string }> {
    return this.queue.map((e, i) => ({
      taskId: e.taskId,
      position: i,
      priority: Object.entries(PRIORITY_WEIGHTS).find(([, v]) => v === e.priority)?.[0] ?? 'normal',
    }));
  }

  private canAdmit(task: Task): boolean {
    if (this.totalRunning >= this.config.maxGlobalConcurrent) return false;

    if (task.repo) {
      const repoRunning = this.runningByRepo.get(task.repo)?.size ?? 0;
      if (repoRunning >= this.config.maxPerRepo) return false;
    }

    const userRunning = this.runningByUser.get(task.createdBy)?.size ?? 0;
    if (userRunning >= this.config.maxPerUser) return false;

    return true;
  }

  private markRunning(task: Task): void {
    this.totalRunning++;

    if (task.repo) {
      if (!this.runningByRepo.has(task.repo)) this.runningByRepo.set(task.repo, new Set());
      this.runningByRepo.get(task.repo)!.add(task.id);
    }

    if (!this.runningByUser.has(task.createdBy)) this.runningByUser.set(task.createdBy, new Set());
    this.runningByUser.get(task.createdBy)!.add(task.id);
  }

  private sortQueue(): void {
    const now = Date.now();
    this.queue.sort((a, b) => {
      // Aging boost: reduce effective priority for long-waiting tasks
      const ageA = (now - a.enqueuedAt) / this.config.agingBoostMs;
      const ageB = (now - b.enqueuedAt) / this.config.agingBoostMs;
      const effectiveA = a.priority - ageA;
      const effectiveB = b.priority - ageB;
      return effectiveA - effectiveB;
    });
  }
}

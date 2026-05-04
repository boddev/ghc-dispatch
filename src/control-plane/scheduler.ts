import type { Task, TaskStatus } from './task-model.js';
import type { TaskRepo } from '../store/task-repo.js';
import type { EventBus } from './event-bus.js';
import type { SchedulerQueueRepo, SchedulerQueueEntry } from '../store/scheduler-queue-repo.js';

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
    private queueRepo?: SchedulerQueueRepo,
    private leaseOwner = `scheduler-${process.pid}-${Date.now()}`,
    private leaseMs = 5 * 60_000,
  ) {}

  enqueue(task: Task): number {
    if (this.queueRepo) {
      this.queueRepo.enqueue(task.id, PRIORITY_WEIGHTS[task.priority] ?? 2);
      return this.getQueueSnapshot().findIndex(e => e.taskId === task.id);
    }

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
    if (this.queueRepo) return this.dequeueDurable();

    if (this.queue.length === 0) return null;
    if (this.totalRunning >= this.config.maxGlobalConcurrent) return null;

    // Re-sort so aging boost actually advances long-waiting tasks; without
    // this, the sort order is frozen at enqueue time and starvation is
    // possible when high-priority tasks keep arriving.
    this.sortQueue();

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
    if (this.queueRepo) {
      this.queueRepo.delete(task.id);
      return;
    }

    this.totalRunning = Math.max(0, this.totalRunning - 1);

    if (task.repo) {
      const repoSet = this.runningByRepo.get(task.repo);
      if (repoSet) { repoSet.delete(task.id); if (repoSet.size === 0) this.runningByRepo.delete(task.repo); }
    }
    const userSet = this.runningByUser.get(task.createdBy);
    if (userSet) { userSet.delete(task.id); if (userSet.size === 0) this.runningByUser.delete(task.createdBy); }
  }

  cancel(taskId: string): boolean {
    if (this.queueRepo) return this.queueRepo.delete(taskId);

    const idx = this.queue.findIndex(e => e.taskId === taskId);
    if (idx >= 0) { this.queue.splice(idx, 1); return true; }
    return false;
  }

  get queueLength(): number {
    if (this.queueRepo) return this.queueRepo.countQueued();
    return this.queue.length;
  }

  get runningCount(): number {
    if (this.queueRepo) return this.queueRepo.countRunning();
    return this.totalRunning;
  }

  getQueueSnapshot(): Array<{ taskId: string; position: number; priority: string }> {
    if (this.queueRepo) {
      const now = Date.now();
      return this.sortDurableEntries(this.queueRepo.listAvailable(now), now).map((e, i) => ({
        taskId: e.taskId,
        position: i,
        priority: this.priorityName(e.priority),
      }));
    }

    return this.queue.map((e, i) => ({
      taskId: e.taskId,
      position: i,
      priority: this.priorityName(e.priority),
    }));
  }

  heartbeatActiveLeases(): number {
    if (!this.queueRepo) return 0;
    return this.queueRepo.heartbeatOwner(this.leaseOwner, this.leaseMs);
  }

  getLeaseOwner(): string {
    return this.leaseOwner;
  }

  setConcurrency(maxGlobalConcurrent: number): void {
    if (maxGlobalConcurrent < this.runningCount) {
      throw new Error(`Cannot set max concurrency to ${maxGlobalConcurrent}; ${this.runningCount} task(s) are currently running`);
    }
    this.config = {
      ...this.config,
      maxGlobalConcurrent,
      maxPerRepo: Math.max(1, Math.floor(maxGlobalConcurrent / 2)),
      maxPerUser: maxGlobalConcurrent,
    };
  }

  private canAdmit(task: Task): boolean {
    if (this.queueRepo) {
      const running = this.queueRepo.listRunning().map(e => this.taskRepo.getById(e.taskId)).filter(Boolean) as Task[];
      if (running.length >= this.config.maxGlobalConcurrent) return false;
      if (task.repo && running.filter(t => t.repo === task.repo).length >= this.config.maxPerRepo) return false;
      if (running.filter(t => t.createdBy === task.createdBy).length >= this.config.maxPerUser) return false;
      return true;
    }

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

  private dequeueDurable(): string | null {
    const now = Date.now();
    if (this.queueRepo!.countQueued(now) === 0) return null;
    if (this.queueRepo!.countRunning(now) >= this.config.maxGlobalConcurrent) return null;

    for (const entry of this.sortDurableEntries(this.queueRepo!.listAvailable(now), now)) {
      const task = this.taskRepo.getById(entry.taskId);
      if (!task) { this.queueRepo!.delete(entry.taskId); continue; }

      if (this.canAdmit(task) && this.queueRepo!.acquire(task.id, this.leaseOwner, this.leaseMs, now)) {
        return task.id;
      }
    }

    return null;
  }

  private sortDurableEntries(entries: SchedulerQueueEntry[], now: number): SchedulerQueueEntry[] {
    return [...entries].sort((a, b) => {
      const effectiveA = a.priority - ((now - a.enqueuedAt) / this.config.agingBoostMs);
      const effectiveB = b.priority - ((now - b.enqueuedAt) / this.config.agingBoostMs);
      return effectiveA - effectiveB;
    });
  }

  private priorityName(priority: number): string {
    return Object.entries(PRIORITY_WEIGHTS).find(([, v]) => v === priority)?.[0] ?? 'normal';
  }
}

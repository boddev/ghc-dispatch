import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../../src/control-plane/scheduler.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { SchedulerQueueRepo } from '../../src/store/scheduler-queue-repo.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { createTestDb } from '../../src/store/db.js';
import type { Task } from '../../src/control-plane/task-model.js';

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let taskRepo: TaskRepo;

  function makeTask(overrides: Partial<Task> = {}): Task {
    const task = taskRepo.create({
      title: overrides.title ?? 'Test task',
      priority: (overrides.priority as any) ?? 'normal',
      agent: overrides.agent ?? '@coder',
      repo: overrides.repo,
      createdBy: overrides.createdBy ?? 'test',
    });
    return task;
  }

  beforeEach(() => {
    const db = createTestDb();
    taskRepo = new TaskRepo(db);
    const eventBus = new LocalEventBus();
    scheduler = new Scheduler(taskRepo, eventBus, {
      maxGlobalConcurrent: 2,
      maxPerRepo: 1,
      maxPerUser: 2,
      agingBoostMs: 60_000,
    });
  });

  it('enqueues and dequeues tasks', () => {
    const task = makeTask();
    scheduler.enqueue(task);
    expect(scheduler.queueLength).toBe(1);

    const id = scheduler.dequeue();
    expect(id).toBe(task.id);
    expect(scheduler.runningCount).toBe(1);
    expect(scheduler.queueLength).toBe(0);
  });

  it('respects global concurrency limit', () => {
    const t1 = makeTask({ title: 'Task 1' });
    const t2 = makeTask({ title: 'Task 2' });
    const t3 = makeTask({ title: 'Task 3' });
    scheduler.enqueue(t1);
    scheduler.enqueue(t2);
    scheduler.enqueue(t3);

    scheduler.dequeue(); // t1 → running
    scheduler.dequeue(); // t2 → running
    const blocked = scheduler.dequeue(); // t3 blocked
    expect(blocked).toBeNull();
    expect(scheduler.runningCount).toBe(2);
  });

  it('respects per-repo concurrency limit', () => {
    const t1 = makeTask({ title: 'Repo task 1', repo: 'org/repo' });
    const t2 = makeTask({ title: 'Repo task 2', repo: 'org/repo' });
    const t3 = makeTask({ title: 'Other repo', repo: 'org/other' });
    scheduler.enqueue(t1);
    scheduler.enqueue(t2);
    scheduler.enqueue(t3);

    const id1 = scheduler.dequeue(); // t1 runs (org/repo)
    expect(id1).toBe(t1.id);

    const id2 = scheduler.dequeue(); // t2 blocked (org/repo at limit), t3 runs
    expect(id2).toBe(t3.id);
  });

  it('frees slots when tasks complete', () => {
    const t1 = makeTask({ title: 'Task 1' });
    const t2 = makeTask({ title: 'Task 2' });
    const t3 = makeTask({ title: 'Task 3' });
    scheduler.enqueue(t1);
    scheduler.enqueue(t2);
    scheduler.enqueue(t3);

    scheduler.dequeue();
    scheduler.dequeue();
    expect(scheduler.dequeue()).toBeNull(); // full

    scheduler.markCompleted(t1);
    const id = scheduler.dequeue();
    expect(id).toBe(t3.id);
  });

  it('prioritizes critical over low', () => {
    const low = makeTask({ title: 'Low', priority: 'low' });
    const crit = makeTask({ title: 'Critical', priority: 'critical' });
    scheduler.enqueue(low);
    scheduler.enqueue(crit);

    const id = scheduler.dequeue();
    expect(id).toBe(crit.id);
  });

  it('cancels a queued task', () => {
    const task = makeTask();
    scheduler.enqueue(task);
    expect(scheduler.cancel(task.id)).toBe(true);
    expect(scheduler.queueLength).toBe(0);
  });

  it('returns queue snapshot', () => {
    const t1 = makeTask({ title: 'A', priority: 'high' });
    const t2 = makeTask({ title: 'B', priority: 'low' });
    scheduler.enqueue(t1);
    scheduler.enqueue(t2);

    const snap = scheduler.getQueueSnapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].taskId).toBe(t1.id);
  });

  it('persists queued tasks across scheduler instances', () => {
    const db = createTestDb();
    const repo = new TaskRepo(db);
    const queueRepo = new SchedulerQueueRepo(db);
    const eventBus = new LocalEventBus();
    const task = repo.create({ title: 'Durable task', priority: 'high' });

    const first = new Scheduler(repo, eventBus, {
      maxGlobalConcurrent: 1,
      maxPerRepo: 1,
      maxPerUser: 1,
      agingBoostMs: 60_000,
    }, queueRepo, 'owner-1');
    first.enqueue(task);
    expect(first.queueLength).toBe(1);

    const second = new Scheduler(repo, eventBus, {
      maxGlobalConcurrent: 1,
      maxPerRepo: 1,
      maxPerUser: 1,
      agingBoostMs: 60_000,
    }, queueRepo, 'owner-2');
    expect(second.queueLength).toBe(1);
    expect(second.dequeue()).toBe(task.id);
    expect(second.runningCount).toBe(1);
  });

  it('allows expired durable leases to be re-acquired', async () => {
    const db = createTestDb();
    const repo = new TaskRepo(db);
    const queueRepo = new SchedulerQueueRepo(db);
    const eventBus = new LocalEventBus();
    const task = repo.create({ title: 'Lease task' });

    const first = new Scheduler(repo, eventBus, {
      maxGlobalConcurrent: 1,
      maxPerRepo: 1,
      maxPerUser: 1,
      agingBoostMs: 60_000,
    }, queueRepo, 'owner-1', 1);
    first.enqueue(task);
    expect(first.dequeue()).toBe(task.id);

    await new Promise(resolve => setTimeout(resolve, 5));

    const second = new Scheduler(repo, eventBus, {
      maxGlobalConcurrent: 1,
      maxPerRepo: 1,
      maxPerUser: 1,
      agingBoostMs: 60_000,
    }, queueRepo, 'owner-2', 1);
    expect(second.dequeue()).toBe(task.id);
  });
});

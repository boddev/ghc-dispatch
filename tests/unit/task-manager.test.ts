import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../../src/control-plane/task-manager.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { EventRepo } from '../../src/store/event-repo.js';
import { createTestDb } from '../../src/store/db.js';
import type { OrchestratorEvent } from '../../src/control-plane/task-model.js';

describe('TaskManager', () => {
  let tm: TaskManager;
  let eventBus: LocalEventBus;
  let emitted: OrchestratorEvent[];

  beforeEach(() => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const eventRepo = new EventRepo(db);
    eventBus = new LocalEventBus();
    emitted = [];
    eventBus.onAny((e) => emitted.push(e));
    tm = new TaskManager(taskRepo, eventRepo, eventBus);
  });

  describe('createTask', () => {
    it('creates a task with defaults', () => {
      const task = tm.createTask({ title: 'Test task' });
      expect(task.id).toBeTruthy();
      expect(task.title).toBe('Test task');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('normal');
      expect(task.agent).toBe('@general-purpose');
    });

    it('emits task.created event', () => {
      tm.createTask({ title: 'Test' });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe('task.created');
    });

    it('creates a task with all fields', () => {
      const task = tm.createTask({
        title: 'Full task',
        description: 'A complete task',
        priority: 'high',
        agent: '@coder',
        repo: 'org/repo',
        dependsOn: [],
        maxRetries: 5,
        metadata: { env: 'prod' },
      });
      expect(task.priority).toBe('high');
      expect(task.agent).toBe('@coder');
      expect(task.repo).toBe('org/repo');
      expect(task.maxRetries).toBe(5);
    });
  });

  describe('getTask', () => {
    it('returns undefined for non-existent task', () => {
      expect(tm.getTask('nonexistent')).toBeUndefined();
    });

    it('returns the created task', () => {
      const created = tm.createTask({ title: 'Find me' });
      const found = tm.getTask(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Find me');
    });
  });

  describe('state transitions', () => {
    it('enqueues a pending task', () => {
      const task = tm.createTask({ title: 'Queue me' });
      const queued = tm.enqueueTask(task.id);
      expect(queued.status).toBe('queued');
    });

    it('transitions queued → running → completed', () => {
      const task = tm.createTask({ title: 'Run me' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      const completed = tm.completeTask(task.id, { success: true, summary: 'Done' });
      expect(completed.status).toBe('completed');
      expect(completed.result?.success).toBe(true);
    });

    it('transitions running → failed', () => {
      const task = tm.createTask({ title: 'Fail me' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      const failed = tm.completeTask(task.id, { success: false, error: 'Oops' });
      expect(failed.status).toBe('failed');
      expect(failed.result?.error).toBe('Oops');
    });

    it('cancels a pending task', () => {
      const task = tm.createTask({ title: 'Cancel me' });
      const cancelled = tm.cancelTask(task.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('cancels a running task', () => {
      const task = tm.createTask({ title: 'Cancel running' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      const cancelled = tm.cancelTask(task.id, 'No longer needed');
      expect(cancelled.status).toBe('cancelled');
    });

    it('throws on invalid transition', () => {
      const task = tm.createTask({ title: 'Invalid' });
      expect(() => tm.transitionTask(task.id, 'completed')).toThrow();
    });

    it('throws on transition of non-existent task', () => {
      expect(() => tm.transitionTask('fake', 'queued')).toThrow('Task not found');
    });
  });

  describe('retry', () => {
    it('retries a failed task', () => {
      const task = tm.createTask({ title: 'Retry me' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      tm.completeTask(task.id, { success: false, error: 'Boom' });

      const retried = tm.retryTask(task.id);
      expect(retried.status).toBe('queued');
      expect(retried.retryCount).toBe(1);
    });

    it('throws when max retries exceeded', () => {
      const task = tm.createTask({ title: 'Retry limit', maxRetries: 1 });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      tm.completeTask(task.id, { success: false, error: 'Fail 1' });
      tm.retryTask(task.id);

      // Fail again
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-2' });
      tm.completeTask(task.id, { success: false, error: 'Fail 2' });

      expect(() => tm.retryTask(task.id)).toThrow('Max retries');
    });

    it('throws when retrying non-failed task', () => {
      const task = tm.createTask({ title: 'Not failed' });
      expect(() => tm.retryTask(task.id)).toThrow('Can only retry failed tasks');
    });
  });

  describe('output recording', () => {
    it('records output events', () => {
      const task = tm.createTask({ title: 'Output task' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });

      tm.recordOutput(task.id, 'Line 1');
      tm.recordOutput(task.id, 'Line 2');

      const events = tm.getTaskEvents(task.id);
      const outputs = events.filter(e => e.payload.type === 'task.output');
      expect(outputs).toHaveLength(2);
    });
  });

  describe('listTasks', () => {
    it('lists all tasks', () => {
      tm.createTask({ title: 'Task 1' });
      tm.createTask({ title: 'Task 2' });
      tm.createTask({ title: 'Task 3' });
      const tasks = tm.listTasks();
      expect(tasks).toHaveLength(3);
    });

    it('filters by status', () => {
      const t1 = tm.createTask({ title: 'Pending' });
      const t2 = tm.createTask({ title: 'Queued' });
      tm.enqueueTask(t2.id);

      const pending = tm.listTasks('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending');

      const queued = tm.listTasks('queued');
      expect(queued).toHaveLength(1);
      expect(queued[0].title).toBe('Queued');
    });
  });

  describe('dependencies', () => {
    it('checks dependencies are met', () => {
      const t1 = tm.createTask({ title: 'Dep 1' });
      const t2 = tm.createTask({ title: 'Dep 2', dependsOn: [t1.id] });

      expect(tm.areDependenciesMet(t2)).toBe(false);

      // Complete t1
      tm.enqueueTask(t1.id);
      tm.transitionTask(t1.id, 'running', { sessionId: 's1' });
      tm.completeTask(t1.id, { success: true, summary: 'Done' });

      const t2Updated = tm.getTask(t2.id)!;
      expect(tm.areDependenciesMet(t2Updated)).toBe(true);
    });

    it('reports met when no dependencies', () => {
      const task = tm.createTask({ title: 'No deps' });
      expect(tm.areDependenciesMet(task)).toBe(true);
    });
  });

  describe('stats', () => {
    it('returns counts by status', () => {
      tm.createTask({ title: 'A' });
      tm.createTask({ title: 'B' });
      const t3 = tm.createTask({ title: 'C' });
      tm.enqueueTask(t3.id);

      const stats = tm.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.queued).toBe(1);
    });
  });

  describe('event history', () => {
    it('captures full lifecycle events', () => {
      const task = tm.createTask({ title: 'Lifecycle' });
      tm.enqueueTask(task.id);
      tm.transitionTask(task.id, 'running', { sessionId: 'sess-1' });
      tm.recordOutput(task.id, 'Working...');
      tm.completeTask(task.id, { success: true, summary: 'All done' });

      const events = tm.getTaskEvents(task.id);
      const types = events.map(e => e.payload.type);
      expect(types).toEqual([
        'task.created',
        'task.queued',
        'task.started',
        'task.output',
        'task.completed',
      ]);
    });
  });
});

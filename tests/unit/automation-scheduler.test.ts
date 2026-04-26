import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationScheduler, parseCronInterval } from '../../src/automation/automation-scheduler.js';
import { TaskManager } from '../../src/control-plane/task-manager.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { EventRepo } from '../../src/store/event-repo.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { createTestDb } from '../../src/store/db.js';
import type Database from 'better-sqlite3';

describe('AutomationScheduler', () => {
  let auto: AutomationScheduler;
  let taskManager: TaskManager;
  let eventBus: LocalEventBus;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new LocalEventBus();
    const taskRepo = new TaskRepo(db);
    const eventRepo = new EventRepo(db);
    taskManager = new TaskManager(taskRepo, eventRepo, eventBus);
    auto = new AutomationScheduler(db, eventBus, taskManager);
  });

  afterEach(() => {
    auto.stopAll();
  });

  describe('parseCronInterval', () => {
    it('parses "every N minutes"', () => {
      expect(parseCronInterval('every 5 minutes')).toBe(5 * 60_000);
      expect(parseCronInterval('every 1 minute')).toBe(60_000);
    });

    it('parses "every N hours"', () => {
      expect(parseCronInterval('every 2 hours')).toBe(2 * 3_600_000);
    });

    it('parses named schedules', () => {
      expect(parseCronInterval('hourly')).toBe(3_600_000);
      expect(parseCronInterval('daily')).toBe(86_400_000);
      expect(parseCronInterval('every 15 minutes')).toBe(15 * 60_000);
    });

    it('returns null for unknown patterns', () => {
      expect(parseCronInterval('at 3pm on tuesday')).toBeNull();
    });
  });

  describe('cron jobs', () => {
    it('creates a cron job', () => {
      const job = auto.create({
        name: 'Health check',
        type: 'cron',
        schedule: 'every 5 minutes',
        action: 'log',
        actionConfig: { message: 'System healthy' },
      });
      expect(job.id).toBeTruthy();
      expect(job.type).toBe('cron');
      expect(job.schedule).toBe('every 5 minutes');
      expect(job.enabled).toBe(true);
      expect(job.nextRunAt).toBeTruthy();
    });

    it('executes a cron job manually', async () => {
      const job = auto.create({
        name: 'Log test',
        type: 'cron',
        schedule: 'every 1 minute',
        action: 'log',
        actionConfig: { message: 'Test log' },
      });

      const result = await auto.executeJob(job);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Test log');

      const updated = auto.getById(job.id)!;
      expect(updated.runCount).toBe(1);
      expect(updated.lastRunAt).toBeTruthy();
    });
  });

  describe('webhook jobs', () => {
    it('creates a webhook job', () => {
      const job = auto.create({
        name: 'Deploy hook',
        type: 'webhook',
        webhookPath: 'deploy-prod',
        action: 'create_task',
        actionConfig: { title: 'Deploy to production', agent: '@coder', priority: 'high' },
      });
      expect(job.webhookPath).toBe('deploy-prod');
    });

    it('handles an incoming webhook', async () => {
      auto.create({
        name: 'CI notify',
        type: 'webhook',
        webhookPath: 'ci-complete',
        action: 'create_task',
        actionConfig: { title: 'CI passed — run integration tests', agent: '@coder' },
      });

      const result = await auto.handleWebhook('ci-complete', { commit: 'abc123' });
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.output).toContain('Created task');

      // Verify the task was actually created
      const tasks = taskManager.listTasks();
      expect(tasks.some(t => t.title === 'CI passed — run integration tests')).toBe(true);
    });

    it('returns null for unknown webhook path', async () => {
      const result = await auto.handleWebhook('nonexistent', {});
      expect(result).toBeNull();
    });
  });

  describe('event-driven jobs', () => {
    it('creates an event-driven job', () => {
      const job = auto.create({
        name: 'On task complete',
        type: 'event',
        eventType: 'task.completed',
        action: 'log',
        actionConfig: { message: 'A task completed!' },
      });
      expect(job.eventType).toBe('task.completed');
    });

    it('triggers on matching events', async () => {
      auto.create({
        name: 'Auto-review on complete',
        type: 'event',
        eventType: 'task.completed',
        action: 'create_task',
        actionConfig: { title: 'Auto-review completed work', agent: '@coder' },
      });

      // Simulate event
      eventBus.emit({ type: 'task.completed', taskId: 'test-1', result: { success: true, summary: 'Done', artifacts: [] } });

      // Give the async handler a moment
      await new Promise(r => setTimeout(r, 100));

      const tasks = taskManager.listTasks();
      expect(tasks.some(t => t.title === 'Auto-review completed work')).toBe(true);
    });
  });

  describe('management', () => {
    it('lists all jobs', () => {
      auto.create({ name: 'A', type: 'cron', schedule: 'hourly', action: 'log' });
      auto.create({ name: 'B', type: 'webhook', webhookPath: 'b', action: 'log' });
      auto.create({ name: 'C', type: 'event', eventType: 'task.failed', action: 'log' });

      expect(auto.listAll()).toHaveLength(3);
    });

    it('lists by type', () => {
      auto.create({ name: 'Cron1', type: 'cron', schedule: 'hourly', action: 'log' });
      auto.create({ name: 'Hook1', type: 'webhook', webhookPath: 'h1', action: 'log' });

      expect(auto.listByType('cron')).toHaveLength(1);
      expect(auto.listByType('webhook')).toHaveLength(1);
    });

    it('enables and disables jobs', () => {
      const job = auto.create({ name: 'Toggle', type: 'cron', schedule: 'hourly', action: 'log' });

      auto.setEnabled(job.id, false);
      expect(auto.getById(job.id)!.enabled).toBe(false);

      auto.setEnabled(job.id, true);
      expect(auto.getById(job.id)!.enabled).toBe(true);
    });

    it('removes a job', () => {
      const job = auto.create({ name: 'Remove me', type: 'cron', schedule: 'hourly', action: 'log' });
      expect(auto.remove(job.id)).toBe(true);
      expect(auto.getById(job.id)).toBeUndefined();
    });
  });

  describe('create_task action', () => {
    it('creates a task with configured properties', async () => {
      const job = auto.create({
        name: 'Nightly tests',
        type: 'cron',
        schedule: 'daily',
        action: 'create_task',
        actionConfig: {
          title: 'Run nightly test suite',
          description: 'Full regression test',
          agent: '@coder',
          priority: 'high',
        },
      });

      const result = await auto.executeJob(job);
      expect(result.success).toBe(true);

      const tasks = taskManager.listTasks();
      const task = tasks.find(t => t.title === 'Run nightly test suite');
      expect(task).toBeDefined();
      expect(task!.agent).toBe('@coder');
      expect(task!.priority).toBe('high');
      expect(task!.createdBy).toContain('automation:');
    });
  });
});

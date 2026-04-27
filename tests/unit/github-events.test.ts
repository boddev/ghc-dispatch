import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitHubEventHandler } from '../../src/automation/github-events.js';
import { TaskManager } from '../../src/control-plane/task-manager.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { EventRepo } from '../../src/store/event-repo.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { ConversationRepo } from '../../src/store/conversation-repo.js';
import { WikiManager } from '../../src/wiki/wiki-manager.js';
import { createTestDb } from '../../src/store/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GitHubEventHandler', () => {
  let handler: GitHubEventHandler;
  let taskManager: TaskManager;
  let memoryManager: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    const db = createTestDb();
    const eventBus = new LocalEventBus();
    const taskRepo = new TaskRepo(db);
    const eventRepo = new EventRepo(db);
    taskManager = new TaskManager(taskRepo, eventRepo, eventBus);
    tmpDir = mkdtempSync(join(tmpdir(), 'gh-events-'));
    const convRepo = new ConversationRepo(db);
    const wiki = new WikiManager(tmpDir);
    memoryManager = new MemoryManager(db, convRepo, wiki, {
      episodicIntervalMs: 999_999,
      extractionIntervalMs: 999_999,
    });

    handler = new GitHubEventHandler(taskManager, memoryManager);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('push events', () => {
    it('handles push events', () => {
      const result = handler.handle('push', {
        ref: 'refs/heads/main',
        repository: { full_name: 'org/repo' },
        pusher: { name: 'alice' },
        commits: [{}, {}, {}],
        sender: { login: 'alice' },
      });
      expect(result.handled).toBe(true);
      expect(result.summary).toContain('alice pushed 3 commit(s)');
    });
  });

  describe('pull_request events', () => {
    it('creates a task for opened PRs', () => {
      const result = handler.handle('pull_request', {
        action: 'opened',
        pull_request: { number: 42, title: 'Add auth feature', user: { login: 'bob' }, body: 'New auth system', html_url: 'https://github.com/org/repo/pull/42' },
        repository: { full_name: 'org/repo' },
        sender: { login: 'bob' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeDefined();
      expect(result.summary).toContain('PR #42');

      const tasks = taskManager.listTasks();
      expect(tasks.some(t => t.title.includes('PR #42'))).toBe(true);
    });

    it('handles merged PRs without creating tasks', () => {
      const result = handler.handle('pull_request', {
        action: 'closed',
        pull_request: { number: 42, title: 'Add auth feature', user: { login: 'bob' }, merged: true },
        repository: { full_name: 'org/repo' },
        sender: { login: 'bob' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeUndefined();
    });
  });

  describe('issue events', () => {
    it('creates a task for opened issues', () => {
      const result = handler.handle('issues', {
        action: 'opened',
        issue: { number: 99, title: 'Login broken', body: 'Cannot log in', labels: [{ name: 'bug' }], html_url: 'https://github.com/org/repo/issues/99' },
        repository: { full_name: 'org/repo' },
        sender: { login: 'charlie' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeDefined();

      const task = taskManager.getTask(result.taskId!);
      expect(task!.priority).toBe('high'); // bug label → high priority
    });
  });

  describe('CI failure events', () => {
    it('creates a task for failed check runs', () => {
      const result = handler.handle('check_run', {
        action: 'completed',
        check_run: { name: 'test-suite', conclusion: 'failure', output: { summary: 'Tests failed' } },
        repository: { full_name: 'org/repo' },
        sender: { login: 'github-actions' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeDefined();
      expect(result.summary).toContain('failure');

      const task = taskManager.getTask(result.taskId!);
      expect(task!.priority).toBe('high');
    });

    it('does not create task for successful check runs', () => {
      const result = handler.handle('check_run', {
        action: 'completed',
        check_run: { name: 'test-suite', conclusion: 'success', output: {} },
        repository: { full_name: 'org/repo' },
        sender: { login: 'github-actions' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeUndefined();
    });
  });

  describe('workflow_run events', () => {
    it('creates a task for failed workflow runs', () => {
      const result = handler.handle('workflow_run', {
        action: 'completed',
        workflow_run: { name: 'CI Pipeline', conclusion: 'failure', html_url: 'https://github.com/org/repo/actions/runs/123' },
        repository: { full_name: 'org/repo' },
        sender: { login: 'github-actions' },
      });
      expect(result.handled).toBe(true);
      expect(result.taskId).toBeDefined();
    });
  });

  describe('memory logging', () => {
    it('logs GitHub events to conversation memory', () => {
      handler.handle('push', {
        ref: 'refs/heads/main',
        repository: { full_name: 'org/repo' },
        pusher: { name: 'alice' },
        commits: [{}],
        sender: { login: 'alice' },
      });

      const messages = memoryManager.conversations.search('GitHub');
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('unhandled events', () => {
    it('returns handled=false for unknown events', () => {
      const result = handler.handle('star', { action: 'created', sender: { login: 'fan' } });
      expect(result.handled).toBe(false);
    });
  });
});

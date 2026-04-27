import { describe, it, expect, beforeEach } from 'vitest';
import { ProactiveCheckIn } from '../../src/automation/proactive-checkin.js';
import { TaskManager } from '../../src/control-plane/task-manager.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { EventRepo } from '../../src/store/event-repo.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { ApprovalManager } from '../../src/control-plane/approval-manager.js';
import { AutomationScheduler } from '../../src/automation/automation-scheduler.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { ConversationRepo } from '../../src/store/conversation-repo.js';
import { WikiManager } from '../../src/wiki/wiki-manager.js';
import { createTestDb } from '../../src/store/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ProactiveCheckIn', () => {
  let checkIn: ProactiveCheckIn;
  let taskManager: TaskManager;
  let approvalManager: ApprovalManager;
  let tmpDir: string;

  beforeEach(() => {
    const db = createTestDb();
    const eventBus = new LocalEventBus();
    const taskRepo = new TaskRepo(db);
    const eventRepo = new EventRepo(db);
    taskManager = new TaskManager(taskRepo, eventRepo, eventBus);
    approvalManager = new ApprovalManager(db, eventRepo, eventBus);
    const autoScheduler = new AutomationScheduler(db, eventBus, taskManager);
    tmpDir = mkdtempSync(join(tmpdir(), 'checkin-test-'));
    const convRepo = new ConversationRepo(db);
    const wiki = new WikiManager(tmpDir);
    const memoryManager = new MemoryManager(db, convRepo, wiki, {
      episodicIntervalMs: 999_999,
      extractionIntervalMs: 999_999,
    });

    checkIn = new ProactiveCheckIn(taskManager, approvalManager, memoryManager, autoScheduler, {
      enabled: false, // don't auto-start
    });
  });

  it('returns empty when everything is fine', () => {
    const messages = checkIn.evaluate();
    expect(messages).toHaveLength(0);
  });

  it('reports failed tasks', () => {
    const t = taskManager.createTask({ title: 'Failing task' });
    taskManager.enqueueTask(t.id);
    taskManager.transitionTask(t.id, 'running', { sessionId: 's1' });
    taskManager.completeTask(t.id, { success: false, summary: '', artifacts: [], error: 'Boom' });

    const messages = checkIn.evaluate();
    expect(messages.some(m => m.type === 'warning' && m.title.includes('failed'))).toBe(true);
  });

  it('reports pending approvals', () => {
    const t = taskManager.createTask({ title: 'Approval test' });
    approvalManager.create({ taskId: t.id, type: 'deployment', description: 'Deploy to prod' });

    const messages = checkIn.evaluate();
    expect(messages.some(m => m.title.includes('approval'))).toBe(true);
  });

  it('formats messages', () => {
    const formatted = ProactiveCheckIn.formatMessages([
      { type: 'warning', title: 'Test warning', body: 'Something is wrong', timestamp: new Date().toISOString() },
      { type: 'info', title: 'FYI', body: 'Just so you know', timestamp: new Date().toISOString() },
    ]);
    expect(formatted).toContain('⚠️');
    expect(formatted).toContain('ℹ️');
    expect(formatted).toContain('Test warning');
  });

  it('formats empty as all clear', () => {
    expect(ProactiveCheckIn.formatMessages([])).toContain('All clear');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

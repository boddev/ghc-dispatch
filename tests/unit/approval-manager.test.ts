import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalManager } from '../../src/control-plane/approval-manager.js';
import { EventRepo } from '../../src/store/event-repo.js';
import { TaskRepo } from '../../src/store/task-repo.js';
import { LocalEventBus } from '../../src/control-plane/event-bus.js';
import { createTestDb } from '../../src/store/db.js';
import type { OrchestratorEvent } from '../../src/control-plane/task-model.js';

describe('ApprovalManager', () => {
  let manager: ApprovalManager;
  let taskRepo: TaskRepo;
  let emitted: OrchestratorEvent[];

  function makeTaskId(title = 'Test task'): string {
    return taskRepo.create({ title }).id;
  }

  beforeEach(() => {
    const db = createTestDb();
    const eventRepo = new EventRepo(db);
    taskRepo = new TaskRepo(db);
    const eventBus = new LocalEventBus();
    emitted = [];
    eventBus.onAny(e => emitted.push(e));
    manager = new ApprovalManager(db, eventRepo, eventBus);
  });

  it('creates an approval request', () => {
    const taskId = makeTaskId();
    const approval = manager.create({
      taskId,
      type: 'deployment',
      description: 'Deploy to production',
    });
    expect(approval.id).toBeTruthy();
    expect(approval.status).toBe('pending');
    expect(approval.taskId).toBe(taskId);
    expect(emitted.some(e => e.type === 'approval.requested')).toBe(true);
  });

  it('approves a pending request', () => {
    const taskId = makeTaskId();
    const req = manager.create({ taskId, type: 'deployment', description: 'Deploy' });
    const approved = manager.approve(req.id, 'admin');
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('approved');
    expect(approved!.decidedBy).toBe('admin');
    expect(emitted.some(e => e.type === 'approval.decided')).toBe(true);
  });

  it('rejects a pending request', () => {
    const taskId = makeTaskId();
    const req = manager.create({ taskId, type: 'deployment', description: 'Deploy' });
    const rejected = manager.reject(req.id, 'admin');
    expect(rejected!.status).toBe('rejected');
  });

  it('returns null when approving already-decided request', () => {
    const taskId = makeTaskId();
    const req = manager.create({ taskId, type: 'deployment', description: 'Deploy' });
    manager.approve(req.id, 'admin');
    const again = manager.approve(req.id, 'admin2');
    expect(again).toBeNull();
  });

  it('lists pending approvals', () => {
    const t1 = makeTaskId('T1'), t2 = makeTaskId('T2'), t3 = makeTaskId('T3');
    manager.create({ taskId: t1, type: 'deployment', description: 'A' });
    manager.create({ taskId: t2, type: 'tool_call', description: 'B' });
    const req3 = manager.create({ taskId: t3, type: 'custom', description: 'C' });
    manager.approve(req3.id, 'admin');

    const pending = manager.getPending();
    expect(pending).toHaveLength(2);
  });

  it('gets approvals by task', () => {
    const t1 = makeTaskId('T1'), t2 = makeTaskId('T2');
    manager.create({ taskId: t1, type: 'deployment', description: 'A' });
    manager.create({ taskId: t1, type: 'tool_call', description: 'B' });
    manager.create({ taskId: t2, type: 'custom', description: 'C' });

    const byTask = manager.getByTask(t1);
    expect(byTask).toHaveLength(2);
  });

  it('expires stale approvals', () => {
    const taskId = makeTaskId();
    manager.create({
      taskId,
      type: 'deployment',
      description: 'Old',
      expiresInMs: -1000,
    });

    const expired = manager.expireStale();
    expect(expired).toBe(1);

    const pending = manager.getPending();
    expect(pending).toHaveLength(0);
  });
});

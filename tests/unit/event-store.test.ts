import { describe, it, expect, beforeEach } from 'vitest';
import { EventRepo } from '../../src/store/event-repo.js';
import { createTestDb } from '../../src/store/db.js';
import type { OrchestratorEvent } from '../../src/control-plane/task-model.js';

describe('EventRepo', () => {
  let repo: EventRepo;

  beforeEach(() => {
    const db = createTestDb();
    repo = new EventRepo(db);
  });

  it('appends and retrieves events', () => {
    const event: OrchestratorEvent = {
      type: 'task.created',
      taskId: 'task-1',
      data: { title: 'Test' },
    };
    const id = repo.append(event);
    expect(id).toBeGreaterThan(0);

    const events = repo.getByTaskId('task-1');
    expect(events).toHaveLength(1);
    expect(events[0].payload.type).toBe('task.created');
  });

  it('appends batch events in a transaction', () => {
    const events: OrchestratorEvent[] = [
      { type: 'task.created', taskId: 'task-1', data: {} },
      { type: 'task.queued', taskId: 'task-1', position: 0 },
      { type: 'task.started', taskId: 'task-1', sessionId: 'sess-1' },
    ];
    repo.appendBatch(events);
    expect(repo.count()).toBe(3);
  });

  it('retrieves events by type', () => {
    repo.append({ type: 'task.created', taskId: 'task-1', data: {} });
    repo.append({ type: 'task.created', taskId: 'task-2', data: {} });
    repo.append({ type: 'task.queued', taskId: 'task-1', position: 0 });

    const created = repo.getByType('task.created');
    expect(created).toHaveLength(2);
  });

  it('retrieves recent events in DESC order', () => {
    repo.append({ type: 'task.created', taskId: 'task-1', data: {} });
    repo.append({ type: 'task.queued', taskId: 'task-1', position: 0 });
    repo.append({ type: 'task.started', taskId: 'task-1', sessionId: 's1' });

    const recent = repo.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].payload.type).toBe('task.started');
  });

  it('retrieves events since a given id', () => {
    const id1 = repo.append({ type: 'task.created', taskId: 't1', data: {} });
    repo.append({ type: 'task.queued', taskId: 't1', position: 0 });
    repo.append({ type: 'task.started', taskId: 't1', sessionId: 's1' });

    const since = repo.getSince(id1, 100);
    expect(since).toHaveLength(2);
    expect(since[0].payload.type).toBe('task.queued');
  });

  it('counts events', () => {
    repo.append({ type: 'task.created', taskId: 't1', data: {} });
    repo.append({ type: 'task.created', taskId: 't2', data: {} });
    expect(repo.count()).toBe(2);
  });

  it('counts by type', () => {
    repo.append({ type: 'task.created', taskId: 't1', data: {} });
    repo.append({ type: 'task.created', taskId: 't2', data: {} });
    repo.append({ type: 'task.completed', taskId: 't1', result: { success: true } });

    const counts = repo.countByType();
    expect(counts['task.created']).toBe(2);
    expect(counts['task.completed']).toBe(1);
  });

  it('deletes events older than a date', () => {
    repo.append({ type: 'task.created', taskId: 't1', data: {} });

    // Delete everything older than tomorrow
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const deleted = repo.deleteOlderThan(tomorrow);
    expect(deleted).toBe(1);
    expect(repo.count()).toBe(0);
  });

  it('filters by task ID and type', () => {
    repo.append({ type: 'task.output', taskId: 't1', content: 'line 1' });
    repo.append({ type: 'task.output', taskId: 't1', content: 'line 2' });
    repo.append({ type: 'task.output', taskId: 't2', content: 'other' });
    repo.append({ type: 'task.created', taskId: 't1', data: {} });

    const outputs = repo.getByTaskIdAndType('t1', 'task.output');
    expect(outputs).toHaveLength(2);
  });
});

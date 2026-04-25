import { describe, it, expect, beforeEach } from 'vitest';
import { SessionPool } from '../../src/execution/session-pool.js';
import { MockCopilotAdapter } from '../../src/execution/copilot-adapter.js';

describe('SessionPool', () => {
  let pool: SessionPool;
  let adapter: MockCopilotAdapter;

  beforeEach(async () => {
    adapter = new MockCopilotAdapter();
    await adapter.start();
    pool = new SessionPool(adapter, { maxConcurrent: 2 });
  });

  it('reports size and availability', () => {
    expect(pool.size).toBe(0);
    expect(pool.available).toBe(2);
    expect(pool.isFull()).toBe(false);
  });

  it('acquires a session', async () => {
    const session = await pool.acquire('task-1', { model: 'test' });
    expect(session.id).toBeTruthy();
    expect(pool.size).toBe(1);
    expect(pool.available).toBe(1);
  });

  it('releases a session', async () => {
    const session = await pool.acquire('task-1', { model: 'test' });
    await pool.release(session.id);
    expect(pool.size).toBe(0);
    expect(pool.available).toBe(2);
  });

  it('throws when pool is full', async () => {
    await pool.acquire('task-1', { model: 'test' });
    await pool.acquire('task-2', { model: 'test' });
    expect(pool.isFull()).toBe(true);
    await expect(pool.acquire('task-3', { model: 'test' })).rejects.toThrow('Session pool full');
  });

  it('releases by task ID', async () => {
    await pool.acquire('task-1', { model: 'test' });
    await pool.acquire('task-2', { model: 'test' });
    await pool.releaseByTask('task-1');
    expect(pool.size).toBe(1);
  });

  it('releases all sessions', async () => {
    await pool.acquire('task-1', { model: 'test' });
    await pool.acquire('task-2', { model: 'test' });
    await pool.releaseAll();
    expect(pool.size).toBe(0);
  });

  it('lists active entries', async () => {
    await pool.acquire('task-1', { model: 'gpt-5' });
    await pool.acquire('task-2', { model: 'claude-sonnet-4.6' });

    const entries = pool.getActiveEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].taskId).toBe('task-1');
    expect(entries[1].taskId).toBe('task-2');
  });
});

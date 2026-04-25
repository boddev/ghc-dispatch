import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, TaskSchema, CreateTaskInput } from '../../src/control-plane/task-model.js';

describe('Task State Machine', () => {
  describe('canTransition', () => {
    it('allows pending → queued', () => {
      expect(canTransition('pending', 'queued')).toBe(true);
    });

    it('allows pending → cancelled', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true);
    });

    it('allows queued → running', () => {
      expect(canTransition('queued', 'running')).toBe(true);
    });

    it('allows queued → cancelled', () => {
      expect(canTransition('queued', 'cancelled')).toBe(true);
    });

    it('allows running → completed', () => {
      expect(canTransition('running', 'completed')).toBe(true);
    });

    it('allows running → failed', () => {
      expect(canTransition('running', 'failed')).toBe(true);
    });

    it('allows running → paused', () => {
      expect(canTransition('running', 'paused')).toBe(true);
    });

    it('allows running → cancelled', () => {
      expect(canTransition('running', 'cancelled')).toBe(true);
    });

    it('allows paused → queued (resume)', () => {
      expect(canTransition('paused', 'queued')).toBe(true);
    });

    it('allows paused → cancelled', () => {
      expect(canTransition('paused', 'cancelled')).toBe(true);
    });

    it('allows failed → queued (retry)', () => {
      expect(canTransition('failed', 'queued')).toBe(true);
    });

    it('disallows completed → anything', () => {
      expect(canTransition('completed', 'pending')).toBe(false);
      expect(canTransition('completed', 'queued')).toBe(false);
      expect(canTransition('completed', 'running')).toBe(false);
      expect(canTransition('completed', 'cancelled')).toBe(false);
    });

    it('disallows cancelled → anything', () => {
      expect(canTransition('cancelled', 'pending')).toBe(false);
      expect(canTransition('cancelled', 'queued')).toBe(false);
      expect(canTransition('cancelled', 'running')).toBe(false);
    });

    it('disallows pending → running (must queue first)', () => {
      expect(canTransition('pending', 'running')).toBe(false);
    });

    it('disallows pending → completed (must run first)', () => {
      expect(canTransition('pending', 'completed')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('throws on invalid transition', () => {
      expect(() => assertTransition('pending', 'completed')).toThrow('Invalid task transition: pending → completed');
    });

    it('does not throw on valid transition', () => {
      expect(() => assertTransition('pending', 'queued')).not.toThrow();
    });
  });

  describe('CreateTaskInput validation', () => {
    it('validates minimal input', () => {
      const result = CreateTaskInput.safeParse({ title: 'Fix bug' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe('normal');
        expect(result.data.agent).toBe('@general-purpose');
        expect(result.data.dependsOn).toEqual([]);
      }
    });

    it('rejects empty title', () => {
      const result = CreateTaskInput.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });

    it('validates full input', () => {
      const result = CreateTaskInput.safeParse({
        title: 'Deploy to staging',
        description: 'Deploy the latest build',
        priority: 'critical',
        agent: '@coder',
        repo: 'org/repo',
        dependsOn: ['task-1', 'task-2'],
        maxRetries: 5,
        metadata: { environment: 'staging' },
      });
      expect(result.success).toBe(true);
    });
  });
});

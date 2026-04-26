import { describe, it, expect } from 'vitest';
import { TaskDag, buildDagFromTasks } from '../../src/execution/task-dag.js';

describe('TaskDag', () => {
  describe('basic operations', () => {
    it('adds nodes and reports size', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);
      expect(dag.size).toBe(2);
    });

    it('throws on duplicate nodes', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      expect(() => dag.addNode('a')).toThrow('already exists');
    });
  });

  describe('validation', () => {
    it('validates an acyclic graph', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);
      dag.addNode('c', ['a']);
      dag.addNode('d', ['b', 'c']);
      expect(dag.validate().valid).toBe(true);
    });

    it('detects cycles', () => {
      const dag = new TaskDag();
      dag.addNode('a', ['c']);
      dag.addNode('b', ['a']);
      dag.addNode('c', ['b']);
      const result = dag.validate();
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
    });
  });

  describe('topological sort', () => {
    it('sorts a linear chain', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);
      dag.addNode('c', ['b']);
      const order = dag.topologicalSort();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('sorts a diamond graph', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);
      dag.addNode('c', ['a']);
      dag.addNode('d', ['b', 'c']);
      const order = dag.topologicalSort();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });
  });

  describe('execution tracking', () => {
    it('identifies ready tasks', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);
      dag.addNode('c');
      expect(dag.getReady()).toEqual(expect.arrayContaining(['a', 'c']));
    });

    it('unblocks tasks when dependencies complete', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b', ['a']);

      expect(dag.getReady()).toEqual(['a']);
      dag.markRunning('a');
      expect(dag.getReady()).toEqual([]);
      dag.markCompleted('a');
      expect(dag.getReady()).toEqual(['b']);
    });

    it('tracks completion state', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b');
      expect(dag.isComplete()).toBe(false);
      dag.markCompleted('a');
      expect(dag.isComplete()).toBe(false);
      dag.markCompleted('b');
      expect(dag.isComplete()).toBe(true);
    });

    it('tracks failure state', () => {
      const dag = new TaskDag();
      dag.addNode('a');
      dag.addNode('b');
      dag.markFailed('a');
      expect(dag.hasFailed()).toBe(true);
      dag.markCompleted('b');
      expect(dag.isComplete()).toBe(true);
    });
  });

  describe('buildDagFromTasks', () => {
    it('builds DAG from task objects', () => {
      const tasks = [
        { id: 't1', dependsOn: [] },
        { id: 't2', dependsOn: ['t1'] },
        { id: 't3', dependsOn: ['t1'] },
        { id: 't4', dependsOn: ['t2', 't3'] },
      ] as any[];

      const dag = buildDagFromTasks(tasks);
      expect(dag.size).toBe(4);
      expect(dag.validate().valid).toBe(true);
      expect(dag.getReady()).toEqual(['t1']);
    });

    it('filters out external dependencies', () => {
      const tasks = [
        { id: 't1', dependsOn: ['external-task'] },
      ] as any[];

      const dag = buildDagFromTasks(tasks);
      expect(dag.size).toBe(1);
      expect(dag.getReady()).toEqual(['t1']); // external dep filtered out
    });
  });
});

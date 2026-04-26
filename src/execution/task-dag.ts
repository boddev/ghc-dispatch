/**
 * DAG-based task execution engine.
 *
 * Supports arbitrary directed acyclic graphs of tasks with dependency resolution,
 * topological ordering, parallel dispatch, and join semantics.
 */

import type { TaskManager } from '../control-plane/task-manager.js';
import type { SessionRunner } from './session-runner.js';
import type { Task } from '../control-plane/task-model.js';

export interface DagNode {
  taskId: string;
  dependsOn: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
}

export class TaskDag {
  private nodes = new Map<string, DagNode>();

  addNode(taskId: string, dependsOn: string[] = []): void {
    if (this.nodes.has(taskId)) throw new Error(`Node ${taskId} already exists in DAG`);
    this.nodes.set(taskId, { taskId, dependsOn: [...dependsOn], status: 'pending' });
  }

  /** Validate the DAG has no cycles using Kahn's algorithm */
  validate(): { valid: boolean; cycle?: string[] } {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.dependsOn.length);
      for (const dep of node.dependsOn) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep)!.push(id);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed++;
      for (const next of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    if (processed < this.nodes.size) {
      const cycle = [...inDegree.entries()]
        .filter(([, deg]) => deg > 0)
        .map(([id]) => id);
      return { valid: false, cycle };
    }

    return { valid: true };
  }

  /** Get topologically sorted list of task IDs */
  topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Cycle detected at ${id}`);

      visiting.add(id);
      const node = this.nodes.get(id)!;
      for (const dep of node.dependsOn) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of this.nodes.keys()) {
      visit(id);
    }

    return result;
  }

  /** Get tasks that are ready to run (all dependencies completed) */
  getReady(): string[] {
    const ready: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.status !== 'pending') continue;
      const allDepsComplete = node.dependsOn.every(dep => {
        const depNode = this.nodes.get(dep);
        return depNode?.status === 'completed';
      });
      if (allDepsComplete) ready.push(id);
    }
    return ready;
  }

  markRunning(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) node.status = 'running';
  }

  markCompleted(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) node.status = 'completed';
  }

  markFailed(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (node) node.status = 'failed';
  }

  isComplete(): boolean {
    return [...this.nodes.values()].every(n => n.status === 'completed' || n.status === 'failed');
  }

  hasFailed(): boolean {
    return [...this.nodes.values()].some(n => n.status === 'failed');
  }

  getNodes(): DagNode[] {
    return [...this.nodes.values()];
  }

  get size(): number {
    return this.nodes.size;
  }
}

/** Build a DAG from a set of tasks with their dependsOn fields */
export function buildDagFromTasks(tasks: Task[]): TaskDag {
  const dag = new TaskDag();
  const taskIds = new Set(tasks.map(t => t.id));

  for (const task of tasks) {
    const deps = task.dependsOn.filter(d => taskIds.has(d));
    dag.addNode(task.id, deps);
  }

  return dag;
}

/**
 * Execute a DAG of tasks with parallel dispatch.
 * Repeatedly finds ready tasks, dispatches them, and waits for completion.
 */
export async function executeDag(
  dag: TaskDag,
  taskManager: TaskManager,
  sessionRunner: SessionRunner,
  maxParallel = 4,
): Promise<{ completed: string[]; failed: string[] }> {
  const validation = dag.validate();
  if (!validation.valid) {
    throw new Error(`DAG has cycles: ${validation.cycle?.join(' → ')}`);
  }

  const completed: string[] = [];
  const failed: string[] = [];

  while (!dag.isComplete()) {
    const ready = dag.getReady();
    if (ready.length === 0 && !dag.isComplete()) {
      // Deadlock: remaining tasks have unmet dependencies (failed deps)
      const remaining = dag.getNodes().filter(n => n.status === 'pending');
      for (const node of remaining) {
        dag.markFailed(node.taskId);
        failed.push(node.taskId);
      }
      break;
    }

    // Dispatch up to maxParallel tasks
    const batch = ready.slice(0, maxParallel);
    for (const taskId of batch) {
      dag.markRunning(taskId);
      taskManager.enqueueTask(taskId);
    }

    // Execute batch in parallel
    const results = await Promise.allSettled(
      batch.map(taskId => sessionRunner.executeTask(taskId))
    );

    for (let i = 0; i < batch.length; i++) {
      const taskId = batch[i];
      const task = taskManager.getTask(taskId);
      if (task?.status === 'completed') {
        dag.markCompleted(taskId);
        completed.push(taskId);
      } else {
        dag.markFailed(taskId);
        failed.push(taskId);
      }
    }
  }

  return { completed, failed };
}

import type { TaskManager } from '../control-plane/task-manager.js';
import type { EventBus } from '../control-plane/event-bus.js';
import type { AgentDefinition } from './agent-loader.js';
import type { AgentLoader } from './agent-loader.js';
import type { SessionPool } from './session-pool.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { ArtifactCollector } from './artifact-collector.js';
import type { Config } from '../config.js';
import type { Task } from '../control-plane/task-model.js';
import type { ModelManager } from './model-manager.js';

export class SessionRunner {
  constructor(
    private taskManager: TaskManager,
    private agentLoader: AgentLoader,
    private sessionPool: SessionPool,
    private worktreeManager: WorktreeManager,
    private artifactCollector: ArtifactCollector,
    private eventBus: EventBus,
    private config: Config,
    private modelManager?: ModelManager,
  ) {}

  async executeTask(taskId: string): Promise<void> {
    const task = this.taskManager.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agent = this.agentLoader.get(task.agent) ?? this.agentLoader.getDefault();
    const taskModel = task.metadata?.model as string | undefined;
    const model = this.modelManager
      ? this.modelManager.resolveModel(taskModel, task.agent, agent.model)
      : (agent.model === 'auto' ? this.config.copilotModel : agent.model);

    let workDir = task.workingDirectory;
    if (task.repo && !workDir) {
      try {
        const wt = await this.worktreeManager.checkout(taskId, task.repo);
        workDir = wt.path;
        this.taskManager.getTask(taskId); // refresh
      } catch (err: any) {
        // Non-fatal: proceed without worktree
        workDir = task.repo;
      }
    }

    // Transition to running
    const outputChunks: string[] = [];

    try {
      const session = await this.sessionPool.acquire(taskId, {
        model,
        workingDirectory: workDir,
        onPermissionRequest: async (req) => {
          // For now, auto-approve. Phase 3 will add policy engine.
          return true;
        },
        onEvent: (event) => {
          if (event.type === 'assistant.message' && event.data.content) {
            outputChunks.push(event.data.content);
            this.taskManager.recordOutput(taskId, event.data.content);
          }
        },
      });

      this.taskManager.transitionTask(taskId, 'running', { sessionId: session.id });

      // Build the prompt from agent system prompt + task description
      const prompt = this.buildPrompt(task, agent);
      await session.send(prompt);

      // Wait for completion (the mock adapter resolves immediately;
      // the real SDK streams events until session.idle)
      await this.waitForIdle(session.id, 300_000); // 5 min timeout

      // Capture artifacts if we have a working directory
      if (workDir) {
        this.artifactCollector.captureDiff(taskId, workDir);
      }

      // Capture full output log
      if (outputChunks.length > 0) {
        this.artifactCollector.captureLog(taskId, outputChunks.join('\n'));
      }

      // Complete the task
      this.taskManager.completeTask(taskId, {
        success: true,
        summary: outputChunks.join('\n').slice(0, 2000) || 'Task completed',
        artifacts: [],
      });

      await this.sessionPool.release(session.id);
    } catch (err: any) {
      this.taskManager.completeTask(taskId, {
        success: false,
        summary: '',
        artifacts: [],
        error: err.message ?? String(err),
      });

      await this.sessionPool.releaseByTask(taskId);

      // Auto-retry if under limit
      const updated = this.taskManager.getTask(taskId);
      if (updated && updated.retryCount < updated.maxRetries) {
        await this.scheduleRetry(taskId, updated.retryCount);
      }
    }
  }

  async executeSubtasks(parentTaskId: string): Promise<void> {
    const subtasks = this.taskManager.getSubtasks(parentTaskId);
    const pending = subtasks.filter(t => t.status === 'pending');

    // Fan-out: enqueue all ready subtasks
    const ready = pending.filter(t => this.taskManager.areDependenciesMet(t));
    for (const sub of ready) {
      this.taskManager.enqueueTask(sub.id);
    }

    // Execute in parallel (limited by session pool)
    const queued = this.taskManager.getSubtasks(parentTaskId).filter(t => t.status === 'queued');
    const executions = queued.map(t => this.executeTask(t.id));
    await Promise.allSettled(executions);

    // Check if all subtasks completed → complete parent
    const allSubs = this.taskManager.getSubtasks(parentTaskId);
    const allDone = allSubs.every(t => t.status === 'completed' || t.status === 'cancelled');
    const anyFailed = allSubs.some(t => t.status === 'failed');

    if (allDone && !anyFailed) {
      const parent = this.taskManager.getTask(parentTaskId);
      if (parent && parent.status === 'running') {
        this.taskManager.completeTask(parentTaskId, {
          success: true,
          summary: `All ${allSubs.length} subtasks completed`,
          artifacts: [],
        });
      }
    } else if (anyFailed) {
      const failed = allSubs.filter(t => t.status === 'failed');
      const parent = this.taskManager.getTask(parentTaskId);
      if (parent && parent.status === 'running') {
        this.taskManager.completeTask(parentTaskId, {
          success: false,
          summary: '',
          artifacts: [],
          error: `${failed.length}/${allSubs.length} subtasks failed`,
        });
      }
    }
  }

  private buildPrompt(task: Task, agent: AgentDefinition): string {
    const parts: string[] = [];

    if (agent.systemPrompt) {
      parts.push(agent.systemPrompt);
    }

    parts.push(`\n## Task\n**${task.title}**`);

    if (task.description) {
      parts.push(task.description);
    }

    if (task.repo) {
      parts.push(`\nRepository: ${task.repo}`);
    }

    if (task.metadata && Object.keys(task.metadata).length > 0) {
      parts.push(`\nContext: ${JSON.stringify(task.metadata)}`);
    }

    return parts.join('\n');
  }

  private async waitForIdle(sessionId: string, timeoutMs: number): Promise<void> {
    // With the mock adapter, this resolves immediately.
    // With the real SDK, we'd listen for session.idle events.
    // For now, this is a placeholder that the real SDK integration will flesh out.
    return new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  private async scheduleRetry(taskId: string, attempt: number): Promise<void> {
    const backoff = this.config.retryBackoffMs * Math.pow(2, attempt);
    setTimeout(() => {
      try {
        this.taskManager.retryTask(taskId);
      } catch {
        // Task may have been cancelled
      }
    }, backoff);
  }
}

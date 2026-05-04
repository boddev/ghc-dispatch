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
import type { SkillManager } from '../skills/skill-manager.js';
import type { TaskRuntimeConfigManager } from './task-runtime-config.js';
import type { ExecutionSettingsManager } from './execution-settings.js';
import type { SessionOptions } from './copilot-adapter.js';
import type { TeamRepo } from '../store/team-repo.js';
import { agentSlug } from './agent-loader.js';
import { paths } from '../paths.js';

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
    private skillManager?: SkillManager,
    private taskRuntimeConfig?: TaskRuntimeConfigManager,
    private teamRepo?: TeamRepo,
    private executionSettings?: ExecutionSettingsManager,
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
        // Persist so a daemon restart can resume against the same worktree.
        this.taskManager.setWorkingDirectory(taskId, workDir);
      } catch (err: any) {
        // Non-fatal: proceed without worktree
        workDir = task.repo;
      }
    }
    if (!task.repo && !workDir) {
      workDir = paths.dataDir;
      this.taskManager.setWorkingDirectory(taskId, workDir);
    }

    // Transition to running
    const outputChunks: string[] = [];
    let transitionedToRunning = false;
    let resolveIdle!: () => void;
    let rejectIdle!: (err: Error) => void;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectIdle = reject;
    });

    try {
      const session = await this.sessionPool.acquire(taskId, {
        ...this.buildRuntimeSessionOptions(agent),
        model,
        workingDirectory: workDir,
        onPermissionRequest: async (req) => {
          const runtimeConfig = this.taskRuntimeConfig?.get();
          if (runtimeConfig?.permissionMode === 'deny-blocked') {
            const excluded = new Set(runtimeConfig.excludedTools.map(t => t.toLowerCase()));
            const toolName = String(req.details?.toolName ?? req.details?.name ?? '').toLowerCase();
            if (toolName && excluded.has(toolName)) return false;
          }
          return true;
        },
        onEvent: (event) => {
          if (event.type === 'session.idle') {
            resolveIdle();
            return;
          }
          if (event.type === 'error') {
            rejectIdle(new Error(event.data.error ?? 'Copilot session error'));
            return;
          }
          if (event.type === 'assistant.message' && event.data.content) {
            outputChunks.push(event.data.content);
            this.taskManager.recordOutput(taskId, event.data.content);
          }
        },
      });

      this.taskManager.transitionTask(taskId, 'running', { sessionId: session.id });
      transitionedToRunning = true;

      // Build the prompt from agent system prompt + task description
      const prompt = this.buildPrompt(task, agent, workDir);
      await session.send(prompt);

      // Wait for completion (the mock adapter resolves immediately;
      // the real SDK streams events until session.idle)
      await this.waitForIdle(session.id, this.taskSessionIdleTimeoutMs, idlePromise);

      // Capture artifacts if we have a working directory
      if (workDir) {
        this.artifactCollector.captureDiff(taskId, workDir);
        this.artifactCollector.captureMarkdownFiles(taskId, workDir);
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
      // If acquire() failed before we transitioned to running, briefly transition
      // through 'running' so completeTask's state-machine assertion passes
      // (only running → failed is a valid transition).
      if (!transitionedToRunning) {
        try {
          this.taskManager.transitionTask(taskId, 'running', { sessionId: 'pre-acquire' });
        } catch { /* if not in queued state either, nothing we can do */ }
      }
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

  private buildRuntimeSessionOptions(agent: AgentDefinition): Partial<SessionOptions> {
    const runtimeConfig = this.taskRuntimeConfig?.get();
    if (!runtimeConfig) return {};

    const disabledMcpServers = new Set(runtimeConfig.disabledMcpServers.map(name => name.toLowerCase()));
    const configuredMcpServers = Object.fromEntries(
      Object.entries(runtimeConfig.mcpServers)
        .filter(([name]) => !disabledMcpServers.has(name.toLowerCase())),
    );
    const agentMcpServers = agent.mcpServers && agent.mcpServers.length > 0
      ? Object.fromEntries(
          Object.entries(configuredMcpServers)
            .filter(([name]) => agent.mcpServers!.some(agentName => agentName.toLowerCase() === name.toLowerCase())),
        )
      : configuredMcpServers;

    const dispatchAgentName = `dispatch-${agentSlug(agent.name)}`;
    const skillDirectories = runtimeConfig.useEnabledSkills && this.skillManager
      ? this.skillManager.getSkillDirs()
      : undefined;

    return {
      enableConfigDiscovery: runtimeConfig.enableConfigDiscovery,
      mcpServers: agentMcpServers,
      skillDirectories,
      disabledSkills: runtimeConfig.disabledSkills.length > 0 ? runtimeConfig.disabledSkills : undefined,
      availableTools: runtimeConfig.availableTools.length > 0 ? runtimeConfig.availableTools : undefined,
      excludedTools: runtimeConfig.excludedTools.length > 0 ? runtimeConfig.excludedTools : undefined,
      infiniteSessions: runtimeConfig.infiniteSessions,
      customAgents: [{
        name: dispatchAgentName,
        displayName: agent.name,
        description: agent.description,
        tools: null,
        prompt: agent.systemPrompt,
        mcpServers: agentMcpServers,
      }],
      agent: dispatchAgentName,
      tools: this.buildDispatchTools(),
    };
  }

  private buildDispatchTools(): SessionOptions['tools'] {
    const stringProperty = { type: 'string' };
    return [
      {
        name: 'dispatch_list_agents',
        description: 'List Dispatch agents available for routing work.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        skipPermission: true,
        handler: () => this.agentLoader.list().map(agent => ({
          name: agent.name,
          description: agent.description,
          model: agent.model,
          skills: agent.skills,
          tools: agent.tools,
          mcpServers: agent.mcpServers,
        })),
      },
      {
        name: 'dispatch_list_teams',
        description: 'List Dispatch agent teams and their lead/member agents.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        skipPermission: true,
        handler: () => this.teamRepo?.listAll().map(team => ({
          id: team.id,
          name: team.name,
          description: team.description,
          leadAgent: team.leadAgent,
          memberAgents: team.memberAgents,
        })) ?? [],
      },
      {
        name: 'dispatch_list_skills',
        description: 'List installed Dispatch skills and whether each is enabled.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        skipPermission: true,
        handler: () => this.skillManager?.listAll().map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          origin: skill.origin,
          enabled: skill.enabled,
        })) ?? [],
      },
      {
        name: 'dispatch_list_tasks',
        description: 'List recent Dispatch tasks with status, agent, and priority.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Optional task status filter.' },
            limit: { type: 'number', description: 'Maximum number of tasks to return.' },
          },
          additionalProperties: false,
        },
        skipPermission: true,
        handler: (args) => {
          const input = (args ?? {}) as { status?: string; limit?: number };
          return this.taskManager.listTasks(input.status as any, input.limit ?? 20).map(task => ({
            id: task.id,
            title: task.title,
            status: task.status,
            agent: task.agent,
            priority: task.priority,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          }));
        },
      },
      {
        name: 'dispatch_get_task',
        description: 'Get details for one Dispatch task by id.',
        parameters: {
          type: 'object',
          properties: { id: { ...stringProperty, description: 'Dispatch task id.' } },
          required: ['id'],
          additionalProperties: false,
        },
        skipPermission: true,
        handler: (args) => {
          const id = typeof (args as { id?: unknown })?.id === 'string' ? (args as { id: string }).id : '';
          if (!id) throw new Error('id is required');
          const task = this.taskManager.getTask(id);
          if (!task) throw new Error(`Task not found: ${id}`);
          return task;
        },
      },
      {
        name: 'dispatch_create_task',
        description: 'Create a follow-up Dispatch task. Created tasks still follow the normal queue/approval workflow.',
        parameters: {
          type: 'object',
          properties: {
            title: { ...stringProperty, description: 'Task title.' },
            description: { ...stringProperty, description: 'Optional task description.' },
            agent: { ...stringProperty, description: 'Agent handle, for example @general-purpose or @coder.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
          },
          required: ['title'],
          additionalProperties: false,
        },
        handler: (args) => {
          const input = (args ?? {}) as {
            title?: unknown;
            description?: unknown;
            agent?: unknown;
            priority?: unknown;
          };
          if (typeof input.title !== 'string' || input.title.trim().length === 0) {
            throw new Error('title is required');
          }
          const task = this.taskManager.createTask({
            title: input.title.trim(),
            description: typeof input.description === 'string' ? input.description : undefined,
            agent: typeof input.agent === 'string' ? input.agent : '@general-purpose',
            priority: ['low', 'normal', 'high', 'critical'].includes(String(input.priority))
              ? input.priority as any
              : 'normal',
            createdBy: 'dispatch-task-tool',
            metadata: { preApproved: false },
          });
          return {
            id: task.id,
            title: task.title,
            status: task.status,
            agent: task.agent,
            message: 'Task created. Enqueue it through the normal Dispatch approval flow when ready.',
          };
        },
      },
    ];
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

  private buildPrompt(task: Task, agent: AgentDefinition, workingDirectory?: string): string {
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

    if (workingDirectory) {
      parts.push(`\nWorking directory: ${workingDirectory}`);
      if (!task.repo) {
        parts.push('This is the Dispatch data directory. For installed agents and skills, use relative paths under `agents/` and `skills/`.');
      }
    }

    if (task.metadata && Object.keys(task.metadata).length > 0) {
      parts.push(`\nContext: ${JSON.stringify(task.metadata)}`);
    }

    return parts.join('\n');
  }

  private async waitForIdle(sessionId: string, timeoutMs: number, idlePromise: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for Copilot session ${sessionId} to become idle after ${timeoutMs}ms`));
      }, timeoutMs);

      idlePromise.then(() => {
        clearTimeout(timeout);
        resolve();
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private get taskSessionIdleTimeoutMs(): number {
    return this.executionSettings?.get().taskSessionIdleTimeoutMs ?? 300_000;
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

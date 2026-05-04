/**
 * GHC Dispatch Daemon
 *
 * Main process that starts:
 * - SQLite database
 * - Control plane (task manager, scheduler, policy engine, approval manager)
 * - Execution plane (agent loader, session pool, session runner)
 * - Surfaces (HTTP API + SSE, MCP server)
 * - Periodic jobs (GC, approval expiry)
 */

import { join } from 'node:path';
import { getDb, closeDb } from './store/db.js';
import { TaskRepo } from './store/task-repo.js';
import { EventRepo } from './store/event-repo.js';
import { CheckpointRepo } from './store/checkpoint-repo.js';
import { SchedulerQueueRepo } from './store/scheduler-queue-repo.js';
import { TeamRepo } from './store/team-repo.js';
import { TaskManager } from './control-plane/task-manager.js';
import { LocalEventBus } from './control-plane/event-bus.js';
import { Scheduler } from './control-plane/scheduler.js';
import { PolicyEngine } from './control-plane/policy-engine.js';
import { ApprovalManager } from './control-plane/approval-manager.js';
import { MockCopilotAdapter, CopilotSdkAdapter } from './execution/copilot-adapter.js';
import { SessionPool } from './execution/session-pool.js';
import { agentHandle, AgentLoader } from './execution/agent-loader.js';
import { WorktreeManager } from './execution/worktree-manager.js';
import { ArtifactCollector } from './execution/artifact-collector.js';
import { SessionRunner } from './execution/session-runner.js';
import { TaskRuntimeConfigManager } from './execution/task-runtime-config.js';
import { ConversationRepo } from './store/conversation-repo.js';
import { WikiManager } from './wiki/wiki-manager.js';
import { MemoryManager } from './memory/memory-manager.js';
import { SkillManager } from './skills/skill-manager.js';
import { AutomationScheduler } from './automation/automation-scheduler.js';
import { ModelManager } from './execution/model-manager.js';
import { ExecutionSettingsManager } from './execution/execution-settings.js';
import { DiscordBot } from './surfaces/discord-bot.js';
import { ProactiveCheckIn } from './automation/proactive-checkin.js';
import { GitHubEventHandler } from './automation/github-events.js';
import { BrowserEngine } from './browser/browser-engine.js';
import { HotReloader } from './execution/hot-reloader.js';
import { createApi } from './surfaces/api.js';
import { loadConfig } from './config.js';
import { paths, ensureDataDirs } from './paths.js';

export async function startDaemon(): Promise<void> {
  ensureDataDirs();
  const config = loadConfig();
  const executionSettings = new ExecutionSettingsManager(paths.executionSettingsPath, {
    maxConcurrentSessions: config.maxConcurrentSessions,
    taskSessionIdleTimeoutMs: 300_000,
  });
  const effectiveExecutionSettings = executionSettings.get();
  const effectiveMaxSessions = effectiveExecutionSettings.maxConcurrentSessions;

  console.log('🚀 GHC Dispatch starting...');
  console.log(`   Data dir: ${paths.dataDir}`);
  console.log(`   API port: ${config.apiPort}`);
  console.log(`   Max sessions: ${effectiveMaxSessions}`);
  console.log(`   Task idle timeout: ${effectiveExecutionSettings.taskSessionIdleTimeoutMs}ms`);

  // --- Database ---
  const db = getDb();
  const taskRepo = new TaskRepo(db);
  const eventRepo = new EventRepo(db);
  const checkpointRepo = new CheckpointRepo(db);
  const schedulerQueueRepo = new SchedulerQueueRepo(db);
  const teamRepo = new TeamRepo(db);

  // --- Control Plane ---
  const eventBus = new LocalEventBus();
  const taskManager = new TaskManager(taskRepo, eventRepo, eventBus, checkpointRepo);
  const scheduler = new Scheduler(taskRepo, eventBus, {
    maxGlobalConcurrent: effectiveMaxSessions,
    maxPerRepo: Math.max(1, Math.floor(effectiveMaxSessions / 2)),
    maxPerUser: effectiveMaxSessions,
    agingBoostMs: 60_000,
  }, schedulerQueueRepo);
  const policyEngine = new PolicyEngine();
  const approvalManager = new ApprovalManager(db, eventRepo, eventBus);

  // --- Execution Plane ---
  const useMock = process.env.GHC_MOCK_COPILOT === '1' || process.env.NODE_ENV === 'test';
  let copilotAdapter: MockCopilotAdapter | CopilotSdkAdapter =
    useMock ? new MockCopilotAdapter() : new CopilotSdkAdapter();

  try {
    await copilotAdapter.start();
    console.log(`   Copilot: ${useMock ? 'mock' : 'SDK'} adapter started`);
  } catch (err: any) {
    console.warn(`   ⚠️  Copilot SDK failed to start, falling back to mock: ${err.message}`);
    copilotAdapter = new MockCopilotAdapter();
    await copilotAdapter.start();
  }

  const sessionPool = new SessionPool(copilotAdapter, {
    maxConcurrent: effectiveMaxSessions,
    defaultRemote: config.copilotDefaultRemote,
  });
  console.log(`   Copilot remote default: ${config.copilotDefaultRemote ? 'on (/remote prepended)' : 'off'}`);

  const bundledAgentsDir = join(import.meta.dirname ?? '.', '..', 'agents');
  const agentLoader = new AgentLoader([bundledAgentsDir, paths.agentsDir]);
  console.log(`   Agents: ${agentLoader.list().map(a => agentHandle(a.name)).join(', ')}`);

  const worktreeManager = new WorktreeManager(paths.worktreesDir);
  const artifactCollector = new ArtifactCollector(paths.artifactsDir);

  // --- Memory System ---
  const conversationRepo = new ConversationRepo(db);
  const wikiManager = new WikiManager(paths.wikiDir);
  const memoryManager = new MemoryManager(db, conversationRepo, wikiManager);
  memoryManager.startBackgroundProcessing();
  console.log(`   Memory: conversation log + episodic writer + proactive extractor`);

  // --- Skills ---
  const bundledSkillsDir = join(import.meta.dirname ?? '.', '..', 'skills');
  const skillManager = new SkillManager(db, paths.skillsDir, bundledSkillsDir);
  const skillCount = skillManager.listAll().length;
  const systemSkills = skillManager.listSystemCreated().length;
  console.log(`   Skills: ${skillCount} installed (${systemSkills} system-created)`);
  const taskRuntimeConfig = new TaskRuntimeConfigManager(paths.taskRuntimeConfigPath);
  console.log(`   Task runtime: ${taskRuntimeConfig.get().mode} (${taskRuntimeConfig.path})`);

  // --- Automation ---
  const automationScheduler = new AutomationScheduler(db, eventBus, taskManager);
  automationScheduler.startAll();
  const autoJobs = automationScheduler.listEnabled().length;
  console.log(`   Automation: ${autoJobs} active job(s)`);

  // --- Model Manager ---
  const modelManager = new ModelManager(config.copilotModel, db);
  console.log(`   Model: ${modelManager.getDefault()} (default)`);

  const sessionRunner = new SessionRunner(
    taskManager, agentLoader, sessionPool, worktreeManager,
    artifactCollector, eventBus, config, modelManager, skillManager, taskRuntimeConfig, teamRepo, executionSettings,
  );

  // --- Proactive Check-Ins ---
  const checkIn = new ProactiveCheckIn(taskManager, approvalManager, memoryManager, automationScheduler);
  checkIn.onCheckIn((messages) => {
    const text = ProactiveCheckIn.formatMessages(messages);
    console.log(`\n🔔 Check-in:\n${text}\n`);
  });
  checkIn.start();

  // --- GitHub Events Handler ---
  const githubEvents = new GitHubEventHandler(taskManager, memoryManager);

  // --- Browser Engine ---
  const browserEngine = new BrowserEngine({
    headless: true,
    screenshotDir: join(paths.dataDir, 'screenshots'),
  });

  // --- Hot Reload ---
  const hotReloader = new HotReloader(agentLoader, skillManager, [
    bundledAgentsDir, paths.agentsDir, paths.skillsDir,
  ]);
  hotReloader.start();

  // --- Workspace recovery + durable queue restore ---
  // Queued tasks are idempotently present in the durable scheduler table.
  const queuedOnStartup = taskRepo.listByStatus('queued');
  for (const t of queuedOnStartup) scheduler.enqueue(t);
  if (queuedOnStartup.length > 0) {
    console.log(`   Scheduler: restored ${queuedOnStartup.length} queued task(s) from durable state`);
  }

  // Running tasks mean the previous daemon exited mid-run. Preserve their
  // worktree/checkpoint/event context and pause them for explicit recovery.
  const interruptedRunning = taskRepo.listByStatus('running');
  for (const t of interruptedRunning) {
    if (t.workingDirectory) {
      worktreeManager.attach(t.id, t.workingDirectory);
    }
    scheduler.cancel(t.id);
    const latestCheckpoint = checkpointRepo.getLatestByTask(t.id);
    const events = eventRepo.getByTaskId(t.id);
    taskManager.prepareRecovery(t.id, {
      interruptedAt: new Date().toISOString(),
      workingDirectory: t.workingDirectory ?? null,
      latestCheckpoint: latestCheckpoint ?? null,
      eventCount: events.length,
      options: ['resume', 'restart', 'abandon'],
    });
  }
  if (interruptedRunning.length > 0) {
    console.log(`   Recovery: paused ${interruptedRunning.length} interrupted running task(s)`);
  }

  // --- Scheduler Loop ---
  eventBus.on('task.completed', (event) => {
    if (!('taskId' in event)) return;
    const task = taskManager.getTask(event.taskId);
    if (task?.metadata.teamRole !== 'lead') return;

    for (const subtask of taskManager.getSubtasks(task.id)) {
      if (subtask.status !== 'pending' || !taskManager.areDependenciesMet(subtask)) continue;
      if (subtask.metadata.preApproved === true || subtask.metadata.preApproved === 'true') {
        taskManager.enqueueTask(subtask.id);
        continue;
      }
      const existingApproval = approvalManager.getByTask(subtask.id).find(a =>
        a.type === 'custom' && a.description.startsWith('Approve execution for task')
      );
      if (existingApproval?.status === 'approved') {
        taskManager.enqueueTask(subtask.id);
        continue;
      }
      if (!existingApproval) {
        approvalManager.create({
          taskId: subtask.id,
          type: 'custom',
          description: `Approve execution for task "${subtask.title}"`,
          evidence: [
            `Team: ${subtask.metadata.teamName ?? 'unknown'}`,
            `Lead task completed: ${task.id}`,
          ],
        });
      }
    }
  });

  eventBus.on('approval.decided', (event) => {
    if (event.type !== 'approval.decided' || event.decision !== 'approved') return;
    const approval = approvalManager.getById(event.approvalId);
    if (!approval || approval.type !== 'custom' || !approval.description.startsWith('Approve execution for task')) return;

    const task = taskManager.getTask(approval.taskId);
    if (!task || task.status !== 'pending' || !taskManager.areDependenciesMet(task)) return;
    taskManager.enqueueTask(task.id);
  });

  const schedulerInterval = setInterval(() => {
    const taskId = scheduler.dequeue();
    if (taskId) {
      sessionRunner.executeTask(taskId).catch(err => {
        console.error(`Task ${taskId} execution error:`, err.message);
      });
    }
  }, 1000);

  const schedulerHeartbeatInterval = setInterval(() => {
    scheduler.heartbeatActiveLeases();
  }, 60_000);

  // --- Periodic GC ---
  const gcInterval = setInterval(() => {
    // Expire stale approvals
    approvalManager.expireStale();

    // Clean up old worktrees
    worktreeManager.cleanupStale(config.worktreeRetentionMinutes * 60_000).catch(() => {});

    // Clean up old events
    const cutoff = new Date(Date.now() - config.logRetentionDays * 86_400_000).toISOString();
    eventRepo.deleteOlderThan(cutoff);
  }, 60_000);

  // --- Listen for task state changes to update scheduler ---
  eventBus.on('task.queued', (event) => {
    if ('taskId' in event) {
      const task = taskRepo.getById(event.taskId);
      if (task) scheduler.enqueue(task);
    }
  });

  eventBus.on('task.completed', (event) => {
    if ('taskId' in event) {
      const task = taskRepo.getById(event.taskId);
      if (task) scheduler.markCompleted(task);
    }
  });

  eventBus.on('task.failed', (event) => {
    if ('taskId' in event) {
      const task = taskRepo.getById(event.taskId);
      if (task) scheduler.markCompleted(task);
    }
  });

  eventBus.on('task.cancelled', (event) => {
    if ('taskId' in event) {
      const task = taskRepo.getById(event.taskId);
      if (task) {
        scheduler.cancel(task.id);
        scheduler.markCompleted(task);
      }
    }
  });

  // --- HTTP API ---
  const api = createApi({
    taskManager, approvalManager, scheduler,
    sessionPool, agentLoader, sessionRunner, eventBus,
    memoryManager, skillManager, automationScheduler, modelManager,
    checkIn, githubEvents, browserEngine, hotReloader, artifactCollector, teamRepo, taskRuntimeConfig, executionSettings,
  });

  const server = api.listen(config.apiPort, () => {
    console.log(`\n✅ GHC Dispatch running on http://localhost:${config.apiPort}`);
    console.log(`   API: http://localhost:${config.apiPort}/api`);
    console.log(`   SSE: http://localhost:${config.apiPort}/api/events/stream`);
    console.log(`   Health: http://localhost:${config.apiPort}/api/health`);
  });
  server.maxConnections = 128;
  server.keepAliveTimeout = 1000;
  server.headersTimeout = 5000;
  server.requestTimeout = 30_000;
  server.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(false);
  });

  // --- Discord Bot ---
  let discordBot: DiscordBot | null = null;
  if (config.discordBotToken) {
    discordBot = new DiscordBot({
      taskManager, approvalManager, sessionRunner,
      skillManager, memoryManager, eventBus, modelManager, agentLoader, teamRepo, config,
    });
    try {
      await discordBot.start();
    } catch (err: any) {
      console.warn(`   ⚠️  Discord bot failed to start: ${err.message}`);
      discordBot = null;
    }
  } else {
    console.log('   Discord: not configured (set DISCORD_BOT_TOKEN to enable)');
  }

  console.log('');

  // --- Graceful Shutdown ---
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    clearInterval(schedulerInterval);
    clearInterval(schedulerHeartbeatInterval);
    clearInterval(gcInterval);
    memoryManager.stopBackgroundProcessing();
    automationScheduler.stopAll();
    checkIn.stop();
    hotReloader.stop();
    await browserEngine.close();
    if (discordBot) await discordBot.stop();
    server.close();
    await sessionPool.releaseAll();
    if (copilotAdapter.isRunning()) await copilotAdapter.stop();
    closeDb();
    console.log('   Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run when executed directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('daemon.ts') || process.argv[1]?.endsWith('daemon.js')) {
  startDaemon().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

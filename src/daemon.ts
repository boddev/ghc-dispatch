/**
 * GHC Orchestrator Daemon
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
import { TaskManager } from './control-plane/task-manager.js';
import { LocalEventBus } from './control-plane/event-bus.js';
import { Scheduler } from './control-plane/scheduler.js';
import { PolicyEngine } from './control-plane/policy-engine.js';
import { ApprovalManager } from './control-plane/approval-manager.js';
import { MockCopilotAdapter, CopilotSdkAdapter } from './execution/copilot-adapter.js';
import { SessionPool } from './execution/session-pool.js';
import { AgentLoader } from './execution/agent-loader.js';
import { WorktreeManager } from './execution/worktree-manager.js';
import { ArtifactCollector } from './execution/artifact-collector.js';
import { SessionRunner } from './execution/session-runner.js';
import { ConversationRepo } from './store/conversation-repo.js';
import { WikiManager } from './wiki/wiki-manager.js';
import { MemoryManager } from './memory/memory-manager.js';
import { SkillManager } from './skills/skill-manager.js';
import { AutomationScheduler } from './automation/automation-scheduler.js';
import { ModelManager } from './execution/model-manager.js';
import { DiscordBot } from './surfaces/discord-bot.js';
import { createApi } from './surfaces/api.js';
import { loadConfig } from './config.js';
import { paths, ensureDataDirs } from './paths.js';

export async function startDaemon(): Promise<void> {
  ensureDataDirs();
  const config = loadConfig();

  console.log('🚀 GHC Orchestrator starting...');
  console.log(`   Data dir: ${paths.dataDir}`);
  console.log(`   API port: ${config.apiPort}`);
  console.log(`   Max sessions: ${config.maxConcurrentSessions}`);

  // --- Database ---
  const db = getDb();
  const taskRepo = new TaskRepo(db);
  const eventRepo = new EventRepo(db);

  // --- Control Plane ---
  const eventBus = new LocalEventBus();
  const taskManager = new TaskManager(taskRepo, eventRepo, eventBus);
  const scheduler = new Scheduler(taskRepo, eventBus, {
    maxGlobalConcurrent: config.maxConcurrentSessions,
    maxPerRepo: Math.max(1, Math.floor(config.maxConcurrentSessions / 2)),
    maxPerUser: config.maxConcurrentSessions,
    agingBoostMs: 60_000,
  });
  const policyEngine = new PolicyEngine();
  const approvalManager = new ApprovalManager(db, eventRepo, eventBus);

  // --- Execution Plane ---
  const useMock = process.env.GHC_MOCK_COPILOT === '1' || process.env.NODE_ENV === 'test';
  const copilotAdapter = useMock ? new MockCopilotAdapter() : new CopilotSdkAdapter();

  try {
    await copilotAdapter.start();
    console.log(`   Copilot: ${useMock ? 'mock' : 'SDK'} adapter started`);
  } catch (err: any) {
    console.warn(`   ⚠️  Copilot SDK failed to start, falling back to mock: ${err.message}`);
    const fallback = new MockCopilotAdapter();
    await fallback.start();
  }

  const sessionPool = new SessionPool(copilotAdapter, { maxConcurrent: config.maxConcurrentSessions });

  const bundledAgentsDir = join(import.meta.dirname ?? '.', '..', 'agents');
  const agentLoader = new AgentLoader([bundledAgentsDir, paths.agentsDir]);
  console.log(`   Agents: ${agentLoader.list().map(a => `@${a.name.toLowerCase().replace(/\s+/g, '-')}`).join(', ')}`);

  const worktreeManager = new WorktreeManager(paths.worktreesDir);
  const artifactCollector = new ArtifactCollector(join(paths.dataDir, 'artifacts'));

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
    artifactCollector, eventBus, config, modelManager,
  );

  // --- Scheduler Loop ---
  const schedulerInterval = setInterval(() => {
    const taskId = scheduler.dequeue();
    if (taskId) {
      sessionRunner.executeTask(taskId).catch(err => {
        console.error(`Task ${taskId} execution error:`, err.message);
      });
    }
  }, 1000);

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
  });

  const server = api.listen(config.apiPort, () => {
    console.log(`\n✅ GHC Orchestrator running on http://localhost:${config.apiPort}`);
    console.log(`   API: http://localhost:${config.apiPort}/api`);
    console.log(`   SSE: http://localhost:${config.apiPort}/api/events/stream`);
    console.log(`   Health: http://localhost:${config.apiPort}/api/health`);
  });

  // --- Discord Bot ---
  let discordBot: DiscordBot | null = null;
  if (config.discordBotToken) {
    discordBot = new DiscordBot({
      taskManager, approvalManager, sessionRunner,
      skillManager, memoryManager, eventBus, modelManager, config,
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
    clearInterval(gcInterval);
    memoryManager.stopBackgroundProcessing();
    automationScheduler.stopAll();
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

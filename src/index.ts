#!/usr/bin/env node

/**
 * dispatch — GHC Dispatch CLI
 *
 * Usage:
 *   dispatch --create <title> [--agent @coder] [--priority high] [--repo path]
 *   dispatch --status <task-id>
 *   dispatch --list [--status running] [--limit 20]
 *   dispatch --cancel <task-id>
 *   dispatch --retry <task-id>
 *   dispatch --enqueue <task-id>
 *   dispatch --events <task-id>
 *   dispatch --stats
 *   dispatch --start
 *   dispatch --help
 */

import { getDb, closeDb } from './store/db.js';
import { TaskRepo } from './store/task-repo.js';
import { EventRepo } from './store/event-repo.js';
import { TaskManager } from './control-plane/task-manager.js';
import { LocalEventBus } from './control-plane/event-bus.js';
import type { Priority, TaskStatus } from './control-plane/task-model.js';
import { loadConfig } from './config.js';
import { ensureDataDirs } from './paths.js';

function createOrchestrator() {
  ensureDataDirs();
  const db = getDb();
  const taskRepo = new TaskRepo(db);
  const eventRepo = new EventRepo(db);
  const eventBus = new LocalEventBus();
  return new TaskManager(taskRepo, eventRepo, eventBus);
}

function printTask(task: any): void {
  const status = task.status.toUpperCase().padEnd(10);
  const pri = task.priority.padEnd(8);
  console.log(`  ${task.id}  ${status} ${pri} ${task.agent.padEnd(18)} ${task.title}`);
}

function printTaskDetail(task: any): void {
  console.log(`
  Task: ${task.id}
  Title: ${task.title}
  Description: ${task.description || '(none)'}
  Status: ${task.status}
  Priority: ${task.priority}
  Agent: ${task.agent}
  Repo: ${task.repo || '(none)'}
  Created: ${task.createdAt}
  Updated: ${task.updatedAt}
  Retries: ${task.retryCount}/${task.maxRetries}
  Dependencies: ${task.dependsOn.length ? task.dependsOn.join(', ') : '(none)'}
  ${task.result ? `Result: ${JSON.stringify(task.result, null, 2)}` : ''}
`);
}

const HELP_TEXT = `
  dispatch — GHC Dispatch CLI

  Usage: dispatch --<command> [arguments] [options]

  Commands:
    --create <title>           Create a new task
        --agent <agent>          Agent to assign (default: @general-purpose)
        --priority <level>       critical | high | normal | low (default: normal)
        --model <model>          Model to use for this task (overrides agent default)
        --repo <path>            Target repository path
        --description <text>     Task description
        --dry-run                Print resolved agent/model/workdir without creating

    --status <task-id>         Show task details
    --list                     List all tasks
        --filter-status <s>      Filter by status (pending|running|completed|failed|...)
        --limit <n>              Max results (default: 20)

    --cancel <task-id>         Cancel a task
        --reason <text>          Cancellation reason

    --retry <task-id>          Retry a failed task
    --enqueue <task-id>        Queue a pending task for execution
    --events <task-id>         Show event history for a task
    --stats                    Show task statistics

    --model                    Show current default model
    --model <name>             Switch the default model
    --model <name> --agent <a> Switch model for a specific agent
    --models                   List all available models

    --reload                   Hot-reload agents and skills
    --update                   Update dispatch to the latest version
    --restart                  Restart the daemon (spawns replacement process)

    --start                    Start the orchestrator daemon
    --help                     Show this help message
    --version                  Show version

  Examples:
    dispatch --create "Fix auth bug" --agent @coder --priority high
    dispatch --create "Refactor" --agent @coder --model gpt-5.5
    dispatch --model claude-opus-4.7
    dispatch --model gpt-5.4 --agent @coder
    dispatch --models
    dispatch --reload
    dispatch --update
    dispatch --restart
    dispatch --list --filter-status running
    dispatch --status 01KQ3ECDV5CJMS9DACYVJGM69K
    dispatch --cancel 01KQ3ECDV5CJMS9DACYVJGM69K --reason "No longer needed"
    dispatch --start
`;

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  const val = args[idx + 1];
  // Don't return the next flag as a value
  if (val.startsWith('--')) return undefined;
  return val;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  const args = process.argv.slice(2);

  // Help
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(HELP_TEXT);
    return;
  }

  // No arguments → start daemon + launch TUI
  if (args.length === 0) {
    const { startDaemon } = await import('./daemon.js');
    const { startTui } = await import('./surfaces/tui.js');

    // Check if daemon is already running
    let daemonRunning = false;
    try {
      const resp = await fetch('http://localhost:7878/api/health');
      if (resp.ok) daemonRunning = true;
    } catch {}

    if (!daemonRunning) {
      // Start daemon in background (don't await — it runs forever)
      startDaemon().catch(err => {
        console.error('Daemon error:', err.message);
      });
      // Give daemon a moment to start
      await new Promise(r => setTimeout(r, 2000));
    }

    // Launch TUI
    await startTui();
    return;
  }

  if (hasFlag(args, '--version') || hasFlag(args, '-v')) {
    console.log('dispatch 0.1.0');
    return;
  }

  // --start: launch the daemon
  if (hasFlag(args, '--start')) {
    const { startDaemon } = await import('./daemon.js');
    await startDaemon();
    return;
  }

  // --update: self-update
  if (hasFlag(args, '--update')) {
    console.log('🔄 Checking for updates...');
    // Try the running daemon first
    try {
      const resp = await fetch('http://localhost:7878/api/update', { method: 'POST' });
      const data = await resp.json() as any;
      if (data.success) {
        console.log(`✅ Updated: ${data.previousVersion} → ${data.newVersion} (via ${data.method})`);
      } else {
        console.error(`❌ Update failed: ${data.output}`);
      }
    } catch {
      // Daemon not running — do it locally
      const { selfUpdate } = await import('./execution/self-manage.js');
      const result = selfUpdate(process.cwd());
      if (result.success) {
        console.log(`✅ Updated: ${result.previousVersion} → ${result.newVersion} (via ${result.method})`);
      } else {
        console.error(`❌ Update failed: ${result.output}`);
      }
    }
    return;
  }

  // --restart: restart the daemon
  if (hasFlag(args, '--restart')) {
    // Try the running daemon first
    try {
      const resp = await fetch('http://localhost:7878/api/restart', { method: 'POST' });
      const data = await resp.json() as any;
      console.log(`🔄 ${data.message ?? 'Restart signal sent'}`);
    } catch {
      // Daemon not running — start fresh
      const { selfRestart } = await import('./execution/self-manage.js');
      selfRestart(process.cwd());
    }
    return;
  }

  // --reload: hot-reload agents and skills via API
  if (hasFlag(args, '--reload')) {
    try {
      const resp = await fetch('http://localhost:7878/api/reload', { method: 'POST' });
      const data = await resp.json() as any;
      console.log(`✅ Reloaded: ${data.agents} agents, ${data.skills} skills`);
    } catch {
      // Fallback: direct reload if daemon isn't running
      const { AgentLoader } = await import('./execution/agent-loader.js');
      const { SkillManager } = await import('./skills/skill-manager.js');
      const { join } = await import('node:path');
      const { paths: p } = await import('./paths.js');
      const bundledDir = join(import.meta.dirname ?? '.', '..', 'agents');
      const al = new AgentLoader([bundledDir, p.agentsDir]);
      console.log(`✅ Reloaded ${al.list().length} agents (daemon not running — local reload only)`);
    }
    return;
  }

  const tm = createOrchestrator();

  try {
    if (hasFlag(args, '--create')) {
      const title = getFlag(args, '--create');
      if (!title) { console.error('Error: --create requires a title.  Usage: dispatch --create "task title"'); process.exit(1); }
      const agent = getFlag(args, '--agent') ?? '@general-purpose';
      const priority = (getFlag(args, '--priority') ?? 'normal') as Priority;
      const model = getFlag(args, '--model');
      const repo = getFlag(args, '--repo');
      const description = getFlag(args, '--description') ?? '';
      if (hasFlag(args, '--dry-run')) {
        const { agentHandle, AgentLoader } = await import('./execution/agent-loader.js');
        const { ModelManager } = await import('./execution/model-manager.js');
        const { join } = await import('node:path');
        const { paths: p } = await import('./paths.js');
        const bundledDir = join(import.meta.dirname ?? '.', '..', 'agents');
        const agentLoader = new AgentLoader([bundledDir, p.agentsDir]);
        const agentDefinition = agentLoader.get(agent) ?? agentLoader.getDefault();
        const resolvedAgent = agentHandle(agentDefinition.name);
        const modelManager = new ModelManager(loadConfig().copilotModel, getDb());
        const resolvedModel = modelManager.resolveModel(model, resolvedAgent, agentDefinition.model);

        console.log('\n  Dry run: task would be created with:');
        console.log(`    Title: ${title}`);
        console.log(`    Description: ${description || '(none)'}`);
        console.log(`    Agent: ${resolvedAgent}`);
        console.log(`    Priority: ${priority}`);
        console.log(`    Model: ${resolvedModel}`);
        console.log(`    Repo: ${repo ?? '(none)'}`);
        console.log(`    Working directory: ${repo ? `${p.worktreesDir}\\<task-id>` : '(none)'}`);
        console.log();
        return;
      }
      const task = tm.createTask({ title, description, agent, priority, model, repo });
      console.log(`✅ Task created: ${task.id}`);
      printTaskDetail(task);
    }

    else if (hasFlag(args, '--status')) {
      const id = getFlag(args, '--status');
      if (!id) { console.error('Error: --status requires a task ID.  Usage: dispatch --status <task-id>'); process.exit(1); }
      const task = tm.getTask(id);
      if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
      printTaskDetail(task);
    }

    else if (hasFlag(args, '--list')) {
      const status = getFlag(args, '--filter-status') as TaskStatus | undefined;
      const limit = parseInt(getFlag(args, '--limit') ?? '20', 10);
      const tasks = tm.listTasks(status, limit);
      if (tasks.length === 0) {
        console.log('  No tasks found.');
      } else {
        console.log(`  ${'ID'.padEnd(28)} ${'STATUS'.padEnd(10)} ${'PRIORITY'.padEnd(8)} ${'AGENT'.padEnd(18)} TITLE`);
        console.log(`  ${'─'.repeat(90)}`);
        tasks.forEach(printTask);
        console.log(`  ${tasks.length} task(s)`);
      }
    }

    else if (hasFlag(args, '--cancel')) {
      const id = getFlag(args, '--cancel');
      if (!id) { console.error('Error: --cancel requires a task ID.  Usage: dispatch --cancel <task-id>'); process.exit(1); }
      const reason = getFlag(args, '--reason') ?? 'Cancelled via CLI';
      const task = tm.cancelTask(id, reason);
      console.log(`🚫 Task cancelled: ${task.id}`);
    }

    else if (hasFlag(args, '--retry')) {
      const id = getFlag(args, '--retry');
      if (!id) { console.error('Error: --retry requires a task ID.  Usage: dispatch --retry <task-id>'); process.exit(1); }
      const task = tm.retryTask(id);
      console.log(`🔄 Task re-queued: ${task.id} (retry ${task.retryCount})`);
    }

    else if (hasFlag(args, '--enqueue')) {
      const id = getFlag(args, '--enqueue');
      if (!id) { console.error('Error: --enqueue requires a task ID.  Usage: dispatch --enqueue <task-id>'); process.exit(1); }
      const task = tm.enqueueTask(id);
      console.log(`📋 Task queued: ${task.id}`);
    }

    else if (hasFlag(args, '--events')) {
      const id = getFlag(args, '--events');
      if (!id) { console.error('Error: --events requires a task ID.  Usage: dispatch --events <task-id>'); process.exit(1); }
      const events = tm.getTaskEvents(id);
      if (events.length === 0) {
        console.log('  No events found.');
      } else {
        events.forEach(e => {
          console.log(`  [${e.timestamp}] ${e.payload.type}`);
          if ('content' in e.payload && e.payload.content) {
            console.log(`    ${(e.payload as any).content.substring(0, 120)}`);
          }
        });
      }
    }

    else if (hasFlag(args, '--stats')) {
      const stats = tm.getStats();
      console.log('\n  Task Statistics:');
      for (const [status, count] of Object.entries(stats)) {
        console.log(`    ${status.padEnd(12)} ${count}`);
      }
      console.log();
    }

    else if (hasFlag(args, '--models')) {
      const { ModelManager } = await import('./execution/model-manager.js');
      const mm = new ModelManager(loadConfig().copilotModel, getDb());
      console.log(`\n  Current default: ${mm.getDefault()}\n`);
      const overrides = mm.getAgentOverrides();
      if (Object.keys(overrides).length > 0) {
        console.log('  Agent overrides:');
        for (const [agent, model] of Object.entries(overrides)) {
          console.log(`    ${agent.padEnd(20)} ${model}`);
        }
        console.log();
      }
      console.log('  Available models:');
      console.log(`  ${'ID'.padEnd(24)} ${'NAME'.padEnd(24)} ${'PROVIDER'.padEnd(12)} TIER`);
      console.log(`  ${'─'.repeat(70)}`);
      for (const m of mm.listModels()) {
        const current = m.id === mm.getDefault() ? ' ◄' : '';
        console.log(`  ${m.id.padEnd(24)} ${m.name.padEnd(24)} ${m.provider.padEnd(12)} ${m.tier}${current}`);
      }
      console.log();
    }

    else if (hasFlag(args, '--model')) {
      const modelArg = getFlag(args, '--model');
      const agentArg = getFlag(args, '--agent');
      const { ModelManager } = await import('./execution/model-manager.js');
      const mm = new ModelManager(loadConfig().copilotModel, getDb());

      if (!modelArg) {
        // Show current model
        console.log(`\n  Current default model: ${mm.getDefault()}`);
        const overrides = mm.getAgentOverrides();
        if (Object.keys(overrides).length > 0) {
          console.log('  Agent overrides:');
          for (const [agent, model] of Object.entries(overrides)) {
            console.log(`    ${agent}: ${model}`);
          }
        }
        console.log();
      } else {
        const found = mm.findModel(modelArg);
        if (!found) {
          console.error(`Unknown model: ${modelArg}. Run dispatch --models for available models.`);
          process.exit(1);
        }
        if (agentArg) {
          mm.setAgentModel(agentArg, found.id);
          console.log(`✅ Agent ${agentArg} model switched to ${found.id}`);
        } else {
          mm.setDefault(found.id);
          console.log(`✅ Default model switched to ${found.id}`);
        }
      }
    }

    else {
      const unknown = args.find(a => a.startsWith('--'));
      console.error(`Unknown command: ${unknown ?? args[0]}\nRun dispatch --help for usage.`);
      process.exit(1);
    }
  } finally {
    closeDb();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

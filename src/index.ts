#!/usr/bin/env node

/**
 * GHC Orchestrator CLI
 *
 * Usage:
 *   ghc-orch create <title> [--agent @coder] [--priority high] [--repo owner/repo]
 *   ghc-orch status <task-id>
 *   ghc-orch list [--status running] [--limit 20]
 *   ghc-orch cancel <task-id>
 *   ghc-orch retry <task-id>
 *   ghc-orch events <task-id>
 *   ghc-orch stats
 */

import { getDb, closeDb } from './store/db.js';
import { TaskRepo } from './store/task-repo.js';
import { EventRepo } from './store/event-repo.js';
import { TaskManager } from './control-plane/task-manager.js';
import { LocalEventBus } from './control-plane/event-bus.js';
import type { Priority, TaskStatus } from './control-plane/task-model.js';
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    console.log(`
  GHC Orchestrator CLI

  Commands:
    create <title>          Create a new task
      --agent <agent>         Agent to assign (default: @general-purpose)
      --priority <priority>   Priority: critical|high|normal|low (default: normal)
      --repo <repo>           Target repository
      --description <desc>    Task description

    status <task-id>        Show task details
    list                    List all tasks
      --status <status>       Filter by status
      --limit <n>             Max results (default: 20)

    cancel <task-id>        Cancel a task
    retry <task-id>         Retry a failed task
    enqueue <task-id>       Queue a pending task for execution
    events <task-id>        Show event history for a task
    stats                   Show task statistics
`);
    return;
  }

  const tm = createOrchestrator();

  try {
    switch (command) {
      case 'create': {
        const title = args[1];
        if (!title) { console.error('Error: title required'); process.exit(1); }
        const agent = getFlag(args, '--agent') ?? '@general-purpose';
        const priority = (getFlag(args, '--priority') ?? 'normal') as Priority;
        const repo = getFlag(args, '--repo');
        const description = getFlag(args, '--description') ?? '';
        const task = tm.createTask({ title, description, agent, priority, repo });
        console.log(`✅ Task created: ${task.id}`);
        printTaskDetail(task);
        break;
      }

      case 'status': {
        const id = args[1];
        if (!id) { console.error('Error: task-id required'); process.exit(1); }
        const task = tm.getTask(id);
        if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
        printTaskDetail(task);
        break;
      }

      case 'list': {
        const status = getFlag(args, '--status') as TaskStatus | undefined;
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
        break;
      }

      case 'cancel': {
        const id = args[1];
        if (!id) { console.error('Error: task-id required'); process.exit(1); }
        const reason = getFlag(args, '--reason') ?? 'Cancelled via CLI';
        const task = tm.cancelTask(id, reason);
        console.log(`🚫 Task cancelled: ${task.id}`);
        break;
      }

      case 'retry': {
        const id = args[1];
        if (!id) { console.error('Error: task-id required'); process.exit(1); }
        const task = tm.retryTask(id);
        console.log(`🔄 Task re-queued: ${task.id} (retry ${task.retryCount})`);
        break;
      }

      case 'enqueue': {
        const id = args[1];
        if (!id) { console.error('Error: task-id required'); process.exit(1); }
        const task = tm.enqueueTask(id);
        console.log(`📋 Task queued: ${task.id}`);
        break;
      }

      case 'events': {
        const id = args[1];
        if (!id) { console.error('Error: task-id required'); process.exit(1); }
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
        break;
      }

      case 'stats': {
        const stats = tm.getStats();
        console.log('\n  Task Statistics:');
        for (const [status, count] of Object.entries(stats)) {
          console.log(`    ${status.padEnd(12)} ${count}`);
        }
        console.log();
        break;
      }

      default:
        console.error(`Unknown command: ${command}. Run with --help for usage.`);
        process.exit(1);
    }
  } finally {
    closeDb();
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

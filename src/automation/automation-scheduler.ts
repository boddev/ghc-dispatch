/**
 * Automation Scheduler
 *
 * Supports three trigger types:
 * - Cron: periodic jobs on a schedule (e.g. "every 5 minutes", "daily at 9am")
 * - Webhook: HTTP endpoints that trigger actions on incoming requests
 * - Event: react to internal system events (task.completed, approval.decided, etc.)
 */

import type Database from 'better-sqlite3';
import { execSync } from 'node:child_process';
import type { EventBus } from '../control-plane/event-bus.js';
import type { TaskManager } from '../control-plane/task-manager.js';
import { ulid } from 'ulid';

export type JobType = 'cron' | 'webhook' | 'event';
export type ActionType = 'create_task' | 'run_command' | 'http_request' | 'log';

export interface AutomationJob {
  id: string;
  name: string;
  type: JobType;
  schedule: string | null;
  webhookPath: string | null;
  eventType: string | null;
  action: ActionType;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CreateJobInput {
  name: string;
  type: JobType;
  schedule?: string;
  webhookPath?: string;
  eventType?: string;
  action: ActionType;
  actionConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface JobRunResult {
  jobId: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: string;
}

// Simple cron parser for common patterns
function parseCronInterval(schedule: string): number | null {
  const lower = schedule.toLowerCase().trim();

  // Direct milliseconds
  if (/^\d+ms$/.test(lower)) return parseInt(lower);

  // "every N minutes/hours/seconds"
  const everyMatch = lower.match(/^every\s+(\d+)\s+(second|minute|hour|day)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]);
    const unit = everyMatch[2];
    const multipliers: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
    return n * (multipliers[unit] ?? 60_000);
  }

  // Named schedules
  const named: Record<string, number> = {
    'every minute': 60_000,
    'every 5 minutes': 5 * 60_000,
    'every 15 minutes': 15 * 60_000,
    'every 30 minutes': 30 * 60_000,
    'hourly': 3_600_000,
    'every hour': 3_600_000,
    'daily': 86_400_000,
    'every day': 86_400_000,
  };
  if (named[lower]) return named[lower];

  return null;
}

export class AutomationScheduler {
  private stmts: ReturnType<typeof this.prepareStatements>;
  private cronTimers = new Map<string, ReturnType<typeof setInterval>>();
  private eventHandlers = new Map<string, (event: any) => void>();

  constructor(
    private db: Database.Database,
    private eventBus: EventBus,
    private taskManager: TaskManager,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO automation_jobs (id, name, type, schedule, webhook_path, event_type,
          action, action_config, enabled, next_run_at, created_at, updated_at, metadata)
        VALUES (@id, @name, @type, @schedule, @webhookPath, @eventType,
          @action, @actionConfig, @enabled, @nextRunAt, @createdAt, @updatedAt, @metadata)
      `),
      getById: this.db.prepare('SELECT * FROM automation_jobs WHERE id = ?'),
      getByWebhook: this.db.prepare('SELECT * FROM automation_jobs WHERE webhook_path = ? AND enabled = 1'),
      listAll: this.db.prepare('SELECT * FROM automation_jobs ORDER BY type, name'),
      listByType: this.db.prepare('SELECT * FROM automation_jobs WHERE type = ? ORDER BY name'),
      listEnabled: this.db.prepare('SELECT * FROM automation_jobs WHERE enabled = 1 ORDER BY type, name'),
      setEnabled: this.db.prepare('UPDATE automation_jobs SET enabled = @enabled, updated_at = @updatedAt WHERE id = @id'),
      recordRun: this.db.prepare(`
        UPDATE automation_jobs SET last_run_at = @lastRunAt, next_run_at = @nextRunAt,
          run_count = run_count + 1, updated_at = @updatedAt WHERE id = @id
      `),
      remove: this.db.prepare('DELETE FROM automation_jobs WHERE id = ?'),
    };
  }

  /** Create a new automation job */
  create(input: CreateJobInput): AutomationJob {
    const id = ulid();
    const now = new Date().toISOString();

    let nextRunAt: string | null = null;
    if (input.type === 'cron' && input.schedule) {
      const intervalMs = parseCronInterval(input.schedule);
      if (intervalMs) nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }

    this.stmts.insert.run({
      id,
      name: input.name,
      type: input.type,
      schedule: input.schedule ?? null,
      webhookPath: input.webhookPath ?? null,
      eventType: input.eventType ?? null,
      action: input.action,
      actionConfig: JSON.stringify(input.actionConfig ?? {}),
      enabled: 1,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify(input.metadata ?? {}),
    });

    const job = this.getById(id)!;
    this.activateJob(job);
    return job;
  }

  /** Get a job by ID */
  getById(id: string): AutomationJob | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToJob(row) : undefined;
  }

  /** List all jobs */
  listAll(): AutomationJob[] {
    return (this.stmts.listAll.all() as any[]).map(this.rowToJob);
  }

  /** List by type */
  listByType(type: JobType): AutomationJob[] {
    return (this.stmts.listByType.all(type) as any[]).map(this.rowToJob);
  }

  /** List enabled jobs */
  listEnabled(): AutomationJob[] {
    return (this.stmts.listEnabled.all() as any[]).map(this.rowToJob);
  }

  /** Enable/disable a job */
  setEnabled(id: string, enabled: boolean): boolean {
    const changes = this.stmts.setEnabled.run({
      id, enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString(),
    }).changes;
    if (changes > 0) {
      const job = this.getById(id)!;
      if (enabled) this.activateJob(job); else this.deactivateJob(id);
    }
    return changes > 0;
  }

  /** Remove a job */
  remove(id: string): boolean {
    this.deactivateJob(id);
    return this.stmts.remove.run(id).changes > 0;
  }

  /** Handle an incoming webhook request */
  async handleWebhook(path: string, payload: Record<string, unknown>): Promise<JobRunResult | null> {
    const row = this.stmts.getByWebhook.get(path) as any;
    if (!row) return null;
    const job = this.rowToJob(row);
    return this.executeJob(job, payload);
  }

  /** Start all enabled jobs (call on daemon startup) */
  startAll(): void {
    const jobs = this.listEnabled();
    for (const job of jobs) {
      this.activateJob(job);
    }
  }

  /** Stop all active jobs (call on shutdown) */
  stopAll(): void {
    for (const [id, timer] of this.cronTimers) {
      clearInterval(timer);
    }
    this.cronTimers.clear();

    for (const [eventType, handler] of this.eventHandlers) {
      this.eventBus.off(eventType, handler);
    }
    this.eventHandlers.clear();
  }

  /** Execute a job's action */
  async executeJob(job: AutomationJob, triggerData?: Record<string, unknown>): Promise<JobRunResult> {
    const now = new Date().toISOString();

    try {
      let output = '';

      switch (job.action) {
        case 'create_task': {
          const config = job.actionConfig as {
            title?: string; description?: string; agent?: string; priority?: string;
          };
          const task = this.taskManager.createTask({
            title: config.title ?? `Auto: ${job.name}`,
            description: config.description ?? `Triggered by automation job ${job.id}`,
            agent: config.agent ?? '@general-purpose',
            priority: (config.priority ?? 'normal') as any,
            createdBy: `automation:${job.id}`,
            metadata: { automationJobId: job.id, triggerData },
          });
          output = `Created task ${task.id}: ${task.title}`;
          break;
        }

        case 'run_command': {
          const cmd = (job.actionConfig as { command?: string }).command;
          if (!cmd) throw new Error('No command specified');
          output = execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim();
          break;
        }

        case 'http_request': {
          const config = job.actionConfig as { url?: string; method?: string; body?: string };
          if (!config.url) throw new Error('No URL specified');
          const resp = execSync(
            `curl -s -X ${config.method ?? 'GET'} "${config.url}" ${config.body ? `-d '${config.body}'` : ''}`,
            { encoding: 'utf-8', timeout: 30_000 },
          );
          output = resp.trim().slice(0, 1000);
          break;
        }

        case 'log': {
          const message = (job.actionConfig as { message?: string }).message ?? 'Automation triggered';
          output = `[${now}] ${message}`;
          console.log(`🤖 Automation [${job.name}]: ${message}`);
          break;
        }
      }

      // Record successful run
      let nextRunAt: string | null = null;
      if (job.type === 'cron' && job.schedule) {
        const intervalMs = parseCronInterval(job.schedule);
        if (intervalMs) nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      }
      this.stmts.recordRun.run({ id: job.id, lastRunAt: now, nextRunAt, updatedAt: now });

      return { jobId: job.id, success: true, output, timestamp: now };
    } catch (err: any) {
      this.stmts.recordRun.run({
        id: job.id, lastRunAt: now, nextRunAt: job.nextRunAt, updatedAt: now,
      });
      return { jobId: job.id, success: false, error: err.message, timestamp: now };
    }
  }

  private activateJob(job: AutomationJob): void {
    if (!job.enabled) return;

    switch (job.type) {
      case 'cron': {
        if (this.cronTimers.has(job.id)) return;
        const intervalMs = parseCronInterval(job.schedule ?? '');
        if (!intervalMs) return;

        const timer = setInterval(() => {
          this.executeJob(job).catch(err =>
            console.error(`Cron job ${job.name} failed:`, err.message)
          );
        }, intervalMs);
        this.cronTimers.set(job.id, timer);
        break;
      }

      case 'event': {
        if (!job.eventType || this.eventHandlers.has(job.id)) return;
        const handler = (event: any) => {
          this.executeJob(job, event).catch(err =>
            console.error(`Event job ${job.name} failed:`, err.message)
          );
        };
        this.eventBus.on(job.eventType, handler);
        this.eventHandlers.set(job.id, handler);
        break;
      }

      // Webhook jobs are passive — they're triggered via handleWebhook()
      case 'webhook':
        break;
    }
  }

  private deactivateJob(id: string): void {
    const timer = this.cronTimers.get(id);
    if (timer) { clearInterval(timer); this.cronTimers.delete(id); }

    const handler = this.eventHandlers.get(id);
    if (handler) {
      const job = this.getById(id);
      if (job?.eventType) this.eventBus.off(job.eventType, handler);
      this.eventHandlers.delete(id);
    }
  }

  private rowToJob(row: any): AutomationJob {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      schedule: row.schedule,
      webhookPath: row.webhook_path,
      eventType: row.event_type,
      action: row.action,
      actionConfig: JSON.parse(row.action_config),
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      runCount: row.run_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata),
    };
  }
}

// Re-export the cron parser for testing
export { parseCronInterval };

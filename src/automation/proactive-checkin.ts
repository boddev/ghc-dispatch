/**
 * Proactive Check-In System
 *
 * Periodically reviews system state and reaches out to users with relevant
 * information — failed tasks, stale approvals, patterns, suggestions.
 *
 * Like a coworker who notices things and taps you on the shoulder.
 */

import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { AutomationScheduler } from './automation-scheduler.js';

export interface CheckInConfig {
  /** How often to run the check-in (ms). Default: 30 minutes */
  intervalMs: number;
  /** Whether check-ins are enabled */
  enabled: boolean;
}

export interface CheckInMessage {
  type: 'warning' | 'info' | 'suggestion';
  title: string;
  body: string;
  timestamp: string;
}

export type CheckInHandler = (messages: CheckInMessage[]) => void;

const DEFAULT_CONFIG: CheckInConfig = {
  intervalMs: 30 * 60_000,
  enabled: true,
};

export class ProactiveCheckIn {
  private config: CheckInConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: CheckInHandler[] = [];
  private lastCheckIn: Date = new Date();

  constructor(
    private taskManager: TaskManager,
    private approvalManager: ApprovalManager,
    private memoryManager: MemoryManager,
    private automationScheduler: AutomationScheduler,
    config?: Partial<CheckInConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a handler to receive check-in messages (Discord, VS Code, etc.) */
  onCheckIn(handler: CheckInHandler): void {
    this.handlers.push(handler);
  }

  /** Start periodic check-ins */
  start(): void {
    if (!this.config.enabled || this.timer) return;

    this.timer = setInterval(() => {
      const messages = this.evaluate();
      if (messages.length > 0) {
        for (const handler of this.handlers) {
          try { handler(messages); } catch {}
        }
      }
      this.lastCheckIn = new Date();
    }, this.config.intervalMs);
  }

  /** Stop periodic check-ins */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Run a check-in evaluation now (useful for testing or manual trigger) */
  evaluate(): CheckInMessage[] {
    const messages: CheckInMessage[] = [];
    const now = new Date().toISOString();

    // 1. Failed tasks that haven't been retried
    const failed = this.taskManager.listTasks('failed');
    if (failed.length > 0) {
      const retriable = failed.filter(t => t.retryCount < t.maxRetries);
      if (retriable.length > 0) {
        messages.push({
          type: 'warning',
          title: `${retriable.length} failed task(s) awaiting attention`,
          body: retriable.map(t => `• **${t.title}** (${t.agent}) — ${t.result?.error?.slice(0, 80) ?? 'unknown error'}`).join('\n'),
          timestamp: now,
        });
      }
    }

    // 2. Pending approvals about to expire
    const approvals = this.approvalManager.getPending();
    if (approvals.length > 0) {
      const soonExpiring = approvals.filter(a => {
        const expiresAt = new Date(a.expiresAt).getTime();
        return expiresAt - Date.now() < 15 * 60_000; // < 15 minutes
      });

      if (soonExpiring.length > 0) {
        messages.push({
          type: 'warning',
          title: `${soonExpiring.length} approval(s) expiring soon`,
          body: soonExpiring.map(a => `• **${a.description}** — expires ${new Date(a.expiresAt).toLocaleTimeString()}`).join('\n'),
          timestamp: now,
        });
      } else if (approvals.length > 0) {
        messages.push({
          type: 'info',
          title: `${approvals.length} pending approval(s)`,
          body: approvals.map(a => `• ${a.description} (${a.type})`).join('\n'),
          timestamp: now,
        });
      }
    }

    // 3. Tasks stuck in "running" for too long (> 30 minutes)
    const running = this.taskManager.listTasks('running');
    const stuckThreshold = 30 * 60_000;
    const stuck = running.filter(t => Date.now() - new Date(t.updatedAt).getTime() > stuckThreshold);
    if (stuck.length > 0) {
      messages.push({
        type: 'warning',
        title: `${stuck.length} task(s) running for over 30 minutes`,
        body: stuck.map(t => `• **${t.title}** (${t.agent}) — started ${new Date(t.updatedAt).toLocaleTimeString()}`).join('\n'),
        timestamp: now,
      });
    }

    // 4. Queued tasks not progressing
    const queued = this.taskManager.listTasks('queued');
    const staleQueued = queued.filter(t => Date.now() - new Date(t.updatedAt).getTime() > 10 * 60_000);
    if (staleQueued.length > 0) {
      messages.push({
        type: 'info',
        title: `${staleQueued.length} task(s) waiting in queue for 10+ minutes`,
        body: `Consider checking session pool capacity or dependencies.`,
        timestamp: now,
      });
    }

    // 5. Daily summary suggestion (once per day, after enough activity)
    const memStats = this.memoryManager.getStats();
    if (memStats.totalMessages > 10) {
      const recentEpisodes = this.memoryManager.episodic.getRecentSummaries(1);
      const today = new Date().toISOString().split('T')[0];
      const hasTodaySummary = recentEpisodes.some(e => e.date === today);
      if (!hasTodaySummary && memStats.totalMessages > 20) {
        messages.push({
          type: 'suggestion',
          title: 'Daily conversation summary available',
          body: `${memStats.totalMessages} messages across ${Object.keys(memStats.messagesByChannel).length} channel(s). ` +
            `${memStats.totalFacts} facts known about ${memStats.totalEntities} entities.`,
          timestamp: now,
        });
      }
    }

    // 6. Recurring failures (same agent failing repeatedly)
    const taskStats = this.taskManager.getStats();
    if ((taskStats.failed ?? 0) >= 3) {
      const agentFailures = new Map<string, number>();
      for (const t of failed) {
        agentFailures.set(t.agent, (agentFailures.get(t.agent) ?? 0) + 1);
      }
      for (const [agent, count] of agentFailures) {
        if (count >= 3) {
          messages.push({
            type: 'suggestion',
            title: `${agent} has ${count} failed tasks`,
            body: `Consider switching the model or reviewing the agent's system prompt.`,
            timestamp: now,
          });
        }
      }
    }

    return messages;
  }

  /** Format check-in messages for display */
  static formatMessages(messages: CheckInMessage[]): string {
    if (messages.length === 0) return '✅ All clear — nothing to report.';

    const emoji = { warning: '⚠️', info: 'ℹ️', suggestion: '💡' };
    return messages.map(m =>
      `${emoji[m.type]} **${m.title}**\n${m.body}`
    ).join('\n\n');
  }
}

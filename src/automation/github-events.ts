/**
 * GitHub Events Webhook Handler
 *
 * Processes incoming GitHub webhook events and maps them to dispatch actions.
 * Point your GitHub repo webhook settings at:
 *   POST http://your-dispatch:7878/api/webhooks/github
 *
 * Supported events:
 * - push: code pushed to a branch
 * - pull_request: PR opened/closed/merged/reviewed
 * - issues: issue opened/closed/assigned
 * - check_run / check_suite: CI status changes
 * - release: new release published
 * - workflow_run: GitHub Actions workflow completed
 */

import type { TaskManager } from '../control-plane/task-manager.js';
import type { MemoryManager } from '../memory/memory-manager.js';

export interface GitHubEventConfig {
  /** Auto-create tasks for these event types */
  autoTaskEvents: string[];
  /** Default agent for auto-created tasks */
  defaultAgent: string;
  /** Whether to log events to conversation memory */
  logToMemory: boolean;
}

const DEFAULT_CONFIG: GitHubEventConfig = {
  autoTaskEvents: ['check_run.completed', 'issues.opened', 'pull_request.opened'],
  defaultAgent: '@coder',
  logToMemory: true,
};

export interface GitHubEventResult {
  event: string;
  action?: string;
  handled: boolean;
  taskId?: string;
  summary: string;
}

export class GitHubEventHandler {
  private config: GitHubEventConfig;

  constructor(
    private taskManager: TaskManager,
    private memoryManager: MemoryManager,
    config?: Partial<GitHubEventConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Process an incoming GitHub webhook payload */
  handle(eventType: string, payload: Record<string, any>): GitHubEventResult {
    const action = payload.action as string | undefined;
    const fullEvent = action ? `${eventType}.${action}` : eventType;

    // Log to conversation memory
    if (this.config.logToMemory) {
      const summary = this.summarizeEvent(eventType, action, payload);
      this.memoryManager.recordMessage({
        channel: 'github',
        threadId: this.getThreadId(eventType, payload),
        speaker: payload.sender?.login ?? 'github',
        speakerType: 'system',
        role: 'system',
        content: summary,
        metadata: { eventType, action, fullEvent },
      });
    }

    // Handle specific events
    switch (eventType) {
      case 'push':
        return this.handlePush(payload);
      case 'pull_request':
        return this.handlePullRequest(action, payload);
      case 'issues':
        return this.handleIssue(action, payload);
      case 'check_run':
        return this.handleCheckRun(action, payload);
      case 'check_suite':
        return this.handleCheckSuite(action, payload);
      case 'workflow_run':
        return this.handleWorkflowRun(action, payload);
      case 'release':
        return this.handleRelease(action, payload);
      case 'issue_comment':
        return this.handleComment(payload);
      default:
        return { event: fullEvent, action, handled: false, summary: `Unhandled event: ${fullEvent}` };
    }
  }

  private handlePush(payload: any): GitHubEventResult {
    const repo = payload.repository?.full_name ?? 'unknown';
    const branch = (payload.ref ?? '').replace('refs/heads/', '');
    const commits = payload.commits?.length ?? 0;
    const pusher = payload.pusher?.name ?? 'unknown';
    const summary = `${pusher} pushed ${commits} commit(s) to ${repo}/${branch}`;

    return { event: 'push', handled: true, summary };
  }

  private handlePullRequest(action: string | undefined, payload: any): GitHubEventResult {
    const pr = payload.pull_request ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const title = pr.title ?? 'Untitled PR';
    const author = pr.user?.login ?? 'unknown';
    const number = pr.number;
    const summary = `PR #${number} ${action}: "${title}" by ${author} in ${repo}`;

    let taskId: string | undefined;

    if (action === 'opened') {
      const task = this.taskManager.createTask({
        title: `Review PR #${number}: ${title}`,
        description: `PR opened by ${author} in ${repo}\n\n${(pr.body ?? '').slice(0, 500)}`,
        agent: this.config.defaultAgent,
        priority: 'normal',
        repo,
        createdBy: 'github:webhook',
        metadata: { githubEvent: 'pull_request.opened', prNumber: number, prUrl: pr.html_url },
      });
      taskId = task.id;
    }

    return { event: 'pull_request', action, handled: true, taskId, summary };
  }

  private handleIssue(action: string | undefined, payload: any): GitHubEventResult {
    const issue = payload.issue ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const title = issue.title ?? 'Untitled';
    const number = issue.number;
    const summary = `Issue #${number} ${action}: "${title}" in ${repo}`;

    let taskId: string | undefined;

    if (action === 'opened' || action === 'assigned') {
      const task = this.taskManager.createTask({
        title: `Investigate issue #${number}: ${title}`,
        description: `${(issue.body ?? '').slice(0, 500)}`,
        agent: this.config.defaultAgent,
        priority: issue.labels?.some((l: any) => l.name === 'bug') ? 'high' : 'normal',
        repo,
        createdBy: 'github:webhook',
        metadata: { githubEvent: `issues.${action}`, issueNumber: number, issueUrl: issue.html_url },
      });
      taskId = task.id;
    }

    return { event: 'issues', action, handled: true, taskId, summary };
  }

  private handleCheckRun(action: string | undefined, payload: any): GitHubEventResult {
    const check = payload.check_run ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const name = check.name ?? 'unknown check';
    const conclusion = check.conclusion ?? 'unknown';
    const summary = `Check "${name}" ${conclusion} in ${repo}`;

    let taskId: string | undefined;

    if (action === 'completed' && conclusion === 'failure') {
      const task = this.taskManager.createTask({
        title: `CI failure: ${name} in ${repo}`,
        description: `Check run "${name}" failed.\nOutput: ${(check.output?.summary ?? '').slice(0, 500)}`,
        agent: this.config.defaultAgent,
        priority: 'high',
        repo,
        createdBy: 'github:webhook',
        metadata: { githubEvent: 'check_run.failure', checkName: name, conclusion },
      });
      taskId = task.id;
    }

    return { event: 'check_run', action, handled: true, taskId, summary };
  }

  private handleCheckSuite(action: string | undefined, payload: any): GitHubEventResult {
    const suite = payload.check_suite ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const conclusion = suite.conclusion ?? 'unknown';
    return { event: 'check_suite', action, handled: true, summary: `Check suite ${conclusion} in ${repo}` };
  }

  private handleWorkflowRun(action: string | undefined, payload: any): GitHubEventResult {
    const run = payload.workflow_run ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const name = run.name ?? 'unknown workflow';
    const conclusion = run.conclusion ?? 'unknown';
    const summary = `Workflow "${name}" ${conclusion} in ${repo}`;

    let taskId: string | undefined;

    if (action === 'completed' && conclusion === 'failure') {
      const task = this.taskManager.createTask({
        title: `Workflow failure: ${name} in ${repo}`,
        description: `GitHub Actions workflow "${name}" failed.\nURL: ${run.html_url ?? ''}`,
        agent: this.config.defaultAgent,
        priority: 'high',
        repo,
        createdBy: 'github:webhook',
        metadata: { githubEvent: 'workflow_run.failure', workflowName: name },
      });
      taskId = task.id;
    }

    return { event: 'workflow_run', action, handled: true, taskId, summary };
  }

  private handleRelease(action: string | undefined, payload: any): GitHubEventResult {
    const release = payload.release ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const tag = release.tag_name ?? 'unknown';
    return { event: 'release', action, handled: true, summary: `Release ${tag} ${action} in ${repo}` };
  }

  private handleComment(payload: any): GitHubEventResult {
    const comment = payload.comment ?? {};
    const issue = payload.issue ?? {};
    const repo = payload.repository?.full_name ?? 'unknown';
    const author = comment.user?.login ?? 'unknown';
    return {
      event: 'issue_comment', handled: true,
      summary: `${author} commented on #${issue.number} in ${repo}: "${(comment.body ?? '').slice(0, 100)}"`,
    };
  }

  private summarizeEvent(eventType: string, action: string | undefined, payload: any): string {
    const repo = payload.repository?.full_name ?? '';
    const sender = payload.sender?.login ?? '';
    return `[GitHub] ${eventType}${action ? `.${action}` : ''} in ${repo} by ${sender}`;
  }

  private getThreadId(eventType: string, payload: any): string {
    const repo = payload.repository?.full_name ?? 'unknown';
    if (payload.pull_request) return `pr-${payload.pull_request.number}`;
    if (payload.issue) return `issue-${payload.issue.number}`;
    return `${repo}-${eventType}`;
  }
}

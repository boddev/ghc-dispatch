import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { Scheduler } from '../control-plane/scheduler.js';
import type { SessionPool } from '../execution/session-pool.js';
import type { AgentLoader } from '../execution/agent-loader.js';
import type { SessionRunner } from '../execution/session-runner.js';
import type { EventBus } from '../control-plane/event-bus.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { AutomationScheduler } from '../automation/automation-scheduler.js';
import type { ModelManager } from '../execution/model-manager.js';
import type { ProactiveCheckIn } from '../automation/proactive-checkin.js';
import type { GitHubEventHandler } from '../automation/github-events.js';
import type { BrowserEngine } from '../browser/browser-engine.js';
import type { HotReloader } from '../execution/hot-reloader.js';
import type { ArtifactCollector } from '../execution/artifact-collector.js';
import type { TeamRepo } from '../store/team-repo.js';
import type { TaskRuntimeConfigManager } from '../execution/task-runtime-config.js';
import type { ExecutionSettingsManager } from '../execution/execution-settings.js';
import type { CopilotSession, SessionOptions } from '../execution/copilot-adapter.js';
import type { Task } from '../control-plane/task-model.js';
import { agentHandle, parseAgentContent } from '../execution/agent-loader.js';
import { createFeatureCatalog } from './feature-catalog.js';
import { paths } from '../paths.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return fallback;
}

function shortDescription(description?: string): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No description';
  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? text;
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69)}...` : firstSentence;
}

function formatTeamsSummary(deps: ApiDeps): string {
  const teams = deps.teamRepo.listAll();
  if (teams.length === 0) return 'No teams configured.';

  const lines = ['Teams:'];
  for (const team of teams) {
    lines.push(`\n${team.name}`);
    if (team.description) lines.push(`  ${shortDescription(team.description)}`);
    lines.push(`  Lead: ${team.leadAgent} - ${shortDescription(deps.agentLoader.get(team.leadAgent)?.description)}`);
    if (team.memberAgents.length > 0) {
      lines.push('  Members:');
      for (const member of team.memberAgents) {
        lines.push(`    - ${member} - ${shortDescription(deps.agentLoader.get(member)?.description)}`);
      }
    }
  }
  return lines.join('\n');
}

function getTaskRuntimePayload(deps: ApiDeps) {
  const config = deps.taskRuntimeConfig.get();
  const skills = deps.skillManager.listAll().map(skill => ({
    id: skill.id,
    name: skill.name,
    enabled: skill.enabled,
    disabledForTasks: config.disabledSkills.some(name => name.toLowerCase() === skill.name.toLowerCase()),
  }));
  const mcpServers = Object.keys(config.mcpServers).map(name => ({
    name,
    disabledForTasks: config.disabledMcpServers.some(disabled => disabled.toLowerCase() === name.toLowerCase()),
  }));

  return {
    config,
    configPath: deps.taskRuntimeConfig.path,
    skills,
    mcpServers,
    integrations: {
      workiq: {
        enabled: (config.mcpServers.workiq !== undefined || config.enableConfigDiscovery) && !config.disabledMcpServers.some(name => name.toLowerCase() === 'workiq'),
        configured: config.mcpServers.workiq !== undefined,
        discoveryEnabled: config.enableConfigDiscovery,
      },
    },
  };
}

function configureWorkIqIntegration(deps: ApiDeps, enabled: boolean, server?: unknown) {
  const current = deps.taskRuntimeConfig.get();
  const mcpServers = { ...current.mcpServers };
  let disabledMcpServers = current.disabledMcpServers.filter(name => name.toLowerCase() !== 'workiq');
  if (enabled) {
    if (server !== undefined) mcpServers.workiq = server;
    if (mcpServers.workiq === undefined && !current.enableConfigDiscovery) {
      throw new Error('WorkIQ MCP server is not configured. Provide a server config or enable project config discovery.');
    }
  } else if (mcpServers.workiq !== undefined) {
    disabledMcpServers = [...disabledMcpServers, 'workiq'];
  }
  deps.taskRuntimeConfig.update({ mcpServers, disabledMcpServers });
  return getTaskRuntimePayload(deps);
}

export interface ApiDeps {
  taskManager: TaskManager;
  approvalManager: ApprovalManager;
  scheduler: Scheduler;
  sessionPool: SessionPool;
  agentLoader: AgentLoader;
  sessionRunner: SessionRunner;
  eventBus: EventBus;
  memoryManager: MemoryManager;
  skillManager: SkillManager;
  automationScheduler: AutomationScheduler;
  modelManager: ModelManager;
  checkIn: ProactiveCheckIn;
  githubEvents: GitHubEventHandler;
  browserEngine: BrowserEngine;
  hotReloader: HotReloader;
  artifactCollector: ArtifactCollector;
  teamRepo: TeamRepo;
  taskRuntimeConfig: TaskRuntimeConfigManager;
  executionSettings: ExecutionSettingsManager;
}

function isPreApproved(task: { metadata: Record<string, unknown> }): boolean {
  return task.metadata.preApproved === true || task.metadata.preApproved === 'true';
}

function previewTask(deps: ApiDeps, body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const requestedAgent = typeof body.agent === 'string' ? body.agent : '@general-purpose';
  const priority = typeof body.priority === 'string' ? body.priority : 'normal';
  const requestedModel = typeof body.model === 'string' ? body.model : undefined;
  const repo = typeof body.repo === 'string' && body.repo.trim() ? body.repo : undefined;
  const workingDirectory = typeof body.workingDirectory === 'string' && body.workingDirectory.trim()
    ? body.workingDirectory
    : undefined;

  const agentDefinition = deps.agentLoader.get(requestedAgent) ?? deps.agentLoader.getDefault();
  const resolvedAgent = agentHandle(agentDefinition.name);
  const resolvedModel = deps.modelManager.resolveModel(requestedModel, resolvedAgent, agentDefinition.model);

  const resolvedWorkingDirectory = workingDirectory
    ?? (repo ? `${paths.worktreesDir}/<task-id>` : null);

  return {
    title,
    description,
    requestedAgent,
    resolvedAgent,
    priority,
    requestedModel: requestedModel ?? null,
    resolvedModel,
    repo: repo ?? null,
    workingDirectory: resolvedWorkingDirectory,
    teamId: typeof body.teamId === 'string' && body.teamId.trim() ? body.teamId : null,
    preApproved: body.metadata && typeof body.metadata === 'object'
      ? (body.metadata as Record<string, unknown>).preApproved === true
      : false,
    notes: [
      `Agent ${requestedAgent} → ${resolvedAgent}`,
      requestedModel
        ? `Model override ${requestedModel} → ${resolvedModel}`
        : `Model resolved to ${resolvedModel}`,
      repo
        ? `Repository ${repo} will be checked out into a per-task worktree under ${paths.worktreesDir}/<task-id>`
        : 'No repository — task will run in the Dispatch data directory',
    ],
  };
}

function getExecutionApproval(deps: ApiDeps, taskId: string) {
  return deps.approvalManager.getByTask(taskId).find(a =>
    a.type === 'custom' && a.description.startsWith('Approve execution for task')
  );
}

function deleteDispatchTask(deps: ApiDeps, id: string, recursive = false) {
  const result = deps.taskManager.deleteTask(id, { recursive });
  for (const deletedTaskId of result.deletedTaskIds) {
    deps.scheduler.cancel(deletedTaskId);
    deps.artifactCollector.deleteArtifacts(deletedTaskId);
  }
  return {
    id,
    deleted: true,
    deletedTaskIds: result.deletedTaskIds,
    message: result.deletedTaskIds.length === 1
      ? `Deleted task ${id}`
      : `Deleted ${result.deletedTaskIds.length} tasks including subtasks of ${id}`,
  };
}

type ResolvedTeam = NonNullable<ReturnType<TeamRepo['getById']>>;

function requestPreApproved(input: Record<string, any>): boolean {
  const value = input.preApproved ?? input.metadata?.preApproved;
  return value === true || value === 'true';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanTeamTaskTitle(teamName: string, title: string): string {
  const teamPrefix = new RegExp(`^\\[${escapeRegExp(teamName)}\\]\\s*`, 'i');
  const agentPrefix = /^@[^\s:]+:\s*/;
  let cleaned = title.trim();
  let changed = true;
  while (changed) {
    const before = cleaned;
    cleaned = cleaned
      .replace(teamPrefix, '')
      .replace(/^Lead plan:\s*/i, '')
      .replace(agentPrefix, '')
      .trim();
    changed = cleaned !== before;
  }
  return cleaned.replace(/\s+/g, ' ') || title.trim();
}

function teamTaskTitle(teamName: string, title: string): string {
  return `[${teamName}] ${cleanTeamTaskTitle(teamName, title)}`;
}

function buildTeamLeadDescription(team: ResolvedTeam, title: string, description = ''): string {
  return [
    `You are the team lead for "${team.name}".`,
    team.metadata?.domain ? `Team domain: ${team.metadata.domain}` : '',
    team.metadata?.function ? `Team function: ${team.metadata.function}` : '',
    team.metadata?.operatingModel ? `Operating model: ${team.metadata.operatingModel}` : '',
    `Team goal: ${title}`,
    description,
    `Create the implementation plan, define responsibilities, and coordinate these member agents: ${team.memberAgents.join(', ')}.`,
    'Use the team domain and function to make domain-specific decisions instead of generic routing.',
    'Define deliverables, owners, sequencing, validation criteria, risks, and review checkpoints.',
    'Write clear handoff instructions that each member can execute after the plan is approved.',
  ].filter(Boolean).join('\n\n');
}

function buildTeamMemberDescription(team: ResolvedTeam, agent: string, parentTaskId: string, description = ''): string {
  return [
    `You are ${agent}, a member of the "${team.name}" agent team.`,
    team.metadata?.domain ? `Team domain: ${team.metadata.domain}` : '',
    team.metadata?.function ? `Team function: ${team.metadata.function}` : '',
    `Wait for and follow the lead plan from parent task ${parentTaskId}.`,
    description,
    'Implement your assigned part, communicate assumptions in task output, and produce artifacts or notes for the team lead.',
  ].filter(Boolean).join('\n\n');
}

function createTeamTaskGroup(deps: ApiDeps, teamId: string, input: Record<string, any>) {
  const team = deps.teamRepo.getById(teamId);
  if (!team) throw new Error('Team not found');
  const title = cleanTeamTaskTitle(team.name, String(input.title ?? ''));
  if (!title) throw new Error('"title" required');
  const description = typeof input.description === 'string' ? input.description : '';
  const preApproved = requestPreApproved(input);
  const model = typeof input.model === 'string' && input.model.trim() ? input.model : undefined;
  const rawMetadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const baseMetadata = {
    ...rawMetadata,
    teamId: team.id,
    teamName: team.name,
    preApproved,
  };

  const leadTask = deps.taskManager.createTask({
    title: teamTaskTitle(team.name, title),
    description: buildTeamLeadDescription(team, title, description),
    agent: team.leadAgent,
    repo: input.repo,
    workingDirectory: input.workingDirectory,
    priority: input.priority ?? 'high',
    model,
    maxRetries: input.maxRetries,
    createdBy: input.createdBy ?? 'team',
    metadata: {
      ...baseMetadata,
      teamRole: 'lead',
      memberAgents: team.memberAgents,
    },
  });

  const memberTasks = team.memberAgents.map(agent => deps.taskManager.createTask({
    title: teamTaskTitle(team.name, title),
    description: buildTeamMemberDescription(team, agent, leadTask.id, description),
    agent,
    repo: input.repo,
    workingDirectory: input.workingDirectory,
    parentTaskId: leadTask.id,
    dependsOn: [leadTask.id],
    priority: input.priority ?? 'normal',
    model,
    maxRetries: input.maxRetries,
    createdBy: input.createdBy ?? 'team',
    metadata: {
      ...baseMetadata,
      teamRole: 'member',
      teamLeadTaskId: leadTask.id,
    },
  }));

  return { team, leadTask, memberTasks };
}

function assignExistingTaskToTeam(deps: ApiDeps, taskId: string, teamId: string, input: Record<string, any>) {
  const current = deps.taskManager.getTask(taskId);
  if (!current) throw new Error(`Task not found: ${taskId}`);
  if (current.status === 'running') throw new Error('Cannot edit a running task');
  const team = deps.teamRepo.getById(teamId);
  if (!team) throw new Error('Team not found');
  const title = cleanTeamTaskTitle(team.name, String(input.title ?? current.title));
  const description = typeof input.description === 'string' ? input.description : current.description;
  const mergedMetadata = {
    ...current.metadata,
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
  };
  const preApproved = requestPreApproved({ ...input, metadata: mergedMetadata });
  const leadTask = deps.taskManager.updateTask(taskId, {
    title: teamTaskTitle(team.name, title),
    description: buildTeamLeadDescription(team, title, description),
    agent: team.leadAgent,
    priority: input.priority,
    model: input.model,
    repo: input.repo,
    workingDirectory: input.workingDirectory,
    dependsOn: input.dependsOn,
    maxRetries: input.maxRetries,
    metadata: {
      ...mergedMetadata,
      teamId: team.id,
      teamName: team.name,
      teamRole: 'lead',
      memberAgents: team.memberAgents,
      preApproved,
    },
  });

  const existingMembers = deps.taskManager.getSubtasks(leadTask.id)
    .filter(task => task.metadata.teamId === team.id && task.metadata.teamRole === 'member');
  const existingAgents = new Set(existingMembers.map(task => task.agent.toLowerCase()));
  const createdMembers = team.memberAgents
    .filter(agent => !existingAgents.has(agent.toLowerCase()))
    .map(agent => deps.taskManager.createTask({
      title: teamTaskTitle(team.name, title),
      description: buildTeamMemberDescription(team, agent, leadTask.id, description),
      agent,
      repo: leadTask.repo,
      workingDirectory: leadTask.workingDirectory,
      parentTaskId: leadTask.id,
      dependsOn: [leadTask.id],
      priority: input.priority ?? leadTask.priority,
      model: typeof input.model === 'string' ? input.model : undefined,
      maxRetries: leadTask.maxRetries,
      createdBy: input.createdBy ?? 'team',
      metadata: {
        teamId: team.id,
        teamName: team.name,
        teamRole: 'member',
        teamLeadTaskId: leadTask.id,
        preApproved,
      },
    }));

  return { ...leadTask, team, memberTasks: [...existingMembers, ...createdMembers] };
}

function ensureExecutionApproved(deps: ApiDeps, task: { id: string; title: string; metadata: Record<string, unknown> }) {
  if (isPreApproved(task)) return { approved: true as const };

  const existing = getExecutionApproval(deps, task.id);
  if (existing?.status === 'approved') return { approved: true as const };
  if (existing?.status === 'pending') return { approved: false as const, approval: existing };

  const approval = deps.approvalManager.create({
    taskId: task.id,
    type: 'custom',
    description: `Approve execution for task "${task.title}"`,
    evidence: [
      `Task ID: ${task.id}`,
      'Execution was requested without metadata.preApproved=true.',
    ],
  });
  return { approved: false as const, approval };
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const priority = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (priority !== 0) return priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function enqueuePendingTasksByPriority(deps: ApiDeps, options: { dryRun?: boolean } = {}) {
  const pending = sortTasksByPriority(deps.taskManager.listTasks('pending'));
  const queued: Task[] = [];
  const approvalRequired: Array<{ task: Task; approvalId: string }> = [];
  const blockedByDependencies: Array<{ task: Task; dependsOn: string[] }> = [];
  const failed: Array<{ task: Task; error: string }> = [];

  for (const task of pending) {
    if (!deps.taskManager.areDependenciesMet(task)) {
      blockedByDependencies.push({ task, dependsOn: task.dependsOn });
      continue;
    }

    if (options.dryRun) {
      if (!isPreApproved(task)) {
        const existingApproval = getExecutionApproval(deps, task.id);
        if (existingApproval?.status !== 'approved') {
          approvalRequired.push({ task, approvalId: existingApproval?.id ?? 'would-create' });
        }
      }
      continue;
    }

    const approval = ensureExecutionApproved(deps, task);
    if (!approval.approved) {
      approvalRequired.push({ task, approvalId: approval.approval.id });
      continue;
    }
    try {
      queued.push(deps.taskManager.enqueueTask(task.id));
    } catch (err) {
      failed.push({ task, error: errorMessage(err, 'Failed to enqueue task') });
    }
  }

  return {
    dryRun: options.dryRun === true,
    totalPending: pending.length,
    priorityOrder: pending.map(task => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      createdAt: task.createdAt,
    })),
    queued: queued.map(task => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
    })),
    approvalRequired: approvalRequired.map(({ task, approvalId }) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      approvalId,
    })),
    blockedByDependencies: blockedByDependencies.map(({ task, dependsOn }) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dependsOn,
    })),
    failed: failed.map(({ task, error }) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      error,
    })),
  };
}

function formatPendingEnqueueSummary(result: ReturnType<typeof enqueuePendingTasksByPriority>): string {
  const lines = [
    result.dryRun
      ? `Found ${result.totalPending} pending task(s) in priority order.`
      : `Processed ${result.totalPending} pending task(s) in priority order.`,
  ];

  if (result.queued.length > 0) {
    lines.push('', 'Queued for execution:');
    for (const task of result.queued) lines.push(`- [${task.priority}] ${task.title} (${task.id})`);
  }

  if (result.approvalRequired.length > 0) {
    lines.push('', 'Approval required before execution:');
    for (const task of result.approvalRequired) lines.push(`- [${task.priority}] ${task.title} (${task.id}) approval ${task.approvalId}`);
  }

  if (result.blockedByDependencies.length > 0) {
    lines.push('', 'Waiting on dependencies:');
    for (const task of result.blockedByDependencies) lines.push(`- [${task.priority}] ${task.title} (${task.id}) depends on ${task.dependsOn.join(', ')}`);
  }

  if (result.failed.length > 0) {
    lines.push('', 'Failed to enqueue:');
    for (const task of result.failed) lines.push(`- [${task.priority}] ${task.title} (${task.id}): ${task.error}`);
  }

  if (result.totalPending === 0) lines.push('No pending tasks were found.');
  return lines.join('\n');
}

function isStartPendingTasksMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (/^(why|how|what)\b/.test(normalized)) return false;
  return normalized === '/start-pending' ||
    normalized === '/start pending' ||
    normalized === '/enqueue-pending' ||
    normalized === '/enqueue pending' ||
    /\b(start|execute|enqueue|run)\b[\s\S]*\bpending tasks?\b/.test(normalized) ||
    /\bpending tasks?\b[\s\S]*\b(start|execute|enqueue|run)\b/.test(normalized);
}

function parseDeleteTaskMessage(message: string): { id: string; recursive: boolean } | undefined {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/?delete(?:-|\s+)?task\s+([0-9A-HJKMNP-TV-Z]{26})(?:\s+(--recursive|recursive|with\s+subtasks|and\s+subtasks))?$/i)
    ?? trimmed.match(/^\/?remove(?:-|\s+)?task\s+([0-9A-HJKMNP-TV-Z]{26})(?:\s+(--recursive|recursive|with\s+subtasks|and\s+subtasks))?$/i);
  if (!match) return undefined;
  return {
    id: match[1],
    recursive: Boolean(match[2]),
  };
}

function parseDeleteAllTasksMessage(message: string): { dryRun: boolean } | undefined {
  const normalized = message.trim().toLowerCase();
  if (/^(why|how|what)\b/.test(normalized)) return undefined;
  const matches = normalized === '/delete-all-tasks' ||
    normalized === '/delete all tasks' ||
    /\b(delete|remove)\b[\s\S]*\b(all|every)\b[\s\S]*\btasks?\b/.test(normalized) ||
    /\biterate\b[\s\S]*\btasks?\b[\s\S]*\b(delete|remove)\b/.test(normalized) ||
    /\btasks?\b[\s\S]*\b(delete|remove)\b[\s\S]*\b(one by one|all|every)\b/.test(normalized);
  return matches ? { dryRun: /\b(dry run|preview|show only|no changes|don't delete|do not delete|--dry-run)\b/.test(normalized) } : undefined;
}

function taskTreeDepth(task: Task, byId: Map<string, Task>): number {
  let depth = 0;
  let current = task;
  const seen = new Set<string>();
  while (current.parentTaskId && !seen.has(current.parentTaskId)) {
    seen.add(current.parentTaskId);
    const parent = byId.get(current.parentTaskId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

interface BulkDeleteTasksResult {
  total: number;
  deleted: Array<{ id: string; title: string }>;
  skippedRunning: Array<{ id: string; title: string }>;
  failed: Array<{ id: string; title: string; error: string }>;
  dryRun: boolean;
  message: string;
}

function deleteAllDispatchTasks(deps: ApiDeps, options: { dryRun?: boolean } = {}) {
  const tasks = deps.taskManager.listTasks(undefined, 10_000);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const ordered = [...tasks].sort((a, b) => taskTreeDepth(b, byId) - taskTreeDepth(a, byId));
  const deleted: Array<{ id: string; title: string }> = [];
  const skippedRunning: Array<{ id: string; title: string }> = [];
  const failed: Array<{ id: string; title: string; error: string }> = [];

  for (const task of ordered) {
    if (!deps.taskManager.getTask(task.id)) continue;
    if (task.status === 'running') {
      skippedRunning.push({ id: task.id, title: task.title });
      continue;
    }
    if (options.dryRun) {
      deleted.push({ id: task.id, title: task.title });
      continue;
    }
    try {
      const result = deleteDispatchTask(deps, task.id, false);
      for (const deletedTaskId of result.deletedTaskIds) {
        const deletedTask = byId.get(deletedTaskId);
        deleted.push({ id: deletedTaskId, title: deletedTask?.title ?? deletedTaskId });
      }
    } catch (err) {
      failed.push({ id: task.id, title: task.title, error: errorMessage(err, 'Failed to delete task') });
    }
  }

  const message = formatDeleteAllTasksSummary({ total: tasks.length, deleted, skippedRunning, failed, dryRun: options.dryRun === true });
  return { total: tasks.length, deleted, skippedRunning, failed, dryRun: options.dryRun === true, message };
}

function formatDeleteAllTasksSummary(result: Omit<BulkDeleteTasksResult, 'message'> & { dryRun?: boolean }): string {
  const lines = [
    result.dryRun ? `Previewed ${result.total} task(s) for deletion.` : `Processed ${result.total} task(s) for deletion.`,
    result.dryRun ? `${result.deleted.length} non-running task(s) would be deleted.` : `Deleted ${result.deleted.length} task(s).`,
  ];
  if (result.deleted.length > 0) {
    lines.push('', result.dryRun ? 'Would delete:' : 'Deleted tasks:');
    for (const task of result.deleted.slice(0, 50)) lines.push(`- ${task.title} (${task.id})`);
    if (result.deleted.length > 50) lines.push(`- ...and ${result.deleted.length - 50} more`);
  }
  if (result.skippedRunning.length > 0) {
    lines.push('', 'Skipped running tasks:');
    for (const task of result.skippedRunning) lines.push(`- ${task.title} (${task.id})`);
  }
  if (result.failed.length > 0) {
    lines.push('', 'Failed to delete:');
    for (const task of result.failed) lines.push(`- ${task.title} (${task.id}): ${task.error}`);
  }
  if (result.total === 0) lines.push('No tasks were found.');
  return lines.join('\n');
}

function buildAgentGenerationPrompt(description: string, teamType?: string, teamRole?: string): string {
  return [
    'You are generating a GitHub Copilot CLI Dispatch agent definition.',
    '',
    'Create exactly one `.agent.md` file as your entire response.',
    'Do not include commentary, explanations, code fences, or extra text.',
    '',
    'Required format:',
    '---',
    'name: Short Human Readable Name',
    'description: One sentence describing the agent specialty',
    'model: auto',
    'skills: []',
    'tools: []',
    'mcpServers: []',
    `domain: ${teamType || 'general'}`,
    `teamType: ${teamType || 'general'}`,
    `teamRoles: ["${teamRole || 'specialist'}"]`,
    'preferredTasks: []',
    'antiTasks: []',
    'handoffStyle: "Concise written handoff with assumptions, decisions, outputs, and next steps."',
    'leadershipStyle: "Plan clearly, delegate explicitly, verify outputs, and escalate blockers."',
    'allowedPeers: []',
    '---',
    'System prompt text here.',
    '',
    'System prompt requirements:',
    '- Clearly define the role, responsibilities, and operating style.',
    '- Include how the agent should communicate with team leads and peer agents.',
    '- Include planning, implementation, validation, and handoff expectations appropriate to the role.',
    '- Include domain-specific expertise implied by the user description.',
    '- Include best-fit tasks and anti-tasks.',
    '- Include expected output formats and artifact expectations.',
    '- Include a validation checklist.',
    '- Include escalation and approval guidance.',
    '- If the role is a team lead or orchestrator, include routing rules, delegation rules, and review responsibilities.',
    '- Keep it practical for use as a reusable Dispatch agent.',
    '',
    `Team/domain specialization: ${teamType || 'general'}`,
    `Intended team role: ${teamRole || 'specialist'}`,
    '',
    'User description of the desired agent:',
    description,
  ].join('\n');
}

function extractGeneratedAgentMarkdown(output: string): string {
  const fenced = output.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? output).trim();
  const frontmatter = candidate.match(/---\s*\n[\s\S]*?\n---\s*\n[\s\S]*/);
  if (!frontmatter) throw new Error('Copilot did not return a valid agent markdown file with YAML frontmatter');
  const markdown = frontmatter[0].trim();
  parseAgentContent(markdown);
  return `${markdown}\n`;
}

function buildFallbackAgentMarkdown(description: string, teamType?: string, teamRole?: string): string {
  const role = teamRole || 'specialist';
  const domain = teamType || 'general';
  const readableRole = role
    .replace(/^@/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  const readableDomain = domain
    .replace(/^@/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  const suffix = randomUUID().slice(0, 8);
  const name = `${readableDomain} ${readableRole} ${suffix}`;
  const summary = `${readableRole} for ${readableDomain} work.`;

  return [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(summary)}`,
    'model: auto',
    'skills: []',
    'tools: []',
    'mcpServers: []',
    `domain: ${JSON.stringify(domain)}`,
    `teamType: ${JSON.stringify(domain)}`,
    `teamRoles: ${JSON.stringify([role])}`,
    `preferredTasks: ${JSON.stringify(['Planning', 'Execution', 'Validation', 'Handoff'])}`,
    `antiTasks: ${JSON.stringify(['Unapproved destructive changes', 'Work outside the team domain without escalation'])}`,
    `handoffStyle: ${JSON.stringify('Concise written handoff with assumptions, decisions, outputs, validation, and next steps.')}`,
    `leadershipStyle: ${JSON.stringify(role === 'team-lead' ? 'Plan clearly, delegate explicitly, verify outputs, and escalate blockers.' : 'Collaborate with the team lead, execute assigned work, and surface blockers early.')}`,
    'allowedPeers: []',
    '---',
    `You are the ${readableRole} for ${readableDomain}.`,
    '',
    '## Role',
    description,
    '',
    '## Responsibilities',
    '- Understand the team domain and apply that context to every recommendation.',
    '- Produce concrete, reusable outputs rather than generic commentary.',
    '- Coordinate with the team lead and peer agents through explicit assumptions, decisions, blockers, and handoffs.',
    '- Ask for clarification only when missing information would materially change the outcome.',
    '',
    '## Best-Fit Tasks',
    '- Domain-specific planning and implementation support.',
    '- Reviewing work for correctness, completeness, and fit to team goals.',
    '- Producing artifacts, notes, and handoffs that another agent or user can act on.',
    '',
    '## Anti-Tasks',
    '- Do not perform destructive or sensitive actions without explicit approval.',
    '- Do not claim completion without identifying outputs and validation performed.',
    '- Do not work outside the team function without flagging the mismatch.',
    '',
    '## Output Format',
    '- Summary of decisions and assumptions.',
    '- Work performed or proposed.',
    '- Artifacts created or expected.',
    '- Validation notes.',
    '- Blockers and next steps.',
    '',
    '## Validation Checklist',
    '- The output matches the team domain and function.',
    '- Assigned responsibilities are clear.',
    '- Risks and dependencies are called out.',
    '- Handoff instructions are actionable.',
    '',
    '## Escalation',
    'Escalate uncertainty, blocked dependencies, policy concerns, or cross-team ownership issues to the team lead before proceeding.',
    '',
  ].join('\n');
}

async function generateAgentMarkdownResilient(deps: ApiDeps, description: string, model?: string, teamType?: string, teamRole?: string, timeoutMs = 300_000): Promise<{ content: string; generatedBy: 'copilot' | 'fallback'; error?: string }> {
  try {
    return {
      content: await generateAgentWithCopilot(deps, description, model, teamType, teamRole, timeoutMs),
      generatedBy: 'copilot',
    };
  } catch (err: any) {
    return {
      content: buildFallbackAgentMarkdown(description, teamType, teamRole),
      generatedBy: 'fallback',
      error: err.message ?? String(err),
    };
  }
}

function findMarkdownDocuments(root: string, limit = 100): string[] {
  if (!root || !existsSync(root)) return [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage']);
  const results: string[] = [];

  const visit = (dir: string) => {
    if (results.length >= limit) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(path);
        continue;
      }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      try {
        if (statSync(path).size <= 2_000_000) results.push(path);
      } catch {
        // File may have been removed while scanning.
      }
    }
  };

  try {
    visit(root);
  } catch {
    return results;
  }

  return results;
}

async function generateAgentWithCopilot(deps: ApiDeps, description: string, model?: string, teamType?: string, teamRole?: string, timeoutMs = 300_000): Promise<string> {
  const chunks: string[] = [];
  let resolveIdle!: () => void;
  let rejectIdle!: (err: Error) => void;
  const idle = new Promise<void>((resolve, reject) => {
    resolveIdle = resolve;
    rejectIdle = reject;
  });

  const session = await deps.sessionPool.acquire(`agent-generator-${Date.now()}`, {
    model: model || deps.modelManager.getDefault(),
    onPermissionRequest: async () => false,
    onEvent: (event) => {
      if (event.type === 'assistant.message' && event.data.content) chunks.push(event.data.content);
      if (event.type === 'session.idle') resolveIdle();
      if (event.type === 'error') rejectIdle(new Error(event.data.error ?? 'Copilot session error'));
    },
  });

  try {
    await session.send(buildAgentGenerationPrompt(description, teamType, teamRole));
    await Promise.race([
      idle,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Copilot to generate agent')), timeoutMs)),
    ]);
    return extractGeneratedAgentMarkdown(chunks.join('\n'));
  } finally {
    await deps.sessionPool.release(session.id);
  }
}

type DispatchChatToolResult = {
  action: string;
  result: unknown;
};

type DispatchChatTurn = {
  chunks: string[];
  results: DispatchChatToolResult[];
  resolveIdle: () => void;
  rejectIdle: (err: Error) => void;
};

type DispatchChatSessionState = {
  key: string;
  threadId: string;
  session: CopilotSession;
  model: string;
  createdAt: Date;
  lastUsedAt: Date;
  activeTurn?: DispatchChatTurn;
};

function buildDispatchChatSystemPrompt(deps: ApiDeps): string {
  const catalog = createFeatureCatalog(deps);
  const agents = deps.agentLoader.list().map(agent => agentHandle(agent.name));
  const teams = deps.teamRepo.listAll().map(team => ({ id: team.id, name: team.name, leadAgent: team.leadAgent, memberAgents: team.memberAgents }));

  return [
    'You are Dispatch Chat, a full GitHub Copilot CLI-style assistant grounded in the local Dispatch daemon.',
    'You have persistent session memory across messages in this chat thread.',
    'Use normal CLI reasoning and available tools to inspect files, run commands, and solve multi-step problems.',
    'Use Dispatch tools when the user asks about Dispatch tasks, agents, teams, skills, models, approvals, settings, or feature configuration.',
    'Do not return hidden chain-of-thought. Instead, give concise progress summaries, decisions, tool outcomes, and next actions.',
    'For destructive operations, be explicit about what you are doing and prefer a dry run when the user asks to preview.',
    'When a tool returns IDs, include the relevant IDs in your response.',
    '',
    'Core Dispatch tool families available:',
    '- dispatch_get_stats, dispatch_list_features, dispatch_list_models',
    '- dispatch_list_agents, dispatch_generate_agent, dispatch_reload',
    '- dispatch_list_teams, dispatch_create_team, dispatch_create_team_with_generated_agents, dispatch_run_team, dispatch_delete_team',
    '- dispatch_list_skills, dispatch_create_skill, dispatch_install_skill_from_github, dispatch_install_skill_from_skills_sh, dispatch_install_skill_from_registry',
    '- dispatch_list_tasks, dispatch_get_task, dispatch_get_task_details, dispatch_create_task, dispatch_update_task, dispatch_enqueue_task, dispatch_enqueue_pending_tasks, dispatch_cancel_task, dispatch_retry_task, dispatch_delete_task, dispatch_delete_all_tasks, dispatch_recover_task',
    '- dispatch_list_approvals, dispatch_approve_approval, dispatch_reject_approval',
    '- dispatch_get_execution_settings, dispatch_configure_execution_settings, dispatch_get_task_runtime_config, dispatch_configure_task_runtime, dispatch_configure_workiq, dispatch_switch_model',
    '',
    'Current Dispatch state:',
    `Features: ${catalog.features.map(feature => `${feature.title} (${feature.id})`).join(', ')}`,
    `Agents: ${agents.join(', ') || 'none'}`,
    `Teams: ${JSON.stringify(teams)}`,
    `Default model: ${deps.modelManager.getDefault()}`,
    `Dispatch Chat model: ${deps.modelManager.getChatModel()}`,
  ].join('\n');
}

function buildDispatchChatRuntimeOptions(deps: ApiDeps) {
  const runtimeConfig = deps.taskRuntimeConfig.get();
  const disabledMcpServers = new Set(runtimeConfig.disabledMcpServers.map(name => name.toLowerCase()));
  const mcpServers = Object.fromEntries(
    Object.entries(runtimeConfig.mcpServers).filter(([name]) => !disabledMcpServers.has(name.toLowerCase())),
  );
  const skillDirectories = runtimeConfig.useEnabledSkills
    ? deps.skillManager.getSkillDirs()
    : undefined;

  return {
    enableConfigDiscovery: runtimeConfig.enableConfigDiscovery,
    mcpServers,
    skillDirectories,
    disabledSkills: runtimeConfig.disabledSkills.length > 0 ? runtimeConfig.disabledSkills : undefined,
    availableTools: runtimeConfig.availableTools.length > 0 ? runtimeConfig.availableTools : undefined,
    excludedTools: runtimeConfig.excludedTools.length > 0 ? runtimeConfig.excludedTools : undefined,
    infiniteSessions: runtimeConfig.infiniteSessions,
    customAgents: [{
      name: 'dispatch-chat',
      displayName: 'Dispatch Chat',
      description: 'Persistent Copilot CLI session with Dispatch daemon tools.',
      tools: null,
      prompt: buildDispatchChatSystemPrompt(deps),
      mcpServers,
    }],
    agent: 'dispatch-chat',
  } satisfies Partial<SessionOptions>;
}

async function executeDispatchChatAction(deps: ApiDeps, action: { action: string; args?: Record<string, unknown> }) {
  const args = action.args ?? {};
  const requireString = (name: string) => {
    const value = args[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${action.action}.${name} is required`);
    return value.trim();
  };
  const optionalString = (name: string) => typeof args[name] === 'string' ? String(args[name]) : undefined;
  const optionalBoolean = (name: string) => typeof args[name] === 'boolean' ? Boolean(args[name]) : undefined;
  const optionalNumber = (name: string) => typeof args[name] === 'number' ? Number(args[name]) : undefined;
  const optionalStringArray = (name: string) => Array.isArray(args[name]) ? (args[name] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  const optionalObject = (name: string): Record<string, unknown> | undefined =>
    args[name] && typeof args[name] === 'object' && !Array.isArray(args[name])
      ? args[name] as Record<string, unknown>
      : undefined;
  const optionalObjectArray = (name: string): Array<Record<string, unknown>> => Array.isArray(args[name])
    ? (args[name] as unknown[]).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
    : [];

  switch (action.action) {
    case 'get_stats':
      return {
        tasks: deps.taskManager.getStats(),
        queue: deps.scheduler.queueLength,
        running: deps.scheduler.runningCount,
        pendingApprovals: deps.approvalManager.getPending().length,
      };
    case 'list_features':
      return createFeatureCatalog(deps).features.map(feature => ({ id: feature.id, title: feature.title, status: feature.status }));
    case 'list_agents':
      return deps.agentLoader.list().map(agent => ({
        name: agentHandle(agent.name),
        description: agent.description,
        model: agent.model,
        domain: agent.domain,
        teamRoles: agent.teamRoles,
      }));
    case 'list_teams':
      return deps.teamRepo.listAll().map(team => ({
        id: team.id,
        name: team.name,
        description: shortDescription(team.description),
        leadAgent: {
          name: team.leadAgent,
          description: shortDescription(deps.agentLoader.get(team.leadAgent)?.description),
        },
        memberAgents: team.memberAgents.map(agent => ({
          name: agent,
          description: shortDescription(deps.agentLoader.get(agent)?.description),
        })),
      }));
    case 'list_skills':
      return deps.skillManager.listAll();
    case 'list_tasks':
      return deps.taskManager.listTasks(optionalString('status') as any, optionalNumber('limit') ?? 50);
    case 'get_task': {
      const task = deps.taskManager.getTask(requireString('id'));
      if (!task) throw new Error('Task not found');
      return task;
    }
    case 'get_task_details': {
      const task = deps.taskManager.getTask(requireString('id'));
      if (!task) throw new Error('Task not found');
      return {
        task,
        events: deps.taskManager.getTaskEvents(task.id),
        subtasks: deps.taskManager.getSubtasks(task.id),
        approvals: deps.approvalManager.getByTask(task.id),
        latestCheckpoint: deps.taskManager.getLatestCheckpoint(task.id) ?? null,
        artifacts: deps.artifactCollector.getArtifacts(task.id).split(/\r?\n/).map(p => p.trim()).filter(Boolean),
      };
    }
    case 'enqueue_task':
      return deps.taskManager.enqueueTask(requireString('id'));
    case 'cancel_task':
      return deps.taskManager.cancelTask(requireString('id'), optionalString('reason') ?? 'Cancelled via Dispatch Chat');
    case 'retry_task':
      return deps.taskManager.retryTask(requireString('id'));
    case 'recover_task':
      return deps.taskManager.resumeRecoveredTask(requireString('id'), (optionalString('action') ?? 'resume') as 'resume' | 'restart');
    case 'update_task': {
      const task = optionalString('teamId')
        ? assignExistingTaskToTeam(deps, requireString('id'), optionalString('teamId')!, args)
        : deps.taskManager.updateTask(requireString('id'), {
            title: optionalString('title'),
            description: optionalString('description'),
            agent: optionalString('agent'),
            priority: optionalString('priority') as any,
            model: optionalString('model'),
            repo: optionalString('repo'),
            workingDirectory: optionalString('workingDirectory'),
            maxRetries: optionalNumber('maxRetries'),
            metadata: args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
              ? args.metadata as Record<string, unknown>
              : undefined,
          });
      if (task.status === 'queued') deps.scheduler.enqueue(task);
      return task;
    }
    case 'delete_task':
      return deleteDispatchTask(deps, requireString('id'), optionalBoolean('recursive') === true);
    case 'delete_all_tasks':
      return deleteAllDispatchTasks(deps, { dryRun: optionalBoolean('dryRun') === true });
    case 'enqueue_pending_tasks': {
      const result = enqueuePendingTasksByPriority(deps, { dryRun: optionalBoolean('dryRun') === true });
      return { ...result, message: formatPendingEnqueueSummary(result) };
    }
    case 'create_task':
      if (optionalString('teamId')) {
        const created = createTeamTaskGroup(deps, optionalString('teamId')!, { ...args, createdBy: 'dispatch-chat' });
        return { ...created.leadTask, team: created.team, memberTasks: created.memberTasks };
      }
      return deps.taskManager.createTask({
        title: requireString('title'),
        description: optionalString('description'),
        agent: optionalString('agent'),
        priority: optionalString('priority') as any,
        model: optionalString('model'),
        repo: optionalString('repo'),
        workingDirectory: optionalString('workingDirectory'),
        createdBy: 'dispatch-chat',
        metadata: { preApproved: optionalBoolean('preApproved') === true },
      });
    case 'generate_agent': {
      const generated = await generateAgentMarkdownResilient(
        deps,
        requireString('description'),
        optionalString('model'),
        optionalString('teamType'),
        optionalString('teamRole'),
      );
      const agent = deps.agentLoader.createFromContent(generated.content);
      return {
        name: agentHandle(agent.name),
        description: agent.description,
        model: agent.model,
        filePath: agent.filePath,
        generatedBy: generated.generatedBy,
        generationError: generated.error,
      };
    }
    case 'create_team_with_generated_agents': {
      const name = requireString('name');
      const domain = optionalString('domain') ?? name;
      const teamFunction = optionalString('function') ?? optionalString('description') ?? '';
      const operatingModel = optionalString('operatingModel') ?? '';
      const leadDescription = requireString('leadDescription');
      const memberSpecs = optionalObjectArray('memberAgents');
      if (memberSpecs.length === 0) throw new Error('create_team_with_generated_agents.memberAgents must include at least one member spec');

      const leadGenerated = await generateAgentMarkdownResilient(
        deps,
        [
          `Create a team-specific orchestrator / team lead for "${name}".`,
          `Domain: ${domain}`,
          `Function: ${teamFunction}`,
          `Operating model: ${operatingModel}`,
          leadDescription,
        ].filter(Boolean).join('\n'),
        undefined,
        domain,
        'team-lead',
        75_000,
      );
      const lead = deps.agentLoader.createFromContent(leadGenerated.content);
      const leadName = agentHandle(lead.name);

      const members = [];
      const generation = [{ role: 'team-lead', agent: leadName, generatedBy: leadGenerated.generatedBy, error: leadGenerated.error }];
      for (const spec of memberSpecs) {
        const role = typeof spec.role === 'string' ? spec.role : 'team-member';
        const description = typeof spec.description === 'string' ? spec.description : role;
        const generated = await generateAgentMarkdownResilient(
          deps,
          [
            `Create a "${role}" specialist for the "${name}" team.`,
            `Domain: ${domain}`,
            `Function: ${teamFunction}`,
            description,
          ].filter(Boolean).join('\n'),
          undefined,
          domain,
          role,
          60_000,
        );
        const agent = deps.agentLoader.createFromContent(generated.content);
        const agentName = agentHandle(agent.name);
        members.push(agentName);
        generation.push({ role, agent: agentName, generatedBy: generated.generatedBy, error: generated.error });
      }

      const team = deps.teamRepo.create({
        name,
        description: optionalString('description') ?? '',
        leadAgent: leadName,
        memberAgents: members,
        metadata: {
          domain,
          function: teamFunction,
          operatingModel,
          createdBy: 'dispatch-chat',
        },
      });

      return { team, leadAgent: leadName, memberAgents: members, generation };
    }
    case 'create_team': {
      const leadAgent = requireString('leadAgent');
      const memberAgents = optionalStringArray('memberAgents');
      const missing = [leadAgent, ...memberAgents].filter(agent => !deps.agentLoader.has(agent));
      if (missing.length > 0) throw new Error(`Unknown agent(s): ${missing.join(', ')}`);
      return deps.teamRepo.create({
        name: requireString('name'),
        description: optionalString('description'),
        leadAgent,
        memberAgents,
        metadata: {
          domain: optionalString('domain') ?? '',
          function: optionalString('function') ?? optionalString('description') ?? '',
          operatingModel: optionalString('operatingModel') ?? '',
        },
      });
    }
    case 'delete_team': {
      const id = requireString('id');
      const removed = deps.teamRepo.remove(id);
      if (!removed) throw new Error('Team not found');
      return { id, removed: true };
    }
    case 'run_team': {
      return createTeamTaskGroup(deps, requireString('teamId'), { ...args, createdBy: 'dispatch-chat' });
    }
    case 'install_skill_from_github':
      return await deps.skillManager.installFromGitHub(requireString('repoUrl'), optionalString('name'));
    case 'install_skill_from_skills_sh':
      return await deps.skillManager.installFromSkillsSh(requireString('source'));
    case 'install_skill_from_registry':
      return await deps.skillManager.installFromSkillsSh(optionalString('source') ?? requireString('name'));
    case 'create_skill':
      return deps.skillManager.createSkill(requireString('name'), optionalString('description') ?? '', requireString('instructions'));
    case 'list_approvals':
      return deps.approvalManager.getPending();
    case 'approve_approval': {
      const approval = deps.approvalManager.approve(requireString('id'), optionalString('decidedBy') ?? 'dispatch-chat');
      if (!approval) throw new Error('Approval not found or already decided');
      return approval;
    }
    case 'reject_approval': {
      const approval = deps.approvalManager.reject(requireString('id'), optionalString('decidedBy') ?? 'dispatch-chat');
      if (!approval) throw new Error('Approval not found or already decided');
      return approval;
    }
    case 'list_models':
      return {
        current: deps.modelManager.getDefault(),
        chatModel: deps.modelManager.getChatModel(),
        chatModelOverride: deps.modelManager.getChatModelOverride(),
        agentOverrides: deps.modelManager.getAgentOverrides(),
        available: deps.modelManager.listModels(),
      };
    case 'switch_model': {
      const model = requireString('model');
      const found = deps.modelManager.findModel(model);
      if (!found) throw new Error(`Unknown model: ${model}`);
      const agent = optionalString('agent');
      if (agent) deps.modelManager.setAgentModel(agent, found.id);
      else deps.modelManager.setDefault(found.id);
      return { model: found.id, agent };
    }
    case 'get_execution_settings':
      return {
        settings: deps.executionSettings.get(),
        sessions: {
          active: deps.sessionPool.size,
          available: deps.sessionPool.available,
          limit: deps.sessionPool.limit,
        },
      };
    case 'configure_execution_settings': {
      const next = deps.executionSettings.update({
        maxConcurrentSessions: optionalNumber('maxConcurrentSessions'),
        taskSessionIdleTimeoutMs: optionalNumber('taskSessionIdleTimeoutMs'),
      });
      if (optionalNumber('maxConcurrentSessions') !== undefined) {
        deps.sessionPool.setMaxConcurrent(next.maxConcurrentSessions);
        deps.scheduler.setConcurrency(next.maxConcurrentSessions);
      }
      return { settings: next };
    }
    case 'get_task_runtime_config':
      return getTaskRuntimePayload(deps);
    case 'configure_task_runtime':
      deps.taskRuntimeConfig.update(optionalObject('patch') ?? args);
      return getTaskRuntimePayload(deps);
    case 'configure_workiq':
      return configureWorkIqIntegration(deps, optionalBoolean('enabled') !== false, args.server);
    case 'reload':
      deps.agentLoader.reload();
      deps.hotReloader.reloadAll();
      return { reloaded: true };
    default:
      throw new Error(`Unsupported Dispatch Chat action: ${action.action}`);
  }
}

type DispatchChatToolSpec = {
  name: string;
  action: string;
  description: string;
  parameters: Record<string, unknown>;
};

const stringSchema = { type: 'string' };
const booleanSchema = { type: 'boolean' };
const numberSchema = { type: 'number' };
const objectSchema = { type: 'object', additionalProperties: true };

const DISPATCH_CHAT_TOOL_SPECS: DispatchChatToolSpec[] = [
  { name: 'dispatch_get_stats', action: 'get_stats', description: 'Get Dispatch task, queue, session, and approval statistics.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_list_features', action: 'list_features', description: 'List Dispatch feature catalog entries.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_list_models', action: 'list_models', description: 'List available models and current Dispatch model overrides.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_list_agents', action: 'list_agents', description: 'List available Dispatch agents and their capabilities.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_list_teams', action: 'list_teams', description: 'List configured Dispatch teams and their lead/member agents.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_list_skills', action: 'list_skills', description: 'List installed Dispatch skills.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'dispatch_list_tasks',
    action: 'list_tasks',
    description: 'List Dispatch tasks, optionally filtered by status.',
    parameters: { type: 'object', properties: { status: stringSchema, limit: numberSchema }, additionalProperties: false },
  },
  {
    name: 'dispatch_get_task',
    action: 'get_task',
    description: 'Get one Dispatch task by ID.',
    parameters: { type: 'object', properties: { id: stringSchema }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'dispatch_get_task_details',
    action: 'get_task_details',
    description: 'Get task details including events, subtasks, approvals, checkpoint, and artifact paths.',
    parameters: { type: 'object', properties: { id: stringSchema }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'dispatch_create_task',
    action: 'create_task',
    description: 'Create a Dispatch task for an agent or team.',
    parameters: {
      type: 'object',
      properties: {
        title: stringSchema,
        description: stringSchema,
        agent: stringSchema,
        teamId: stringSchema,
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        model: stringSchema,
        repo: stringSchema,
        workingDirectory: stringSchema,
        preApproved: booleanSchema,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'dispatch_update_task',
    action: 'update_task',
    description: 'Edit a non-running Dispatch task, including agent/team assignment and runtime fields.',
    parameters: {
      type: 'object',
      properties: {
        id: stringSchema,
        title: stringSchema,
        description: stringSchema,
        agent: stringSchema,
        teamId: stringSchema,
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        model: stringSchema,
        repo: stringSchema,
        workingDirectory: stringSchema,
        maxRetries: numberSchema,
        metadata: objectSchema,
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  { name: 'dispatch_enqueue_task', action: 'enqueue_task', description: 'Queue one pending Dispatch task by ID.', parameters: { type: 'object', properties: { id: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_enqueue_pending_tasks', action: 'enqueue_pending_tasks', description: 'Queue all eligible pending tasks by priority, optionally as a dry run.', parameters: { type: 'object', properties: { dryRun: booleanSchema }, additionalProperties: false } },
  { name: 'dispatch_cancel_task', action: 'cancel_task', description: 'Cancel a pending, queued, running, or paused task.', parameters: { type: 'object', properties: { id: stringSchema, reason: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_retry_task', action: 'retry_task', description: 'Retry a failed, cancelled, or paused task.', parameters: { type: 'object', properties: { id: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_recover_task', action: 'recover_task', description: 'Resume or restart a paused recovered task.', parameters: { type: 'object', properties: { id: stringSchema, action: { type: 'string', enum: ['resume', 'restart'] } }, required: ['id', 'action'], additionalProperties: false } },
  { name: 'dispatch_delete_task', action: 'delete_task', description: 'Delete one non-running Dispatch task; set recursive for task trees.', parameters: { type: 'object', properties: { id: stringSchema, recursive: booleanSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_delete_all_tasks', action: 'delete_all_tasks', description: 'Delete all non-running tasks, or preview with dryRun.', parameters: { type: 'object', properties: { dryRun: booleanSchema }, additionalProperties: false } },
  { name: 'dispatch_generate_agent', action: 'generate_agent', description: 'Generate and install a new Dispatch agent from a role description.', parameters: { type: 'object', properties: { description: stringSchema, model: stringSchema, teamType: stringSchema, teamRole: stringSchema }, required: ['description'], additionalProperties: false } },
  {
    name: 'dispatch_create_team_with_generated_agents',
    action: 'create_team_with_generated_agents',
    description: 'Generate a team lead and member agents, then create a Dispatch team.',
    parameters: {
      type: 'object',
      properties: {
        name: stringSchema,
        description: stringSchema,
        domain: stringSchema,
        function: stringSchema,
        operatingModel: stringSchema,
        leadDescription: stringSchema,
        memberAgents: {
          type: 'array',
          items: { type: 'object', properties: { role: stringSchema, description: stringSchema }, required: ['role', 'description'], additionalProperties: false },
        },
      },
      required: ['name', 'leadDescription', 'memberAgents'],
      additionalProperties: false,
    },
  },
  {
    name: 'dispatch_create_team',
    action: 'create_team',
    description: 'Create a Dispatch team from existing agents.',
    parameters: {
      type: 'object',
      properties: {
        name: stringSchema,
        description: stringSchema,
        leadAgent: stringSchema,
        memberAgents: { type: 'array', items: stringSchema },
        domain: stringSchema,
        function: stringSchema,
        operatingModel: stringSchema,
      },
      required: ['name', 'leadAgent', 'memberAgents'],
      additionalProperties: false,
    },
  },
  { name: 'dispatch_delete_team', action: 'delete_team', description: 'Delete a Dispatch team by ID.', parameters: { type: 'object', properties: { id: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_run_team', action: 'run_team', description: 'Create a team task group for a Dispatch team.', parameters: { type: 'object', properties: { teamId: stringSchema, title: stringSchema, description: stringSchema, repo: stringSchema, preApproved: booleanSchema }, required: ['teamId', 'title'], additionalProperties: false } },
  { name: 'dispatch_install_skill_from_github', action: 'install_skill_from_github', description: 'Install a Dispatch skill from a GitHub repository URL.', parameters: { type: 'object', properties: { repoUrl: stringSchema, name: stringSchema }, required: ['repoUrl'], additionalProperties: false } },
  { name: 'dispatch_install_skill_from_skills_sh', action: 'install_skill_from_skills_sh', description: 'Install a Dispatch skill from a skills.sh source.', parameters: { type: 'object', properties: { source: stringSchema }, required: ['source'], additionalProperties: false } },
  { name: 'dispatch_install_skill_from_registry', action: 'install_skill_from_registry', description: 'Install a Dispatch skill by registry name.', parameters: { type: 'object', properties: { name: stringSchema }, required: ['name'], additionalProperties: false } },
  { name: 'dispatch_create_skill', action: 'create_skill', description: 'Create a local Dispatch skill.', parameters: { type: 'object', properties: { name: stringSchema, description: stringSchema, instructions: stringSchema }, required: ['name', 'instructions'], additionalProperties: false } },
  { name: 'dispatch_list_approvals', action: 'list_approvals', description: 'List pending Dispatch approvals.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_approve_approval', action: 'approve_approval', description: 'Approve a pending Dispatch approval.', parameters: { type: 'object', properties: { id: stringSchema, decidedBy: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_reject_approval', action: 'reject_approval', description: 'Reject a pending Dispatch approval.', parameters: { type: 'object', properties: { id: stringSchema, decidedBy: stringSchema }, required: ['id'], additionalProperties: false } },
  { name: 'dispatch_get_execution_settings', action: 'get_execution_settings', description: 'Get Dispatch execution settings and current session pool capacity.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_configure_execution_settings', action: 'configure_execution_settings', description: 'Update execution settings such as max concurrent sessions or task idle timeout.', parameters: { type: 'object', properties: { maxConcurrentSessions: numberSchema, taskSessionIdleTimeoutMs: numberSchema }, additionalProperties: false } },
  { name: 'dispatch_get_task_runtime_config', action: 'get_task_runtime_config', description: 'Get Copilot task runtime configuration, skills, MCP servers, and integrations.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dispatch_configure_task_runtime', action: 'configure_task_runtime', description: 'Patch Copilot task runtime configuration.', parameters: { type: 'object', properties: { patch: objectSchema }, additionalProperties: true } },
  { name: 'dispatch_configure_workiq', action: 'configure_workiq', description: 'Enable or disable WorkIQ integration and optionally provide an MCP server config.', parameters: { type: 'object', properties: { enabled: booleanSchema, server: objectSchema }, additionalProperties: false } },
  { name: 'dispatch_switch_model', action: 'switch_model', description: 'Switch the default Dispatch model or an agent-specific model override.', parameters: { type: 'object', properties: { model: stringSchema, agent: stringSchema }, required: ['model'], additionalProperties: false } },
  { name: 'dispatch_reload', action: 'reload', description: 'Reload Dispatch agents and skills from disk.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

function buildDispatchChatTools(deps: ApiDeps, recordResult: (result: DispatchChatToolResult) => void): NonNullable<SessionOptions['tools']> {
  const tools = DISPATCH_CHAT_TOOL_SPECS.map(spec => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    skipPermission: true,
    handler: async (rawArgs: unknown) => {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? rawArgs as Record<string, unknown>
        : {};
      const result = await executeDispatchChatAction(deps, { action: spec.action, args });
      recordResult({ action: spec.action, result });
      const json = JSON.stringify(result, null, 2);
      return json.length > 30_000
        ? `${json.slice(0, 30_000)}\n...truncated ${json.length - 30_000} character(s). Ask for a narrower query if you need the full result.`
        : json;
    },
  }));

  tools.push({
    name: 'dispatch_list_api_capabilities',
    description: 'List the Dispatch API capabilities exposed as chat tools.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    skipPermission: true,
    handler: async () => JSON.stringify(DISPATCH_CHAT_TOOL_SPECS.map(spec => ({
      tool: spec.name,
      action: spec.action,
      description: spec.description,
      parameters: spec.parameters,
    })), null, 2),
  });

  return tools;
}

function formatChatActionResult(action: string, result: unknown): string {
  if (result && typeof result === 'object' && 'message' in result && typeof (result as { message?: unknown }).message === 'string') {
    return `- ${action}: ${(result as { message: string }).message.replace(/\n/g, '\n  ')}`;
  }

  if (result && typeof result === 'object' && 'id' in result) {
    const entity = result as { id?: unknown; title?: unknown; name?: unknown; status?: unknown };
    const label = String(entity.title ?? entity.name ?? entity.id);
    return `- ${action}: ${label} (${String(entity.id)})${entity.status ? ` is ${String(entity.status)}` : ''}`;
  }

  if (Array.isArray(result)) {
    const lines = [`- ${action}: returned ${result.length} item(s)`];
    if (action === 'list_tasks' && result.length > 0) {
      for (const item of result.slice(0, 25) as Array<Record<string, unknown>>) {
        lines.push(`  - ${String(item.title ?? item.id)} (${String(item.id)})${item.status ? ` [${String(item.status)}]` : ''}`);
      }
      if (result.length > 25) lines.push(`  - ...and ${result.length - 25} more`);
    }
    return lines.join('\n');
  }

  const json = JSON.stringify(result);
  if (!json) return `- ${action}: completed`;
  return `- ${action}: ${json.length > 1200 ? `${json.slice(0, 1200)}...` : json}`;
}

function formatChatProgress(results: Array<{ action: string; result: unknown }>): string {
  if (results.length === 0) return '';
  const lines = ['Progress:'];
  results.forEach((result, index) => {
    lines.push(`${index + 1}. Ran ${result.action}`);
  });
  return lines.join('\n');
}

export function createApi(deps: ApiDeps): express.Express {
  const app = express();
  const rateLimits = new Map<string, RateLimitEntry>();
  const sseClients = new Set<{ cleanup: () => void }>();
  const maxSseClients = 20;
  const dispatchChatSessions = new Map<string, DispatchChatSessionState>();
  const dispatchChatIdleTtlMs = 30 * 60_000;

  const dispatchChatKey = (speaker: string) => `dispatch-chat:${speaker}`;

  const releaseDispatchChatSession = async (key: string): Promise<boolean> => {
    const state = dispatchChatSessions.get(key);
    if (!state) return false;
    dispatchChatSessions.delete(key);
    await deps.sessionPool.release(state.session.id);
    return true;
  };

  const resetDispatchChatSessions = async (): Promise<void> => {
    await Promise.all([...dispatchChatSessions.keys()].map(key => releaseDispatchChatSession(key)));
  };

  const cleanupExpiredDispatchChatSessions = (): void => {
    const cutoff = Date.now() - dispatchChatIdleTtlMs;
    for (const state of dispatchChatSessions.values()) {
      if (state.lastUsedAt.getTime() < cutoff && !state.activeTurn) {
        void releaseDispatchChatSession(state.key);
      }
    }
  };

  const getOrCreateDispatchChatSession = async (key: string, threadId: string): Promise<DispatchChatSessionState> => {
    cleanupExpiredDispatchChatSessions();
    const model = deps.modelManager.getChatModel();
    const existing = dispatchChatSessions.get(key);
    if (existing && existing.model === model && existing.session.isActive()) return existing;
    if (existing) await releaseDispatchChatSession(key);

    let state: DispatchChatSessionState | undefined;
    const session = await deps.sessionPool.acquire(key, {
      ...buildDispatchChatRuntimeOptions(deps),
      model,
      workingDirectory: process.cwd(),
      tools: buildDispatchChatTools(deps, result => state?.activeTurn?.results.push(result)),
      onPermissionRequest: async (req) => {
        const runtimeConfig = deps.taskRuntimeConfig.get();
        if (runtimeConfig.permissionMode === 'deny-blocked') {
          const excluded = new Set(runtimeConfig.excludedTools.map(tool => tool.toLowerCase()));
          const toolName = String(req.details?.toolName ?? req.details?.name ?? '').toLowerCase();
          if (toolName && excluded.has(toolName)) return false;
        }
        return true;
      },
      onEvent: (event) => {
        const turn = state?.activeTurn;
        if (!turn) return;
        if (event.type === 'assistant.message' && event.data.content) {
          turn.chunks.push(event.data.content);
        } else if (event.type === 'session.idle') {
          turn.resolveIdle();
        } else if (event.type === 'error') {
          turn.rejectIdle(new Error(errorMessage(event.data.error, `Copilot session error while using ${model}`)));
        }
      },
    }).catch((err) => {
      throw new Error(`Failed to start Dispatch Chat session with model ${model}: ${errorMessage(err, 'no details returned')}`);
    });

    state = {
      key,
      threadId,
      session,
      model,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
    dispatchChatSessions.set(key, state);
    return state;
  };

  const runDispatchChatSession = async (message: string, threadId: string, speaker: string) => {
    const key = dispatchChatKey(speaker);
    const state = await getOrCreateDispatchChatSession(key, threadId);
    if (state.activeTurn) {
      throw new Error('Dispatch Chat session is already processing a request. Wait for the current response before sending another message.');
    }

    let resolveIdle!: () => void;
    let rejectIdle!: (err: Error) => void;
    const idle = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectIdle = reject;
    });
    const turn: DispatchChatTurn = { chunks: [], results: [], resolveIdle, rejectIdle };
    state.activeTurn = turn;
    state.lastUsedAt = new Date();

    try {
      await state.session.send(message);
      await Promise.race([
        idle,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Dispatch Chat session')), deps.executionSettings.get().taskSessionIdleTimeoutMs)),
      ]);
      state.lastUsedAt = new Date();
      const response = turn.chunks.join('\n').trim();
      return {
        message: response || (turn.results.length > 0 ? 'Dispatch action(s) completed.' : 'Dispatch Chat did not return a response.'),
        results: turn.results,
        sessionId: state.session.id,
        model: state.model,
      };
    } catch (err) {
      await releaseDispatchChatSession(key);
      throw err;
    } finally {
      if (dispatchChatSessions.get(key) === state) {
        state.activeTurn = undefined;
      }
    }
  };

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));

  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
    (req as any).requestId = requestId;
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const originalJson = res.json.bind(res);
    res.json = (body?: any) => {
      if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
        return originalJson({ ...body, requestId });
      }
      return originalJson(body);
    };

    next();
  });

  app.use('/api', (req, res, next) => {
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 1000;
    const client = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${client}:${req.method}:${req.path}`;
    const current = rateLimits.get(key);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };
    entry.count++;
    rateLimits.set(key, entry);

    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    next();
  });

  // --- Optional bearer-token auth (set DISPATCH_API_KEY to enable) ---
  const apiKey = process.env.DISPATCH_API_KEY;
  if (apiKey) {
    app.use((req, res, next) => {
      // Allow health checks without auth for liveness probes.
      if (req.path === '/api/health') return next();
      // GitHub webhooks have their own HMAC verification.
      if (req.path === '/api/webhooks/github') return next();
      const header = req.headers.authorization ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
      if (presented !== apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // --- Feature catalog ---
  app.get('/api/features', (req, res) => {
    const catalog = createFeatureCatalog(deps);
    const q = req.query.q?.toString().trim().toLowerCase();
    if (!q) {
      res.json(catalog);
      return;
    }

    res.json({
      ...catalog,
      features: catalog.features.filter(feature =>
        feature.title.toLowerCase().includes(q) ||
        feature.summary.toLowerCase().includes(q) ||
        feature.details.toLowerCase().includes(q) ||
        feature.category.toLowerCase().includes(q)
      ),
    });
  });

  // --- Task runtime capabilities ---
  app.get('/api/task-runtime/config', (req, res) => {
    try {
      res.json(getTaskRuntimePayload(deps));
    } catch (err: any) {
      res.status(500).json({ error: errorMessage(err, 'Failed to read task runtime config') });
    }
  });

  app.post('/api/task-runtime/config', (req, res) => {
    try {
      deps.taskRuntimeConfig.update(req.body ?? {});
      res.json({
        ...getTaskRuntimePayload(deps),
        message: 'Task runtime configuration updated',
      });
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to update task runtime config') });
    }
  });

  app.post('/api/task-runtime/config/reset', (req, res) => {
    deps.taskRuntimeConfig.reset();
    res.json({
      ...getTaskRuntimePayload(deps),
      message: 'Task runtime configuration reset to Copilot CLI autopilot defaults',
    });
  });

  app.post('/api/integrations/workiq', (req, res) => {
    try {
      res.json({
        ...configureWorkIqIntegration(deps, req.body?.enabled !== false, req.body?.server),
        message: req.body?.enabled === false ? 'WorkIQ integration disabled for task sessions' : 'WorkIQ integration enabled for task sessions',
      });
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to configure WorkIQ integration') });
    }
  });

  app.get('/api/execution/settings', (req, res) => {
    res.json({
      settings: deps.executionSettings.get(),
      path: deps.executionSettings.path,
      sessions: {
        active: deps.sessionPool.size,
        available: deps.sessionPool.available,
        limit: deps.sessionPool.limit,
      },
    });
  });

  app.post('/api/execution/settings', (req, res) => {
    try {
      const next = deps.executionSettings.update({
        maxConcurrentSessions: req.body?.maxConcurrentSessions,
        taskSessionIdleTimeoutMs: req.body?.taskSessionIdleTimeoutMs,
      });
      deps.sessionPool.setMaxConcurrent(next.maxConcurrentSessions);
      deps.scheduler.setConcurrency(next.maxConcurrentSessions);
      res.json({
        settings: next,
        path: deps.executionSettings.path,
        sessions: {
          active: deps.sessionPool.size,
          available: deps.sessionPool.available,
          limit: deps.sessionPool.limit,
        },
        message: `Max concurrent sessions set to ${next.maxConcurrentSessions}; task idle timeout set to ${next.taskSessionIdleTimeoutMs}ms`,
      });
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to update execution settings') });
    }
  });

  // --- Tasks ---
  app.post('/api/tasks', (req, res) => {
    try {
      if (typeof req.body?.teamId === 'string' && req.body.teamId.trim()) {
        const created = createTeamTaskGroup(deps, req.body.teamId, { ...req.body, createdBy: req.body.createdBy ?? 'api' });
        res.status(201).json({ ...created.leadTask, team: created.team, memberTasks: created.memberTasks });
        return;
      }
      const task = deps.taskManager.createTask({ ...req.body, createdBy: req.body.createdBy ?? 'api' });
      res.status(201).json(task);
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Dispatch Chat failed without details. Try another chat model or check daemon logs.') });
    }
  });

  app.post('/api/tasks/preview', async (req, res) => {
    try {
      const preview = await previewTask(deps, req.body ?? {});
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to preview task') });
    }
  });

  app.get('/api/tasks', (req, res) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const tasks = deps.taskManager.listTasks(status as any, limit);
    res.json(tasks);
  });

  app.post('/api/tasks/enqueue-pending', (req, res) => {
    try {
      const result = enqueuePendingTasksByPriority(deps, { dryRun: req.body?.dryRun === true });
      res.json({
        ...result,
        message: formatPendingEnqueueSummary(result),
      });
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to enqueue pending tasks') });
    }
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = deps.taskManager.getTask(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  });

  app.put('/api/tasks/:id', (req, res) => {
    try {
      const task = typeof req.body?.teamId === 'string' && req.body.teamId.trim()
        ? assignExistingTaskToTeam(deps, req.params.id, req.body.teamId, req.body ?? {})
        : deps.taskManager.updateTask(req.params.id, req.body ?? {});
      if (task.status === 'queued') {
        deps.scheduler.enqueue(task);
      }
      res.json(task);
    } catch (err: any) {
      const message = errorMessage(err, 'Failed to update task');
      const status = message.includes('Task not found') ? 404 : message.includes('running') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/tasks/:id/enqueue', (req, res) => {
    try {
      const existing = deps.taskManager.getTask(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }
      const approval = ensureExecutionApproved(deps, existing);
      if (!approval.approved) {
        res.status(202).json({
          approvalRequired: true,
          approval: approval.approval,
          message: `Approval required before task ${existing.id} can execute`,
        });
        return;
      }
      const task = deps.taskManager.enqueueTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/cancel', (req, res) => {
    try {
      const task = deps.taskManager.cancelTask(req.params.id, req.body.reason ?? 'Cancelled via API');
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/cancellation-reason', (req, res) => {
    try {
      const reasonInput = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const existing = deps.taskManager.getTask(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }
      if (existing.status !== 'cancelled') {
        res.status(409).json({ error: `Cannot set cancellation reason on a ${existing.status} task` });
        return;
      }
      const merged = { ...existing.metadata, cancellationReason: reasonInput || null };
      const task = deps.taskManager.updateTaskMetadata(req.params.id, merged);
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: errorMessage(err, 'Failed to set cancellation reason') });
    }
  });

  app.delete('/api/tasks/:id', (req, res) => {
    try {
      const recursive = req.query.recursive === 'true' || req.body?.recursive === true;
      res.json(deleteDispatchTask(deps, req.params.id, recursive));
    } catch (err: any) {
      const message = errorMessage(err, 'Failed to delete task');
      const status = message.includes('Task not found') ? 404 : message.includes('running task') || message.includes('subtask') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/tasks/:id/retry', (req, res) => {
    try {
      const task = deps.taskManager.retryTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/execute', async (req, res) => {
    try {
      const task = deps.taskManager.getTask(req.params.id);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      const approval = ensureExecutionApproved(deps, task);
      if (!approval.approved) {
        res.status(202).json({
          approvalRequired: true,
          approval: approval.approval,
          message: `Approval required before task ${task.id} can execute`,
        });
        return;
      }
      // Only enqueue. The daemon's `task.queued` event handler routes it
      // through the scheduler — directly calling executeTask() here caused
      // double-dispatch (scheduler picked it up too).
      deps.taskManager.enqueueTask(req.params.id);
      res.json({ message: `Task ${task.id} dispatched for execution` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tasks/:id/events', (req, res) => {
    const events = deps.taskManager.getTaskEvents(req.params.id);
    res.json(events);
  });

  app.get('/api/tasks/:id/details', (req, res) => {
    const task = deps.taskManager.getTask(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    const artifactPaths = deps.artifactCollector.getArtifacts(task.id)
      .split(/\r?\n/)
      .map(p => p.trim())
      .filter(Boolean);
    const planCandidates = [
      task.workingDirectory ? join(task.workingDirectory, 'plan.md') : '',
      task.workingDirectory ? join(task.workingDirectory, 'PLAN.md') : '',
      ...artifactPaths.filter(p => /(^|[\\/])plan\.md$/i.test(p)),
    ].filter(Boolean);
    const workdirMarkdown = task.workingDirectory ? findMarkdownDocuments(task.workingDirectory) : [];
    const artifactMarkdown = artifactPaths.filter(p => /\.(md|markdown)$/i.test(p));

    res.json({
      task,
      events: deps.taskManager.getTaskEvents(task.id),
      approvals: deps.approvalManager.getByTask(task.id),
      latestCheckpoint: deps.taskManager.getLatestCheckpoint(task.id) ?? null,
      artifactPaths,
      planPaths: [...new Set(planCandidates)].filter(existsSync),
      markdownPaths: [...new Set([...workdirMarkdown, ...artifactMarkdown])].filter(existsSync),
      locations: {
        workingDirectory: task.workingDirectory ?? null,
        repository: task.repo ?? null,
        workingDirectorySource: task.workingDirectory
          ? task.workingDirectory === task.repo ? 'repository' : 'task-worktree'
          : null,
      },
    });
  });

  app.get('/api/tasks/:id/subtasks', (req, res) => {
    const subtasks = deps.taskManager.getSubtasks(req.params.id);
    res.json(subtasks);
  });

  app.get('/api/tasks/:id/recovery', (req, res) => {
    const task = deps.taskManager.getTask(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    const recovery = task.metadata.recovery ?? null;
    res.json({
      taskId: task.id,
      status: task.status,
      workingDirectory: task.workingDirectory ?? null,
      recovery,
      latestCheckpoint: deps.taskManager.getLatestCheckpoint(task.id) ?? null,
      events: deps.taskManager.getTaskEvents(task.id).slice(-25),
      actions: ['resume', 'restart', 'abandon'],
    });
  });

  app.post('/api/tasks/:id/recovery', (req, res) => {
    try {
      const action = req.body.action as string;
      if (!['resume', 'restart', 'abandon'].includes(action)) {
        res.status(400).json({ error: '"action" must be one of: resume, restart, abandon' });
        return;
      }

      if (action === 'abandon') {
        const task = deps.taskManager.cancelTask(req.params.id, req.body.reason ?? 'Abandoned during recovery');
        res.json(task);
        return;
      }

      const task = deps.taskManager.resumeRecoveredTask(req.params.id, action as 'resume' | 'restart');
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Approvals ---
  app.get('/api/approvals', (req, res) => {
    const approvals = deps.approvalManager.getPending();
    res.json(approvals);
  });

  app.post('/api/approvals/:id/approve', (req, res) => {
    const approval = deps.approvalManager.approve(req.params.id, req.body.decidedBy ?? 'api-user');
    if (!approval) { res.status(404).json({ error: 'Approval not found or already decided' }); return; }
    res.json(approval);
  });

  app.post('/api/approvals/:id/reject', (req, res) => {
    const approval = deps.approvalManager.reject(req.params.id, req.body.decidedBy ?? 'api-user');
    if (!approval) { res.status(404).json({ error: 'Approval not found or already decided' }); return; }
    res.json(approval);
  });

  // --- Agents ---
  app.get('/api/agents', (req, res) => {
    const agents = deps.agentLoader.list().map(a => ({
      name: agentHandle(a.name),
      description: a.description,
      model: a.model,
      skills: a.skills,
      domain: a.domain,
      teamType: a.teamType,
      teamRoles: a.teamRoles,
      filePath: a.filePath,
    }));
    res.json(agents);
  });

  app.get('/api/agents/:name/content', (req, res) => {
    const rawName = decodeURIComponent(req.params.name);
    const agentName = rawName.startsWith('@') ? rawName : `@${rawName}`;
    const agent = deps.agentLoader.get(agentName);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    try {
      res.json({
        name: agentName,
        filePath: agent.filePath,
        content: readFileSync(agent.filePath, 'utf-8'),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents', (req, res) => {
    try {
      const { name, description, model, skills, tools, mcpServers, systemPrompt } = req.body;
      if (!name || !description || !systemPrompt) {
        res.status(400).json({ error: '"name", "description", and "systemPrompt" required' });
        return;
      }
      const agent = deps.agentLoader.create({
        name,
        description,
        model,
        skills: Array.isArray(skills) ? skills : [],
        tools: Array.isArray(tools) ? tools : [],
        mcpServers: Array.isArray(mcpServers) ? mcpServers : [],
        systemPrompt,
      });
      res.status(201).json({
        name: agentHandle(agent.name),
        description: agent.description,
        model: agent.model,
        skills: agent.skills,
        domain: agent.domain,
        teamType: agent.teamType,
        teamRoles: agent.teamRoles,
        filePath: agent.filePath,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/agents/generate', async (req, res) => {
    try {
      const { description, model, teamType, teamRole } = req.body;
      if (!description || typeof description !== 'string') {
        res.status(400).json({ error: '"description" required' });
        return;
      }
      const generated = await generateAgentMarkdownResilient(deps, description, model, teamType, teamRole);
      const agent = deps.agentLoader.createFromContent(generated.content);
      res.status(201).json({
        name: agentHandle(agent.name),
        description: agent.description,
        model: agent.model,
        skills: agent.skills,
        domain: agent.domain,
        teamType: agent.teamType,
        teamRoles: agent.teamRoles,
        filePath: agent.filePath,
        content: generated.content,
        generatedBy: generated.generatedBy,
        generationError: generated.error,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Agent Teams ---
  app.get('/api/teams', (req, res) => {
    res.json(deps.teamRepo.listAll());
  });

  app.post('/api/teams', (req, res) => {
    try {
      const { name, description, leadAgent, memberAgents, metadata } = req.body;
      if (!name || !leadAgent || !Array.isArray(memberAgents)) {
        res.status(400).json({ error: '"name", "leadAgent", and "memberAgents" required' });
        return;
      }
      const agents = [leadAgent, ...memberAgents];
      const missing = agents.filter(agent => !deps.agentLoader.has(agent));
      if (missing.length > 0) {
        res.status(400).json({ error: `Unknown agent(s): ${missing.join(', ')}` });
        return;
      }
      const team = deps.teamRepo.create({ name, description, leadAgent, memberAgents, metadata });
      res.status(201).json(team);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/teams/:id', (req, res) => {
    const team = deps.teamRepo.getById(req.params.id);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
    res.json(team);
  });

  app.delete('/api/teams/:id', (req, res) => {
    const ok = deps.teamRepo.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Team not found' }); return; }
    res.json({ id: req.params.id, removed: true });
  });

  app.post('/api/teams/:id/run', (req, res) => {
    try {
      const body = req.body ?? {};
      const created = createTeamTaskGroup(deps, req.params.id, { ...body, createdBy: body.createdBy ?? 'team' });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Stats / Health ---
  app.get('/api/stats', (req, res) => {
    res.json({
      tasks: deps.taskManager.getStats(),
      queue: deps.scheduler.queueLength,
      running: deps.scheduler.runningCount,
      sessions: {
        active: deps.sessionPool.size,
        available: deps.sessionPool.available,
      },
      pendingApprovals: deps.approvalManager.getPending().length,
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // --- Models ---
  app.get('/api/models', (req, res) => {
    res.json({
      current: deps.modelManager.getDefault(),
      chatModel: deps.modelManager.getChatModel(),
      chatModelOverride: deps.modelManager.getChatModelOverride(),
      agentOverrides: deps.modelManager.getAgentOverrides(),
      available: deps.modelManager.listModels(),
    });
  });

  app.get('/api/models/current', (req, res) => {
    res.json({ model: deps.modelManager.getDefault() });
  });

  app.get('/api/chat/model', (req, res) => {
    res.json({
      model: deps.modelManager.getChatModel(),
      override: deps.modelManager.getChatModelOverride(),
      defaultModel: deps.modelManager.getDefault(),
      available: deps.modelManager.listModels(),
    });
  });

  app.post('/api/chat/model', async (req, res) => {
    const { model } = req.body;
    if (!model || typeof model !== 'string') { res.status(400).json({ error: '"model" required' }); return; }
    if (model === 'default' || model === 'auto') {
      deps.modelManager.clearChatModel();
      await resetDispatchChatSessions();
      res.json({
        message: `Dispatch Chat will use the default model ${deps.modelManager.getDefault()}`,
        model: deps.modelManager.getChatModel(),
        override: deps.modelManager.getChatModelOverride(),
        defaultModel: deps.modelManager.getDefault(),
      });
      return;
    }

    const found = deps.modelManager.findModel(model);
    if (!found) { res.status(400).json({ error: `Unknown model: ${model}. Use GET /api/chat/model for available models.` }); return; }
    deps.modelManager.setChatModel(found.id);
    await resetDispatchChatSessions();
    res.json({
      message: `Dispatch Chat switched to ${found.id}`,
      model: found.id,
      override: found.id,
      defaultModel: deps.modelManager.getDefault(),
    });
  });

  app.get('/api/chat/session', (req, res) => {
    const speaker = typeof req.query.speaker === 'string' ? req.query.speaker : undefined;
    const sessions = [...dispatchChatSessions.values()]
      .filter(state => !speaker || state.key === dispatchChatKey(speaker))
      .map(state => ({
        key: state.key,
        threadId: state.threadId,
        sessionId: state.session.id,
        model: state.model,
        createdAt: state.createdAt.toISOString(),
        lastUsedAt: state.lastUsedAt.toISOString(),
        busy: !!state.activeTurn,
      }));
    res.json({ sessions });
  });

  app.delete('/api/chat/session', async (req, res) => {
    const speaker = typeof req.query.speaker === 'string'
      ? req.query.speaker
      : (typeof req.body?.speaker === 'string' ? req.body.speaker : undefined);
    if (speaker) {
      const removed = await releaseDispatchChatSession(dispatchChatKey(speaker));
      res.json({ removed, speaker });
      return;
    }
    await resetDispatchChatSessions();
    res.json({ removed: true, all: true });
  });

  app.post('/api/models/switch', (req, res) => {
    const { model, agent } = req.body;
    if (!model) { res.status(400).json({ error: '"model" required' }); return; }

    const found = deps.modelManager.findModel(model);
    if (!found) { res.status(400).json({ error: `Unknown model: ${model}. Use GET /api/models for available models.` }); return; }

    if (agent) {
      deps.modelManager.setAgentModel(agent, found.id);
      res.json({ message: `Agent ${agent} switched to ${found.id}`, agent, model: found.id });
    } else {
      deps.modelManager.setDefault(found.id);
      res.json({ message: `Default model switched to ${found.id}`, model: found.id });
    }
  });

  app.post('/api/models/reset', (req, res) => {
    const { agent } = req.body;
    if (agent) {
      deps.modelManager.clearAgentModel(agent);
      res.json({ message: `Agent ${agent} model reset to definition default`, agent });
    } else {
      res.status(400).json({ error: 'Specify "agent" to reset, or use /api/models/switch to set default' });
    }
  });

  // --- SSE Event Stream ---
  app.get('/api/events/stream', (req, res) => {
    if (sseClients.size >= maxSseClients) {
      req.socket.destroy();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let cleanup = () => {};
    const handler = (event: any) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    let closed = false;
    const heartbeat = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        cleanup();
      }
    }, 30_000);
    const client = {
      cleanup: () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        deps.eventBus.off('*', handler);
        sseClients.delete(client);
      },
    };
    cleanup = client.cleanup;
    sseClients.add(client);
    deps.eventBus.onAny(handler);
    req.once('close', cleanup);
    res.once('error', cleanup);
  });

  // --- Copilot-backed Dispatch Chat ---
  app.post('/api/chat', async (req, res) => {
    const { message, channel = 'vscode', speaker = 'vscode-user' } = req.body;
    if (!message || typeof message !== 'string') { res.status(400).json({ error: '"message" required' }); return; }

    const threadId = `dispatch-chat:${speaker}`;
    deps.memoryManager.recordMessage({
      channel,
      threadId,
      speaker,
      speakerType: 'user',
      role: 'user',
      content: message,
      metadata: { surface: 'vscode' },
    });

    if (message.trim().toLowerCase() === '/teams') {
      const response = formatTeamsSummary(deps);
      deps.memoryManager.recordMessage({
        channel,
        threadId,
        speaker: 'dispatch',
        speakerType: 'agent',
        role: 'assistant',
        content: response,
        metadata: { surface: 'vscode', command: '/teams' },
      });
      res.json({ response, data: { command: '/teams' } });
      return;
    }

    const deleteTaskCommand = parseDeleteTaskMessage(message);
    if (deleteTaskCommand) {
      try {
        const result = deleteDispatchTask(deps, deleteTaskCommand.id, deleteTaskCommand.recursive);
        const response = result.message;
        deps.memoryManager.recordMessage({
          channel,
          threadId,
          speaker: 'dispatch',
          speakerType: 'agent',
          role: 'assistant',
          content: response,
          metadata: { surface: 'vscode', command: 'delete_task', result },
        });
        res.json({ response, data: { command: 'delete_task', result } });
      } catch (err: any) {
        const message = errorMessage(err, 'Failed to delete task');
        res.status(message.includes('Task not found') ? 404 : message.includes('running task') || message.includes('subtask') ? 409 : 400).json({ error: message });
      }
      return;
    }

    const deleteAllTasksCommand = parseDeleteAllTasksMessage(message);
    if (deleteAllTasksCommand) {
      const result = deleteAllDispatchTasks(deps, { dryRun: deleteAllTasksCommand.dryRun });
      const response = [
        deleteAllTasksCommand.dryRun
          ? 'I interpreted this as a preview of deleting all Dispatch tasks one by one.'
          : 'I interpreted this as a request to delete all Dispatch tasks one by one.',
        'Progress:',
        `1. Listed ${result.total} task(s).`,
        deleteAllTasksCommand.dryRun
          ? `2. Identified ${result.deleted.length} non-running task(s) that would be deleted.`
          : `2. Deleted ${result.deleted.length} non-running task(s).`,
        result.skippedRunning.length > 0 ? `3. Skipped ${result.skippedRunning.length} running task(s).` : '',
        result.failed.length > 0 ? `4. ${result.failed.length} task(s) could not be deleted.` : '',
        '',
        result.message,
      ].filter(Boolean).join('\n');
      deps.memoryManager.recordMessage({
        channel,
        threadId,
        speaker: 'dispatch',
        speakerType: 'agent',
        role: 'assistant',
        content: response,
        metadata: { surface: 'vscode', command: 'delete_all_tasks', result },
      });
      res.json({ response, data: { command: 'delete_all_tasks', result } });
      return;
    }

    if (isStartPendingTasksMessage(message)) {
      const result = enqueuePendingTasksByPriority(deps);
      const response = formatPendingEnqueueSummary(result);
      deps.memoryManager.recordMessage({
        channel,
        threadId,
        speaker: 'dispatch',
        speakerType: 'agent',
        role: 'assistant',
        content: response,
        metadata: { surface: 'vscode', command: 'enqueue_pending_tasks' },
      });
      res.json({ response, data: { command: 'enqueue_pending_tasks', result } });
      return;
    }

    try {
      const sessionResult = await runDispatchChatSession(message, threadId, speaker);
      const results = sessionResult.results;
      const response = [
        sessionResult.message,
        results.length ? `\n\n${formatChatProgress(results)}` : '',
        results.length
          ? `\n\nExecuted ${results.length} Dispatch action(s):\n${results.map(result => formatChatActionResult(result.action, result.result)).join('\n')}`
          : '',
      ].join('');

      deps.memoryManager.recordMessage({
        channel,
        threadId,
        speaker: 'dispatch',
        speakerType: 'agent',
        role: 'assistant',
        content: response,
        metadata: {
          surface: 'vscode',
          sessionId: sessionResult.sessionId,
          model: sessionResult.model,
          results,
        },
      });

      res.json({
        response,
        data: {
          sessionId: sessionResult.sessionId,
          model: sessionResult.model,
          results,
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Memory: Conversations ---
  app.post('/api/conversations', (req, res) => {
    try {
      const msg = deps.memoryManager.recordMessage({
        channel: req.body.channel ?? 'api',
        threadId: req.body.threadId,
        speaker: req.body.speaker ?? 'anonymous',
        speakerType: req.body.speakerType ?? 'user',
        role: req.body.role ?? 'user',
        content: req.body.content,
        metadata: req.body.metadata,
      });
      res.status(201).json(msg);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/conversations', (req, res) => {
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = channel
      ? deps.memoryManager.conversations.getRecentByChannel(channel, limit)
      : deps.memoryManager.conversations.getRecent(limit);
    res.json(messages);
  });

  app.get('/api/conversations/search', (req, res) => {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'Query parameter "q" required' }); return; }
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const messages = channel
      ? deps.memoryManager.conversations.searchInChannel(channel, q, limit)
      : deps.memoryManager.conversations.search(q, limit);
    res.json(messages);
  });

  app.get('/api/conversations/threads', (req, res) => {
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const threads = channel
      ? deps.memoryManager.conversations.getThreadsByChannel(channel, limit)
      : deps.memoryManager.conversations.getThreads(limit);
    res.json(threads);
  });

  app.get('/api/conversations/thread/:channel/:threadId', (req, res) => {
    const messages = deps.memoryManager.conversations.getByThread(
      req.params.channel, req.params.threadId, 200,
    );
    res.json(messages);
  });

  // --- Memory: Relevance Suggestions ---
  app.post('/api/memory/suggest', (req, res) => {
    const { message, channel, limit } = req.body;
    if (!message) { res.status(400).json({ error: '"message" required' }); return; }
    const suggestions = deps.memoryManager.getRelevanceSuggestions(
      message, channel ?? 'api', limit ?? 10,
    );
    res.json(suggestions);
  });

  app.post('/api/memory/context', (req, res) => {
    const { message, speakers, channel } = req.body;
    if (!message) { res.status(400).json({ error: '"message" required' }); return; }
    const context = deps.memoryManager.buildContextForConversation(
      message, speakers ?? [], channel ?? 'api',
    );
    res.json({ context });
  });

  // --- Memory: Facts ---
  app.get('/api/memory/facts', (req, res) => {
    const entity = req.query.entity as string | undefined;
    const type = req.query.type as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;

    if (entity) {
      res.json(deps.memoryManager.proactive.getFactsByEntity(entity));
    } else if (q) {
      res.json(deps.memoryManager.proactive.searchFacts(q, limit));
    } else if (type) {
      res.json(deps.memoryManager.proactive.getFactsByType(type, limit));
    } else {
      res.json(deps.memoryManager.proactive.getRecentFacts(limit));
    }
  });

  app.get('/api/memory/entities', (req, res) => {
    res.json(deps.memoryManager.proactive.getAllEntities());
  });

  app.get('/api/memory/profile/:entity', (req, res) => {
    const profile = deps.memoryManager.proactive.getEntityProfile(req.params.entity);
    res.json({ entity: req.params.entity, profile });
  });

  // --- Memory: Episodic Summaries ---
  app.get('/api/memory/episodes', (req, res) => {
    const date = req.query.date as string | undefined;
    const channel = req.query.channel as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    if (q) {
      res.json(deps.memoryManager.episodic.searchSummaries(q, limit));
    } else if (date) {
      res.json(deps.memoryManager.episodic.getSummariesByDate(date));
    } else if (channel) {
      res.json(deps.memoryManager.episodic.getSummariesByChannel(channel, limit));
    } else {
      res.json(deps.memoryManager.episodic.getRecentSummaries(limit));
    }
  });

  // --- Memory: Stats ---
  app.get('/api/memory/stats', (req, res) => {
    res.json(deps.memoryManager.getStats());
  });

  // --- Skills ---
  app.get('/api/skills', (req, res) => {
    const origin = req.query.origin as string | undefined;
    const q = req.query.q as string | undefined;
    if (q) {
      res.json(deps.skillManager.search(q));
    } else if (origin) {
      res.json(deps.skillManager.listByOrigin(origin as any));
    } else {
      res.json({
        userInstalled: deps.skillManager.listUserInstalled(),
        systemCreated: deps.skillManager.listSystemCreated(),
      });
    }
  });

  app.get('/api/skills/:id', (req, res) => {
    const skill = deps.skillManager.get(req.params.id);
    if (!skill) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json(skill);
  });

  app.get('/api/skills/:id/content', (req, res) => {
    const content = deps.skillManager.readSkillContent(req.params.id);
    if (content === null) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, content });
  });

  app.post('/api/skills/create', (req, res) => {
    try {
      const { name, description, instructions } = req.body;
      if (!name || !instructions) { res.status(400).json({ error: '"name" and "instructions" required' }); return; }
      const skill = deps.skillManager.createSkill(name, description ?? '', instructions);
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/install/github', async (req, res) => {
    try {
      const { repoUrl, name } = req.body;
      if (!repoUrl) { res.status(400).json({ error: '"repoUrl" required' }); return; }
      const skill = await deps.skillManager.installFromGitHub(repoUrl, name);
      if (!skill) { res.status(400).json({ error: 'Failed to install skill' }); return; }
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/install/skills-sh', async (req, res) => {
    try {
      const { source } = req.body;
      if (!source || typeof source !== 'string') { res.status(400).json({ error: '"source" required' }); return; }
      const skill = await deps.skillManager.installFromSkillsSh(source);
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/install/registry', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) { res.status(400).json({ error: '"name" required' }); return; }
      const skill = await deps.skillManager.installFromRegistry(name);
      if (!skill) { res.status(400).json({ error: 'Failed to install skill from registry' }); return; }
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/:id/enable', (req, res) => {
    const ok = deps.skillManager.setEnabled(req.params.id, true);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, enabled: true });
  });

  app.post('/api/skills/:id/disable', (req, res) => {
    const ok = deps.skillManager.setEnabled(req.params.id, false);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, enabled: false });
  });

  app.delete('/api/skills/:id', (req, res) => {
    const ok = deps.skillManager.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, removed: true });
  });

  // --- Automation ---
  app.get('/api/automation', (req, res) => {
    const type = req.query.type as string | undefined;
    if (type) {
      res.json(deps.automationScheduler.listByType(type as any));
    } else {
      res.json(deps.automationScheduler.listAll());
    }
  });

  app.get('/api/automation/:id', (req, res) => {
    const job = deps.automationScheduler.getById(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json(job);
  });

  app.post('/api/automation', (req, res) => {
    try {
      const job = deps.automationScheduler.create(req.body);
      res.status(201).json(job);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/automation/:id/enable', (req, res) => {
    const ok = deps.automationScheduler.setEnabled(req.params.id, true);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, enabled: true });
  });

  app.post('/api/automation/:id/disable', (req, res) => {
    const ok = deps.automationScheduler.setEnabled(req.params.id, false);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, enabled: false });
  });

  app.post('/api/automation/:id/run', async (req, res) => {
    const job = deps.automationScheduler.getById(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    const result = await deps.automationScheduler.executeJob(job, req.body);
    res.json(result);
  });

  app.delete('/api/automation/:id', (req, res) => {
    const ok = deps.automationScheduler.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, removed: true });
  });

  // --- Webhook ingress ---
  app.post('/api/webhooks/:path', async (req, res) => {
    // Special handling for GitHub webhooks
    if (req.params.path === 'github') {
      // HMAC verification when GITHUB_WEBHOOK_SECRET is set.
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (secret) {
        const sig = String(req.headers['x-hub-signature-256'] ?? '');
        const raw: Buffer | undefined = (req as any).rawBody;
        if (!sig || !raw) { res.status(401).json({ error: 'Missing signature' }); return; }
        const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }
      const eventType = req.headers['x-github-event'] as string ?? 'unknown';
      const result = deps.githubEvents.handle(eventType, req.body ?? {});
      res.json(result);
      return;
    }

    const result = await deps.automationScheduler.handleWebhook(req.params.path, req.body ?? {});
    if (!result) { res.status(404).json({ error: 'No webhook handler for this path' }); return; }
    res.json(result);
  });

  // --- Proactive Check-In ---
  app.get('/api/checkin', (req, res) => {
    const messages = deps.checkIn.evaluate();
    const emoji: Record<string, string> = { warning: '⚠️', info: 'ℹ️', suggestion: '💡' };
    const formatted = messages.length === 0
      ? '✅ All clear — nothing to report.'
      : messages.map(m => `${emoji[m.type] ?? ''} **${m.title}**\n${m.body}`).join('\n\n');
    res.json({ messages, formatted });
  });

  // --- Browser Automation ---
  app.post('/api/browser/command', async (req, res) => {
    const { command } = req.body;
    if (!command) { res.status(400).json({ error: '"command" required' }); return; }
    try {
      const result = await deps.browserEngine.executeNaturalLanguage(command);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/browser/navigate', async (req, res) => {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: '"url" required' }); return; }
    res.json(await deps.browserEngine.navigate(url));
  });

  app.post('/api/browser/click', async (req, res) => {
    const { text, selector } = req.body;
    if (text) { res.json(await deps.browserEngine.clickText(text)); return; }
    if (selector) { res.json(await deps.browserEngine.click(selector)); return; }
    res.status(400).json({ error: '"text" or "selector" required' });
  });

  app.post('/api/browser/fill', async (req, res) => {
    const { value, label, placeholder, selector } = req.body;
    if (!value) { res.status(400).json({ error: '"value" required' }); return; }
    if (label) { res.json(await deps.browserEngine.fillByLabel(label, value)); return; }
    if (placeholder) { res.json(await deps.browserEngine.fillByPlaceholder(placeholder, value)); return; }
    if (selector) { res.json(await deps.browserEngine.fill(selector, value)); return; }
    res.status(400).json({ error: '"label", "placeholder", or "selector" required' });
  });

  app.post('/api/browser/press', async (req, res) => {
    const { key } = req.body;
    if (!key) { res.status(400).json({ error: '"key" required' }); return; }
    res.json(await deps.browserEngine.press(key));
  });

  app.post('/api/browser/scroll', async (req, res) => {
    const direction = req.body.direction ?? 'down';
    const amount = req.body.amount ?? 500;
    res.json(await deps.browserEngine.scroll(direction, amount));
  });

  app.get('/api/browser/page', async (req, res) => {
    try {
      res.json(await deps.browserEngine.getPageInfo());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/browser/screenshot', async (req, res) => {
    try {
      const data = await deps.browserEngine.screenshot();
      res.json({ screenshot: data });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/browser/text', async (req, res) => {
    const selector = req.query.selector as string | undefined;
    try {
      const text = await deps.browserEngine.extractText(selector);
      res.json({ text });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/browser/status', (req, res) => {
    res.json({
      running: deps.browserEngine.isRunning(),
      currentUrl: deps.browserEngine.getCurrentUrl(),
      history: deps.browserEngine.getHistory(),
    });
  });

  // --- Hot Reload / Restart / Update ---
  app.post('/api/reload', (req, res) => {
    const result = deps.hotReloader.reloadAll();
    res.json({ message: `Reloaded: ${result.agents} agents, ${result.skills} skills`, ...result });
  });

  app.get('/api/reload/status', (req, res) => {
    res.json(deps.hotReloader.getStats());
  });

  app.post('/api/restart', async (req, res) => {
    res.json({ message: 'Restarting dispatch daemon...', pid: process.pid });
    // Give response time to send, then restart
    setTimeout(async () => {
      const { selfRestart } = await import('../execution/self-manage.js');
      selfRestart(process.cwd());
    }, 500);
  });

  app.post('/api/update', async (req, res) => {
    try {
      const { selfUpdate } = await import('../execution/self-manage.js');
      const result = selfUpdate(process.cwd());
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

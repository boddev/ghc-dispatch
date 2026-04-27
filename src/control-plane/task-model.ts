import { z } from 'zod';

// --- Enums ---

export const TaskStatus = z.enum([
  'pending',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Priority = z.enum(['critical', 'high', 'normal', 'low']);
export type Priority = z.infer<typeof Priority>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

// --- Task ---

export const CheckpointSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  timestamp: z.string(),
  description: z.string(),
  sessionState: z.string().default(''),
  artifacts: z.array(z.string()).default([]),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const TaskResultSchema = z.object({
  success: z.boolean(),
  summary: z.string().default(''),
  artifacts: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  status: TaskStatus.default('pending'),
  priority: Priority.default('normal'),
  agent: z.string().default('@general-purpose'),
  repo: z.string().optional(),
  workingDirectory: z.string().optional(),
  parentTaskId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  createdBy: z.string().default('cli'),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  result: TaskResultSchema.optional(),
  retryCount: z.number().int().default(0),
  maxRetries: z.number().int().default(3),
  metadata: z.record(z.unknown()).default({}),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInput = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  priority: Priority.default('normal'),
  agent: z.string().default('@general-purpose'),
  model: z.string().optional(),
  repo: z.string().optional(),
  parentTaskId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  createdBy: z.string().default('cli'),
  maxRetries: z.number().int().default(3),
  metadata: z.record(z.unknown()).default({}),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

// --- Approval ---

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.enum(['tool_call', 'task_completion', 'deployment', 'custom']),
  description: z.string(),
  evidence: z.array(z.string()).default([]),
  approvers: z.array(z.string()).default([]),
  status: ApprovalStatus.default('pending'),
  expiresAt: z.string(),
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// --- Events ---

export const OrchestratorEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.created'), taskId: z.string(), data: z.record(z.unknown()) }),
  z.object({ type: z.literal('task.queued'), taskId: z.string(), position: z.number() }),
  z.object({ type: z.literal('task.started'), taskId: z.string(), sessionId: z.string() }),
  z.object({ type: z.literal('task.checkpoint'), taskId: z.string(), checkpoint: CheckpointSchema }),
  z.object({ type: z.literal('task.output'), taskId: z.string(), content: z.string() }),
  z.object({ type: z.literal('task.completed'), taskId: z.string(), result: TaskResultSchema }),
  z.object({ type: z.literal('task.failed'), taskId: z.string(), error: z.string() }),
  z.object({ type: z.literal('task.cancelled'), taskId: z.string(), reason: z.string() }),
  z.object({ type: z.literal('task.paused'), taskId: z.string(), reason: z.string() }),
  z.object({ type: z.literal('task.resumed'), taskId: z.string() }),
  z.object({ type: z.literal('task.retrying'), taskId: z.string(), attempt: z.number() }),
  z.object({ type: z.literal('approval.requested'), approvalId: z.string(), taskId: z.string() }),
  z.object({ type: z.literal('approval.decided'), approvalId: z.string(), decision: z.string() }),
  z.object({ type: z.literal('session.created'), sessionId: z.string(), model: z.string() }),
  z.object({ type: z.literal('session.destroyed'), sessionId: z.string(), reason: z.string() }),
  z.object({ type: z.literal('artifact.captured'), taskId: z.string(), path: z.string() }),
]);
export type OrchestratorEvent = z.infer<typeof OrchestratorEventSchema>;

// --- State Machine ---

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:   ['queued', 'cancelled'],
  queued:    ['running', 'cancelled'],
  running:   ['completed', 'failed', 'paused', 'cancelled'],
  paused:    ['queued', 'cancelled'],
  completed: [],
  failed:    ['queued'],  // retry re-queues
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} → ${to}`);
  }
}

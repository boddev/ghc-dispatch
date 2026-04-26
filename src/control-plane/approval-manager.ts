import type Database from 'better-sqlite3';
import type { ApprovalRequest, ApprovalStatus } from './task-model.js';
import type { EventRepo } from '../store/event-repo.js';
import type { EventBus } from './event-bus.js';
import { ulid } from 'ulid';

export interface CreateApprovalInput {
  taskId: string;
  type: 'tool_call' | 'task_completion' | 'deployment' | 'custom';
  description: string;
  evidence?: string[];
  approvers?: string[];
  expiresInMs?: number;
}

export class ApprovalManager {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    private db: Database.Database,
    private eventRepo: EventRepo,
    private eventBus: EventBus,
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(`
        INSERT INTO approvals (id, task_id, type, description, evidence, approvers, status, expires_at)
        VALUES (@id, @taskId, @type, @description, @evidence, @approvers, @status, @expiresAt)
      `),
      getById: this.db.prepare('SELECT * FROM approvals WHERE id = ?'),
      getByTask: this.db.prepare('SELECT * FROM approvals WHERE task_id = ? ORDER BY rowid DESC'),
      getPending: this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY expires_at ASC"),
      decide: this.db.prepare(`
        UPDATE approvals SET status = @status, decided_by = @decidedBy, decided_at = @decidedAt
        WHERE id = @id AND status = 'pending'
      `),
      expireOld: this.db.prepare(`
        UPDATE approvals SET status = 'expired'
        WHERE status = 'pending' AND expires_at < @now
      `),
    };
  }

  create(input: CreateApprovalInput): ApprovalRequest {
    const id = ulid();
    const expiresAt = new Date(Date.now() + (input.expiresInMs ?? 3_600_000)).toISOString();

    this.stmts.insert.run({
      id,
      taskId: input.taskId,
      type: input.type,
      description: input.description,
      evidence: JSON.stringify(input.evidence ?? []),
      approvers: JSON.stringify(input.approvers ?? []),
      status: 'pending',
      expiresAt,
    });

    const event = { type: 'approval.requested' as const, approvalId: id, taskId: input.taskId };
    this.eventRepo.append(event);
    this.eventBus.emit(event);

    return this.getById(id)!;
  }

  approve(approvalId: string, decidedBy: string): ApprovalRequest | null {
    return this.decide(approvalId, 'approved', decidedBy);
  }

  reject(approvalId: string, decidedBy: string): ApprovalRequest | null {
    return this.decide(approvalId, 'rejected', decidedBy);
  }

  getById(id: string): ApprovalRequest | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToApproval(row) : undefined;
  }

  getByTask(taskId: string): ApprovalRequest[] {
    return (this.stmts.getByTask.all(taskId) as any[]).map(r => this.rowToApproval(r));
  }

  getPending(): ApprovalRequest[] {
    return (this.stmts.getPending.all() as any[]).map(r => this.rowToApproval(r));
  }

  expireStale(): number {
    return this.stmts.expireOld.run({ now: new Date().toISOString() }).changes;
  }

  private decide(approvalId: string, status: 'approved' | 'rejected', decidedBy: string): ApprovalRequest | null {
    const changes = this.stmts.decide.run({
      id: approvalId,
      status,
      decidedBy,
      decidedAt: new Date().toISOString(),
    }).changes;

    if (changes === 0) return null;

    const approval = this.getById(approvalId)!;
    const event = { type: 'approval.decided' as const, approvalId, decision: status };
    this.eventRepo.append(event);
    this.eventBus.emit(event);

    return approval;
  }

  private rowToApproval(row: any): ApprovalRequest {
    return {
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      description: row.description,
      evidence: JSON.parse(row.evidence),
      approvers: JSON.parse(row.approvers),
      status: row.status,
      expiresAt: row.expires_at,
      decidedBy: row.decided_by ?? undefined,
      decidedAt: row.decided_at ?? undefined,
    };
  }
}

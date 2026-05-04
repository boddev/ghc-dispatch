import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
  createdAt: Date;
}

export class WorktreeManager {
  private active = new Map<string, WorktreeInfo>();

  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  async checkout(taskId: string, repoPath: string, baseBranch = 'main'): Promise<WorktreeInfo> {
    const branch = `task/${taskId}`;
    const wtPath = join(this.baseDir, taskId);

    if (existsSync(wtPath)) {
      return this.active.get(taskId) ?? { taskId, path: wtPath, branch, createdAt: new Date() };
    }

    try {
      execSync(`git worktree add "${wtPath}" -b "${branch}" "${baseBranch}"`, {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch (err: any) {
      // If branch already exists, try without -b
      try {
        execSync(`git worktree add "${wtPath}" "${branch}"`, {
          cwd: repoPath,
          stdio: 'pipe',
          timeout: 30_000,
        });
      } catch {
        throw new Error(`Failed to create worktree for task ${taskId}: ${err.message}`);
      }
    }

    const info: WorktreeInfo = { taskId, path: wtPath, branch, createdAt: new Date() };
    this.active.set(taskId, info);
    return info;
  }

  async cleanup(taskId: string, repoPath?: string): Promise<void> {
    const info = this.active.get(taskId);
    const wtPath = info?.path ?? join(this.baseDir, taskId);

    if (existsSync(wtPath)) {
      if (repoPath) {
        try {
          execSync(`git worktree remove "${wtPath}" --force`, {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 15_000,
          });
        } catch {
          // Fallback: just remove the directory
          rmSync(wtPath, { recursive: true, force: true });
        }
      } else {
        rmSync(wtPath, { recursive: true, force: true });
      }
    }

    this.active.delete(taskId);
  }

  attach(taskId: string, path: string, branch = `task/${taskId}`): WorktreeInfo {
    const existing = this.active.get(taskId);
    if (existing) return existing;
    const info: WorktreeInfo = { taskId, path, branch, createdAt: new Date() };
    this.active.set(taskId, info);
    return info;
  }

  async cleanupStale(maxAgeMs: number): Promise<string[]> {
    const now = Date.now();
    const cleaned: string[] = [];

    for (const [taskId, info] of this.active) {
      if (now - info.createdAt.getTime() > maxAgeMs) {
        await this.cleanup(taskId);
        cleaned.push(taskId);
      }
    }

    return cleaned;
  }

  getInfo(taskId: string): WorktreeInfo | undefined {
    return this.active.get(taskId);
  }

  listActive(): WorktreeInfo[] {
    return [...this.active.values()];
  }

  get size(): number {
    return this.active.size;
  }
}

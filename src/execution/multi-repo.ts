/**
 * Multi-repo coordination for cross-repository task workflows.
 *
 * Manages cloning, worktree setup, and coordination across multiple
 * repositories for tasks that span organizational boundaries.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorktreeManager } from './worktree-manager.js';

export interface RepoConfig {
  url: string;
  name: string;
  defaultBranch: string;
  localPath?: string;
}

export interface MultiRepoWorkspace {
  id: string;
  repos: Map<string, RepoConfig & { localPath: string }>;
  createdAt: Date;
}

export class MultiRepoCoordinator {
  private workspaces = new Map<string, MultiRepoWorkspace>();

  constructor(
    private baseDir: string,
    private worktreeManager: WorktreeManager,
  ) {
    mkdirSync(baseDir, { recursive: true });
  }

  /**
   * Set up a workspace with multiple repositories.
   * Clones repos that aren't already local and creates worktrees per task.
   */
  async setupWorkspace(workspaceId: string, repos: RepoConfig[]): Promise<MultiRepoWorkspace> {
    const repoMap = new Map<string, RepoConfig & { localPath: string }>();

    for (const repo of repos) {
      const localPath = repo.localPath ?? join(this.baseDir, 'repos', repo.name);

      if (!existsSync(localPath)) {
        mkdirSync(join(this.baseDir, 'repos'), { recursive: true });
        try {
          execSync(`git clone "${repo.url}" "${localPath}" --depth 1`, {
            stdio: 'pipe',
            timeout: 120_000,
          });
        } catch (err: any) {
          throw new Error(`Failed to clone ${repo.url}: ${err.message}`);
        }
      }

      repoMap.set(repo.name, { ...repo, localPath });
    }

    const workspace: MultiRepoWorkspace = {
      id: workspaceId,
      repos: repoMap,
      createdAt: new Date(),
    };

    this.workspaces.set(workspaceId, workspace);
    return workspace;
  }

  /**
   * Create worktrees for a task across all repos in a workspace.
   */
  async createWorktrees(workspaceId: string, taskId: string): Promise<Map<string, string>> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    const worktrees = new Map<string, string>();

    for (const [name, repo] of workspace.repos) {
      const wt = await this.worktreeManager.checkout(
        `${taskId}-${name}`,
        repo.localPath,
        repo.defaultBranch,
      );
      worktrees.set(name, wt.path);
    }

    return worktrees;
  }

  /**
   * Clean up worktrees for a task across all repos.
   */
  async cleanupWorktrees(workspaceId: string, taskId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    for (const [name, repo] of workspace.repos) {
      await this.worktreeManager.cleanup(`${taskId}-${name}`, repo.localPath);
    }
  }

  getWorkspace(id: string): MultiRepoWorkspace | undefined {
    return this.workspaces.get(id);
  }

  listWorkspaces(): MultiRepoWorkspace[] {
    return [...this.workspaces.values()];
  }

  async destroyWorkspace(id: string): Promise<void> {
    this.workspaces.delete(id);
  }
}

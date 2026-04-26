import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export interface ArtifactInfo {
  taskId: string;
  type: 'diff' | 'file' | 'log' | 'screenshot';
  path: string;
  description: string;
  capturedAt: Date;
}

export class ArtifactCollector {
  constructor(private storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
  }

  captureDiff(taskId: string, workingDir: string): ArtifactInfo | null {
    try {
      const diff = execSync('git diff', { cwd: workingDir, encoding: 'utf-8', timeout: 10_000 });
      if (!diff.trim()) return null;

      const path = this.artifactPath(taskId, 'diff', 'changes.diff');
      this.writeArtifact(path, diff);

      return { taskId, type: 'diff', path, description: 'Git diff of changes', capturedAt: new Date() };
    } catch {
      return null;
    }
  }

  captureStagedDiff(taskId: string, workingDir: string): ArtifactInfo | null {
    try {
      const diff = execSync('git diff --cached', { cwd: workingDir, encoding: 'utf-8', timeout: 10_000 });
      if (!diff.trim()) return null;

      const path = this.artifactPath(taskId, 'diff', 'staged.diff');
      this.writeArtifact(path, diff);

      return { taskId, type: 'diff', path, description: 'Staged changes', capturedAt: new Date() };
    } catch {
      return null;
    }
  }

  captureLog(taskId: string, content: string, name = 'output.log'): ArtifactInfo {
    const path = this.artifactPath(taskId, 'log', name);
    this.writeArtifact(path, content);
    return { taskId, type: 'log', path, description: `Log: ${name}`, capturedAt: new Date() };
  }

  captureFile(taskId: string, sourcePath: string, description: string): ArtifactInfo {
    const content = readFileSync(sourcePath, 'utf-8');
    const name = sourcePath.split(/[/\\]/).pop() ?? 'file';
    const path = this.artifactPath(taskId, 'file', name);
    this.writeArtifact(path, content);
    return { taskId, type: 'file', path, description, capturedAt: new Date() };
  }

  getArtifacts(taskId: string): string {
    const dir = join(this.storageDir, taskId);
    if (!existsSync(dir)) return '';
    try {
      return execSync(`dir /s /b "${dir}"`, { encoding: 'utf-8', timeout: 5_000 }).trim();
    } catch {
      return '';
    }
  }

  private artifactPath(taskId: string, type: string, name: string): string {
    return join(this.storageDir, taskId, type, name);
  }

  private writeArtifact(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
  }
}

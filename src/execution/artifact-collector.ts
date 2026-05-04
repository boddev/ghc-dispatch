import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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

  captureMarkdownFiles(taskId: string, workingDir: string, limit = 50): ArtifactInfo[] {
    const files = this.findChangedMarkdownFiles(workingDir).slice(0, limit);
    return files.map(file => {
      const content = readFileSync(file, 'utf-8');
      const rel = relative(workingDir, file).replace(/[:*?"<>|]/g, '_');
      const path = this.artifactPath(taskId, 'file', join('markdown', rel));
      this.writeArtifact(path, content);
      return {
        taskId,
        type: 'file' as const,
        path,
        description: `Markdown document: ${rel}`,
        capturedAt: new Date(),
      };
    });
  }

  getArtifacts(taskId: string): string {
    const dir = join(this.storageDir, taskId);
    if (!existsSync(dir)) return '';
    try {
      return (readdirSync(dir, { recursive: true }) as string[])
        .map(entry => join(dir, entry))
        .join('\n');
    } catch {
      return '';
    }
  }

  deleteArtifacts(taskId: string): boolean {
    const dir = join(this.storageDir, taskId);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  private artifactPath(taskId: string, type: string, name: string): string {
    return join(this.storageDir, taskId, type, name);
  }

  private writeArtifact(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
  }

  private findChangedMarkdownFiles(workingDir: string): string[] {
    try {
      const output = execSync('git ls-files --modified --others --exclude-standard -- "*.md" "*.markdown"', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      return output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(file => join(workingDir, file))
        .filter(path => existsSync(path));
    } catch {
      return this.findMarkdownFilesRecursive(workingDir);
    }
  }

  private findMarkdownFilesRecursive(dir: string, limit = 50): string[] {
    const results: string[] = [];
    const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage']);
    const visit = (current: string) => {
      if (results.length >= limit) return;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (results.length >= limit) return;
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) visit(path);
        } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
          try {
            if (statSync(path).size <= 2_000_000) results.push(path);
          } catch {
            // Ignore files that disappear while scanning.
          }
        }
      }
    };
    visit(dir);
    return results;
  }
}

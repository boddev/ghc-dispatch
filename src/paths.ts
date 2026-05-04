import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const DATA_DIR = join(homedir(), '.ghc-dispatch');

export const paths = {
  dataDir: DATA_DIR,
  dbPath: join(DATA_DIR, 'orchestrator.db'),
  agentsDir: join(DATA_DIR, 'agents'),
  skillsDir: join(DATA_DIR, 'skills'),
  worktreesDir: join(DATA_DIR, 'worktrees'),
  artifactsDir: join(DATA_DIR, 'artifacts'),
  wikiDir: join(DATA_DIR, 'wiki'),
  logsDir: join(DATA_DIR, 'logs'),
  taskRuntimeConfigPath: join(DATA_DIR, 'task-runtime.json'),
  executionSettingsPath: join(DATA_DIR, 'execution-settings.json'),
} as const;

export function ensureDataDirs(): void {
  for (const dir of [
    paths.dataDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.worktreesDir,
    paths.artifactsDir,
    paths.wikiDir,
    paths.logsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

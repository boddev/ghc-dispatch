import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const DATA_DIR = join(homedir(), '.ghc-orchestrator');

export const paths = {
  dataDir: DATA_DIR,
  dbPath: join(DATA_DIR, 'orchestrator.db'),
  agentsDir: join(DATA_DIR, 'agents'),
  worktreesDir: join(DATA_DIR, 'worktrees'),
  wikiDir: join(DATA_DIR, 'wiki'),
  logsDir: join(DATA_DIR, 'logs'),
} as const;

export function ensureDataDirs(): void {
  for (const dir of [paths.dataDir, paths.agentsDir, paths.worktreesDir, paths.wikiDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

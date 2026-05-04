/**
 * Self-Management: Update + Restart
 *
 * - update: pulls latest version from npm or git, rebuilds
 * - restart: spawns a replacement daemon process, then exits cleanly
 */

import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';

export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  method: 'npm' | 'git';
  output: string;
}

/**
 * Check for updates and install the latest version.
 * Tries npm update first (for globally installed), falls back to git pull + rebuild.
 */
export function selfUpdate(projectRoot: string): UpdateResult {
  const currentVersion = getCurrentVersion(projectRoot);

  // Try npm update first
  try {
    const output = execSync('npm update -g ghc-dispatch 2>&1', {
      encoding: 'utf-8', timeout: 120_000,
    });
    const newVersion = getCurrentVersion(projectRoot);
    return { success: true, previousVersion: currentVersion, newVersion, method: 'npm', output: output.trim() };
  } catch {}

  // Fallback: git pull + npm install + npm run build
  try {
    const cmds = [
      'git pull --ff-only',
      'npm install --production=false',
      'npm run build',
    ];
    const output = cmds.map(cmd => {
      try {
        return `$ ${cmd}\n${execSync(cmd, { cwd: projectRoot, encoding: 'utf-8', timeout: 120_000 })}`;
      } catch (err: any) {
        return `$ ${cmd}\nERROR: ${err.message}`;
      }
    }).join('\n');

    const newVersion = getCurrentVersion(projectRoot);
    return { success: true, previousVersion: currentVersion, newVersion, method: 'git', output: output.trim() };
  } catch (err: any) {
    return { success: false, previousVersion: currentVersion, newVersion: currentVersion, method: 'git', output: err.message };
  }
}

/**
 * Restart the daemon by spawning a replacement process and exiting.
 * The new process inherits stdio and is detached so it survives the parent's exit.
 */
export function selfRestart(projectRoot: string): void {
  console.log('🔄 Restarting dispatch daemon...');

  // Determine the startup command
  const entryScript = join(projectRoot, 'dist', 'daemon.js');
  const args = ['--import', 'tsx', join(projectRoot, 'src', 'daemon.ts')];

  // Try tsx first (dev mode), fall back to node (production)
  let cmd: string;
  let cmdArgs: string[];

  try {
    execSync('npx tsx --version', { stdio: 'pipe', timeout: 5000 });
    cmd = 'npx';
    cmdArgs = ['tsx', join(projectRoot, 'src', 'daemon.ts')];
  } catch {
    cmd = 'node';
    cmdArgs = [entryScript];
  }

  // Spawn detached replacement
  const child = spawn(cmd, cmdArgs, {
    cwd: projectRoot,
    detached: true,
    stdio: 'inherit',
    env: { ...process.env },
  });

  child.unref();

  console.log(`   New process PID: ${child.pid}`);
  console.log('   Exiting current process...');

  // Give a moment for output, then exit
  setTimeout(() => process.exit(0), 500);
}

function getCurrentVersion(projectRoot: string): string {
  try {
    const pkg = JSON.parse(
      execSync(`node -e "process.stdout.write(require('./package.json').version)"`, {
        cwd: projectRoot, encoding: 'utf-8', timeout: 5000,
      })
    );
    return pkg;
  } catch {
    try {
      const { readFileSync } = require('node:fs');
      const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}

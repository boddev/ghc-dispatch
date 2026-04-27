/**
 * Hot Reload Watcher
 *
 * Watches skill and agent directories for changes and reloads them
 * without restarting the daemon. Uses Node.js fs.watch for efficiency.
 */

import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentLoader } from '../execution/agent-loader.js';
import type { SkillManager } from '../skills/skill-manager.js';

export interface HotReloadConfig {
  /** Debounce interval (ms) — avoid rapid reloads on burst writes */
  debounceMs: number;
  /** Whether to watch agents directory */
  watchAgents: boolean;
  /** Whether to watch skills directory */
  watchSkills: boolean;
}

const DEFAULT_CONFIG: HotReloadConfig = {
  debounceMs: 1000,
  watchAgents: true,
  watchSkills: true,
};

export class HotReloader {
  private watchers: FSWatcher[] = [];
  private config: HotReloadConfig;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reloadCount = 0;
  private lastReload: Date | null = null;
  private onReloadHandlers: Array<(type: string, path: string) => void> = [];

  constructor(
    private agentLoader: AgentLoader,
    private skillManager: SkillManager,
    private watchDirs: string[],
    config?: Partial<HotReloadConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a callback for reload events */
  onReload(handler: (type: string, path: string) => void): void {
    this.onReloadHandlers.push(handler);
  }

  /** Start watching directories for changes */
  start(): void {
    for (const dir of this.watchDirs) {
      if (!existsSync(dir)) continue;

      try {
        const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const fullPath = join(dir, filename);
          this.handleChange(dir, fullPath, filename);
        });

        this.watchers.push(watcher);
      } catch {
        // fs.watch may not support recursive on all platforms
      }
    }

    if (this.watchers.length > 0) {
      console.log(`   Hot reload: watching ${this.watchers.length} director${this.watchers.length === 1 ? 'y' : 'ies'}`);
    }
  }

  /** Stop watching */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** Force a reload of all agents and skills */
  reloadAll(): { agents: number; skills: number } {
    this.agentLoader.reload();
    this.skillManager.syncFilesystem();
    this.reloadCount++;
    this.lastReload = new Date();

    const agents = this.agentLoader.list().length;
    const skills = this.skillManager.listAll().length;

    for (const handler of this.onReloadHandlers) {
      try { handler('all', '*'); } catch {}
    }

    return { agents, skills };
  }

  /** Get reload stats */
  getStats(): { reloadCount: number; lastReload: string | null; watchedDirs: number } {
    return {
      reloadCount: this.reloadCount,
      lastReload: this.lastReload?.toISOString() ?? null,
      watchedDirs: this.watchers.length,
    };
  }

  private handleChange(baseDir: string, fullPath: string, filename: string): void {
    // Debounce — multiple file system events fire for a single save
    const existing = this.debounceTimers.get(fullPath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(fullPath, setTimeout(() => {
      this.debounceTimers.delete(fullPath);

      if (filename.endsWith('.agent.md')) {
        if (this.config.watchAgents) {
          this.agentLoader.reload();
          this.reloadCount++;
          this.lastReload = new Date();
          console.log(`🔄 Hot reload: agents reloaded (${filename})`);
          this.notifyHandlers('agent', fullPath);
        }
      } else if (filename.includes('SKILL.md') || filename.endsWith('.md')) {
        if (this.config.watchSkills) {
          this.skillManager.syncFilesystem();
          this.reloadCount++;
          this.lastReload = new Date();
          console.log(`🔄 Hot reload: skills reloaded (${filename})`);
          this.notifyHandlers('skill', fullPath);
        }
      }
    }, this.config.debounceMs));
  }

  private notifyHandlers(type: string, path: string): void {
    for (const handler of this.onReloadHandlers) {
      try { handler(type, path); } catch {}
    }
  }
}

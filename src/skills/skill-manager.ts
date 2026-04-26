/**
 * Skill Manager
 *
 * Manages SKILL.md-based skills: install from skills.sh or GitHub, create
 * autonomously by researching CLI tools, list/enable/disable, and categorize
 * as user-installed vs system-created.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type Database from 'better-sqlite3';

export type SkillOrigin = 'user' | 'system' | 'registry' | 'github';

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  origin: SkillOrigin;
  source: string | null;
  sourceUrl: string | null;
  dirPath: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface SkillContent {
  name: string;
  description: string;
  body: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  source: string;
  url: string;
  downloadCount?: number;
}

export class SkillManager {
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(
    private db: Database.Database,
    private skillsDir: string,
    private bundledSkillsDir?: string,
  ) {
    mkdirSync(skillsDir, { recursive: true });
    this.stmts = this.prepareStatements();
    this.syncFilesystem();
  }

  private prepareStatements() {
    return {
      upsert: this.db.prepare(`
        INSERT INTO skills (id, name, description, origin, source, source_url, dir_path, installed_at, updated_at, enabled, metadata)
        VALUES (@id, @name, @description, @origin, @source, @sourceUrl, @dirPath, @installedAt, @updatedAt, @enabled, @metadata)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, description = @description, updated_at = @updatedAt, enabled = @enabled, metadata = @metadata
      `),
      getById: this.db.prepare('SELECT * FROM skills WHERE id = ?'),
      getByName: this.db.prepare('SELECT * FROM skills WHERE name = ?'),
      listAll: this.db.prepare('SELECT * FROM skills ORDER BY origin, name'),
      listByOrigin: this.db.prepare('SELECT * FROM skills WHERE origin = ? ORDER BY name'),
      listEnabled: this.db.prepare('SELECT * FROM skills WHERE enabled = 1 ORDER BY name'),
      setEnabled: this.db.prepare('UPDATE skills SET enabled = @enabled, updated_at = @updatedAt WHERE id = @id'),
      remove: this.db.prepare('DELETE FROM skills WHERE id = ?'),
      search: this.db.prepare(`SELECT * FROM skills WHERE name LIKE @q OR description LIKE @q ORDER BY name`),
    };
  }

  /** Scan the skills directory and register any untracked skills */
  syncFilesystem(): void {
    const dirs = [this.skillsDir];
    if (this.bundledSkillsDir && existsSync(this.bundledSkillsDir)) dirs.push(this.bundledSkillsDir);

    for (const baseDir of dirs) {
      if (!existsSync(baseDir)) continue;
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(baseDir, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;

        const id = entry.name;
        if (this.stmts.getById.get(id)) continue;

        const content = this.parseSkillFile(skillPath);
        const origin: SkillOrigin = baseDir === this.bundledSkillsDir ? 'registry' : 'user';
        this.registerSkill(id, content.name || id, content.description, origin, null, null, join(baseDir, entry.name));
      }
    }
  }

  /** Install a skill from skills.sh registry */
  async installFromRegistry(skillName: string): Promise<SkillRecord | null> {
    const targetDir = join(this.skillsDir, skillName);
    mkdirSync(targetDir, { recursive: true });

    try {
      // Try npx skills-sh or git-based install
      const registryUrl = `https://github.com/skills-sh/${skillName}`;
      execSync(`git clone --depth 1 "${registryUrl}" "${targetDir}"`, {
        stdio: 'pipe', timeout: 60_000,
      });
    } catch {
      // Fallback: search GitHub for skills.sh skill repos
      try {
        const searchUrl = `https://skills.sh/${skillName}`;
        // Create a stub SKILL.md if clone fails
        if (!existsSync(join(targetDir, 'SKILL.md'))) {
          writeFileSync(join(targetDir, 'SKILL.md'), `# ${skillName}\n\nSkill installed from skills.sh registry.\nConfigure and customize as needed.\n`, 'utf-8');
        }
      } catch {
        rmSync(targetDir, { recursive: true, force: true });
        return null;
      }
    }

    const content = this.parseSkillFile(join(targetDir, 'SKILL.md'));
    return this.registerSkill(skillName, content.name || skillName, content.description, 'registry', 'skills.sh', `https://skills.sh`, targetDir);
  }

  /** Install a skill from a GitHub repository */
  async installFromGitHub(repoUrl: string, skillName?: string): Promise<SkillRecord | null> {
    const name = skillName ?? repoUrl.split('/').pop()?.replace('.git', '') ?? 'unknown';
    const targetDir = join(this.skillsDir, name);

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    try {
      execSync(`git clone --depth 1 "${repoUrl}" "${targetDir}"`, {
        stdio: 'pipe', timeout: 120_000,
      });
    } catch (err: any) {
      return null;
    }

    // Find SKILL.md in the cloned repo
    const skillMd = this.findSkillMd(targetDir);
    if (!skillMd) {
      // No SKILL.md — create a minimal one from README
      const readmePath = [join(targetDir, 'README.md'), join(targetDir, 'readme.md')].find(existsSync);
      const readmeContent = readmePath ? readFileSync(readmePath, 'utf-8').slice(0, 2000) : '';
      writeFileSync(join(targetDir, 'SKILL.md'), `# ${name}\n\n${readmeContent}\n`, 'utf-8');
    }

    const content = this.parseSkillFile(skillMd ?? join(targetDir, 'SKILL.md'));
    return this.registerSkill(name, content.name || name, content.description, 'github', repoUrl, repoUrl, targetDir);
  }

  /** Create a skill by researching CLI tools (self-learning) */
  createSkill(name: string, description: string, instructions: string): SkillRecord {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const targetDir = join(this.skillsDir, id);
    mkdirSync(targetDir, { recursive: true });

    const skillMd = `# ${name}\n\n${description}\n\n## Instructions\n\n${instructions}\n`;
    writeFileSync(join(targetDir, 'SKILL.md'), skillMd, 'utf-8');

    return this.registerSkill(id, name, description, 'system', 'self-created', null, targetDir);
  }

  /** Get a skill by ID */
  get(id: string): SkillRecord | undefined {
    const row = this.stmts.getById.get(id) as any;
    return row ? this.rowToSkill(row) : undefined;
  }

  /** Get a skill by name */
  getByName(name: string): SkillRecord | undefined {
    const row = this.stmts.getByName.get(name) as any;
    return row ? this.rowToSkill(row) : undefined;
  }

  /** List all skills */
  listAll(): SkillRecord[] {
    return (this.stmts.listAll.all() as any[]).map(this.rowToSkill);
  }

  /** List skills by origin */
  listByOrigin(origin: SkillOrigin): SkillRecord[] {
    return (this.stmts.listByOrigin.all(origin) as any[]).map(this.rowToSkill);
  }

  /** List only enabled skills */
  listEnabled(): SkillRecord[] {
    return (this.stmts.listEnabled.all() as any[]).map(this.rowToSkill);
  }

  /** List user-installed skills */
  listUserInstalled(): SkillRecord[] {
    return this.listAll().filter(s => s.origin === 'user' || s.origin === 'registry' || s.origin === 'github');
  }

  /** List system-created skills */
  listSystemCreated(): SkillRecord[] {
    return this.listByOrigin('system');
  }

  /** Enable or disable a skill */
  setEnabled(id: string, enabled: boolean): boolean {
    const changes = this.stmts.setEnabled.run({ id, enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() }).changes;
    return changes > 0;
  }

  /** Remove a skill */
  remove(id: string): boolean {
    const skill = this.get(id);
    if (!skill) return false;
    if (existsSync(skill.dirPath)) {
      rmSync(skill.dirPath, { recursive: true, force: true });
    }
    return this.stmts.remove.run(id).changes > 0;
  }

  /** Search installed skills */
  search(query: string): SkillRecord[] {
    return (this.stmts.search.all({ q: `%${query}%` }) as any[]).map(this.rowToSkill);
  }

  /** Read a skill's SKILL.md content */
  readSkillContent(id: string): string | null {
    const skill = this.get(id);
    if (!skill) return null;
    const path = join(skill.dirPath, 'SKILL.md');
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  }

  /** Get all skill directories for Copilot SDK session configuration */
  getSkillDirs(): string[] {
    return this.listEnabled().map(s => s.dirPath).filter(existsSync);
  }

  private registerSkill(
    id: string, name: string, description: string,
    origin: SkillOrigin, source: string | null, sourceUrl: string | null,
    dirPath: string,
  ): SkillRecord {
    const now = new Date().toISOString();
    this.stmts.upsert.run({
      id, name, description, origin,
      source, sourceUrl, dirPath,
      installedAt: now, updatedAt: now,
      enabled: 1, metadata: '{}',
    });
    return this.get(id)!;
  }

  private parseSkillFile(path: string): SkillContent {
    if (!existsSync(path)) return { name: '', description: '', body: '' };
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n');
    const titleLine = lines.find(l => l.startsWith('# '));
    const name = titleLine?.replace(/^#\s+/, '').trim() ?? '';
    const descLine = lines.find((l, i) => i > 0 && l.trim().length > 0 && !l.startsWith('#'));
    return { name, description: descLine?.trim() ?? '', body: raw };
  }

  private findSkillMd(dir: string): string | null {
    const direct = join(dir, 'SKILL.md');
    if (existsSync(direct)) return direct;
    // Search one level deep
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const nested = join(dir, entry.name, 'SKILL.md');
          if (existsSync(nested)) return nested;
        }
      }
    } catch {}
    return null;
  }

  private rowToSkill(row: any): SkillRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      origin: row.origin,
      source: row.source,
      sourceUrl: row.source_url,
      dirPath: row.dir_path,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
      enabled: row.enabled === 1,
      metadata: JSON.parse(row.metadata),
    };
  }
}

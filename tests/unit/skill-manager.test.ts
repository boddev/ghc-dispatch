import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager } from '../../src/skills/skill-manager.js';
import { createTestDb } from '../../src/store/db.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';

describe('SkillManager', () => {
  let sm: SkillManager;
  let db: Database.Database;
  let tmpDir: string;
  let bundledDir: string;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'skills-test-'));
    bundledDir = join(tmpDir, 'bundled');
    mkdirSync(bundledDir);

    // Create a bundled skill
    const bundledSkill = join(bundledDir, 'git-helper');
    mkdirSync(bundledSkill);
    writeFileSync(join(bundledSkill, 'SKILL.md'), '# Git Helper\n\nHelps with git operations.\n\n## Usage\nUse git commands.\n');

    sm = new SkillManager(db, join(tmpDir, 'user-skills'), bundledDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('filesystem sync', () => {
    it('discovers bundled skills on construction', () => {
      const skills = sm.listAll();
      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('Git Helper');
      expect(skills[0].origin).toBe('registry');
    });

    it('discovers user-created skills', () => {
      const userSkill = join(tmpDir, 'user-skills', 'my-tool');
      mkdirSync(userSkill, { recursive: true });
      writeFileSync(join(userSkill, 'SKILL.md'), '# My Tool\n\nDoes things.\n');

      sm.syncFilesystem();
      const skills = sm.listAll();
      expect(skills.length).toBe(2);
      expect(skills.some(s => s.name === 'My Tool' && s.origin === 'user')).toBe(true);
    });
  });

  describe('create skill', () => {
    it('creates a system skill with SKILL.md', () => {
      const skill = sm.createSkill('Docker Helper', 'Manages Docker containers', 'Use docker commands to manage containers.');
      expect(skill.id).toBe('docker-helper');
      expect(skill.name).toBe('Docker Helper');
      expect(skill.origin).toBe('system');
      expect(skill.enabled).toBe(true);

      const content = sm.readSkillContent(skill.id);
      expect(content).toContain('Docker Helper');
      expect(content).toContain('docker commands');
    });

    it('separates user-installed from system-created', () => {
      sm.createSkill('Auto Skill', 'Created by the system', 'Do things.');

      const system = sm.listSystemCreated();
      expect(system.length).toBe(1);
      expect(system[0].name).toBe('Auto Skill');

      const user = sm.listUserInstalled();
      expect(user.length).toBe(1); // bundled registry skill
      expect(user[0].origin).toBe('registry');
    });
  });

  describe('enable/disable', () => {
    it('disables and re-enables a skill', () => {
      const skill = sm.createSkill('Toggleable', 'Test', 'Content');
      expect(skill.enabled).toBe(true);

      sm.setEnabled(skill.id, false);
      expect(sm.get(skill.id)!.enabled).toBe(false);

      sm.setEnabled(skill.id, true);
      expect(sm.get(skill.id)!.enabled).toBe(true);
    });

    it('lists only enabled skills', () => {
      const s1 = sm.createSkill('Enabled', 'Test', 'Content');
      const s2 = sm.createSkill('Disabled', 'Test', 'Content');
      sm.setEnabled(s2.id, false);

      const enabled = sm.listEnabled();
      expect(enabled.some(s => s.id === s1.id)).toBe(true);
      expect(enabled.some(s => s.id === s2.id)).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes a skill and its directory', () => {
      const skill = sm.createSkill('Removable', 'Test', 'Content');
      expect(sm.get(skill.id)).toBeDefined();

      sm.remove(skill.id);
      expect(sm.get(skill.id)).toBeUndefined();
    });
  });

  describe('search', () => {
    it('searches by name and description', () => {
      sm.createSkill('Kubernetes Manager', 'Manages k8s clusters', 'kubectl commands');
      sm.createSkill('Docker Compose', 'Docker orchestration', 'docker-compose up');

      const results = sm.search('kubernetes');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Kubernetes Manager');

      const docker = sm.search('docker');
      expect(docker.length).toBe(1);
    });
  });

  describe('getSkillDirs', () => {
    it('returns directories of enabled skills', () => {
      sm.createSkill('Active', 'Test', 'Content');
      const disabled = sm.createSkill('Inactive', 'Test', 'Content');
      sm.setEnabled(disabled.id, false);

      const dirs = sm.getSkillDirs();
      expect(dirs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('get by name', () => {
    it('finds skill by display name', () => {
      sm.createSkill('Special Skill', 'Unique', 'Instructions');
      const found = sm.getByName('Special Skill');
      expect(found).toBeDefined();
      expect(found!.description).toBe('Unique');
    });
  });
});

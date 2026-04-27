import { describe, it, expect, beforeEach } from 'vitest';
import { ModelManager } from '../../src/execution/model-manager.js';
import { createTestDb } from '../../src/store/db.js';

describe('ModelManager', () => {
  let mm: ModelManager;

  beforeEach(() => {
    const db = createTestDb();
    // createTestDb doesn't have model_config table, so use in-memory mode
    mm = new ModelManager('claude-sonnet-4.6');
  });

  describe('default model', () => {
    it('returns the initial default', () => {
      expect(mm.getDefault()).toBe('claude-sonnet-4.6');
    });

    it('switches the default model', () => {
      mm.setDefault('gpt-5.4');
      expect(mm.getDefault()).toBe('gpt-5.4');
    });
  });

  describe('agent overrides', () => {
    it('sets and gets agent model override', () => {
      mm.setAgentModel('@coder', 'gpt-5.5');
      expect(mm.getAgentOverride('@coder')).toBe('gpt-5.5');
    });

    it('clears an agent override', () => {
      mm.setAgentModel('@coder', 'gpt-5.5');
      mm.clearAgentModel('@coder');
      expect(mm.getAgentOverride('@coder')).toBeUndefined();
    });

    it('lists all agent overrides', () => {
      mm.setAgentModel('@coder', 'gpt-5.4');
      mm.setAgentModel('@designer', 'claude-opus-4.7');
      const overrides = mm.getAgentOverrides();
      expect(overrides['@coder']).toBe('gpt-5.4');
      expect(overrides['@designer']).toBe('claude-opus-4.7');
    });

    it('normalizes agent names without @', () => {
      mm.setAgentModel('coder', 'gpt-5.4');
      expect(mm.getAgentOverride('@coder')).toBe('gpt-5.4');
    });
  });

  describe('resolveModel', () => {
    it('uses per-task model (highest priority)', () => {
      mm.setDefault('claude-sonnet-4.6');
      mm.setAgentModel('@coder', 'gpt-5.4');
      expect(mm.resolveModel('gpt-5.5', '@coder', 'gpt-5.4')).toBe('gpt-5.5');
    });

    it('uses agent runtime override (second priority)', () => {
      mm.setDefault('claude-sonnet-4.6');
      mm.setAgentModel('@coder', 'gpt-5.5');
      expect(mm.resolveModel(undefined, '@coder', 'gpt-5.4')).toBe('gpt-5.5');
    });

    it('uses agent definition model (third priority)', () => {
      mm.setDefault('claude-sonnet-4.6');
      expect(mm.resolveModel(undefined, '@coder', 'gpt-5.4')).toBe('gpt-5.4');
    });

    it('uses global default (lowest priority)', () => {
      mm.setDefault('claude-sonnet-4.6');
      expect(mm.resolveModel(undefined, '@coder', 'auto')).toBe('claude-sonnet-4.6');
    });

    it('treats "auto" as passthrough to next level', () => {
      mm.setDefault('claude-sonnet-4.6');
      expect(mm.resolveModel('auto', '@coder', 'auto')).toBe('claude-sonnet-4.6');
    });
  });

  describe('model listing', () => {
    it('lists available models', () => {
      const models = mm.listModels();
      expect(models.length).toBeGreaterThan(10);
      expect(models.some(m => m.id === 'claude-sonnet-4.6')).toBe(true);
      expect(models.some(m => m.id === 'gpt-5.4')).toBe(true);
    });

    it('finds a model by exact ID', () => {
      const model = mm.findModel('gpt-5.4');
      expect(model).toBeDefined();
      expect(model!.name).toBe('GPT-5.4');
      expect(model!.provider).toBe('OpenAI');
    });

    it('finds a model by partial name', () => {
      const model = mm.findModel('opus 4.7');
      expect(model).toBeDefined();
      expect(model!.id).toBe('claude-opus-4.7');
    });

    it('returns undefined for unknown model', () => {
      expect(mm.findModel('llama-99')).toBeUndefined();
    });

    it('validates model IDs', () => {
      expect(mm.isValidModel('gpt-5.4')).toBe(true);
      expect(mm.isValidModel('nonexistent')).toBe(false);
    });
  });

  describe('status', () => {
    it('returns current state', () => {
      mm.setAgentModel('@coder', 'gpt-5.5');
      const status = mm.getStatus();
      expect(status.defaultModel).toBe('claude-sonnet-4.6');
      expect(status.agentOverrides['@coder']).toBe('gpt-5.5');
      expect(status.availableModels).toBeGreaterThan(10);
    });
  });

  describe('persistence', () => {
    it('persists and reloads default model', () => {
      const db = createTestDb();
      db.exec('CREATE TABLE IF NOT EXISTS model_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
      const mm1 = new ModelManager('claude-sonnet-4.6', db);
      mm1.setDefault('gpt-5.5');

      const mm2 = new ModelManager('claude-sonnet-4.6', db);
      expect(mm2.getDefault()).toBe('gpt-5.5');
    });

    it('persists and reloads agent overrides', () => {
      const db = createTestDb();
      db.exec('CREATE TABLE IF NOT EXISTS model_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
      const mm1 = new ModelManager('claude-sonnet-4.6', db);
      mm1.setAgentModel('@coder', 'gpt-5.4');

      const mm2 = new ModelManager('claude-sonnet-4.6', db);
      expect(mm2.getAgentOverride('@coder')).toBe('gpt-5.4');
    });
  });
});

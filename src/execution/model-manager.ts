/**
 * Model Manager
 *
 * Manages runtime model selection for dispatch. Supports:
 * - Global default model (persisted)
 * - Per-agent model (from .agent.md)
 * - Per-task model override (from task creation)
 * - Runtime switching via API/CLI/Discord (/model command)
 * - Available model listing
 */

import type Database from 'better-sqlite3';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: 'free' | 'standard' | 'premium';
}

// Known models in the Copilot ecosystem (April 2026)
const KNOWN_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', tier: 'standard' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic', tier: 'standard' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', tier: 'standard' },
  { id: 'claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'Anthropic', tier: 'premium' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'Anthropic', tier: 'premium' },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'Anthropic', tier: 'premium' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic', tier: 'free' },
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'OpenAI', tier: 'premium' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'OpenAI', tier: 'standard' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'OpenAI', tier: 'free' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'OpenAI', tier: 'standard' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', provider: 'OpenAI', tier: 'standard' },
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'OpenAI', tier: 'standard' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'OpenAI', tier: 'free' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', tier: 'free' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google', tier: 'standard' },
];

export class ModelManager {
  private defaultModel: string;
  private agentOverrides = new Map<string, string>();
  private stmts: ReturnType<typeof this.prepareStatements> | null = null;

  constructor(initialDefault: string, private db?: Database.Database) {
    this.defaultModel = initialDefault;
    if (db) {
      this.ensureTable();
      this.stmts = this.prepareStatements();
      this.loadPersistedState();
    }
  }

  private ensureTable() {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS model_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private prepareStatements() {
    return {
      get: this.db!.prepare('SELECT value FROM model_config WHERE key = ?'),
      set: this.db!.prepare(`
        INSERT INTO model_config (key, value, updated_at) VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updatedAt
      `),
      getAll: this.db!.prepare('SELECT key, value FROM model_config'),
    };
  }

  private loadPersistedState() {
    const defaultRow = this.stmts!.get.get('default_model') as { value: string } | undefined;
    if (defaultRow) this.defaultModel = defaultRow.value;

    const rows = this.stmts!.getAll.all() as { key: string; value: string }[];
    for (const row of rows) {
      if (row.key.startsWith('agent:')) {
        this.agentOverrides.set(row.key.slice(6), row.value);
      }
    }
  }

  /** Get the current default model */
  getDefault(): string {
    return this.defaultModel;
  }

  /** Set the default model (persisted across restarts) */
  setDefault(model: string): void {
    this.defaultModel = model;
    this.persist('default_model', model);
  }

  /** Set a runtime model override for a specific agent */
  setAgentModel(agentName: string, model: string): void {
    const key = agentName.startsWith('@') ? agentName : `@${agentName}`;
    this.agentOverrides.set(key, model);
    this.persist(`agent:${key}`, model);
  }

  /** Clear a runtime model override for an agent (falls back to .agent.md definition) */
  clearAgentModel(agentName: string): void {
    const key = agentName.startsWith('@') ? agentName : `@${agentName}`;
    this.agentOverrides.delete(key);
    if (this.stmts) {
      this.db!.prepare('DELETE FROM model_config WHERE key = ?').run(`agent:${key}`);
    }
  }

  /** Get the runtime override for an agent, if any */
  getAgentOverride(agentName: string): string | undefined {
    const key = agentName.startsWith('@') ? agentName : `@${agentName}`;
    return this.agentOverrides.get(key);
  }

  /** Get all agent model overrides */
  getAgentOverrides(): Record<string, string> {
    return Object.fromEntries(this.agentOverrides);
  }

  /**
   * Resolve the model for a task execution.
   * Priority: task.metadata.model → agent runtime override → agent.md model → default model
   */
  resolveModel(taskModel?: string, agentName?: string, agentDefinitionModel?: string): string {
    // 1. Explicit per-task model override (highest priority)
    if (taskModel && taskModel !== 'auto') return taskModel;

    // 2. Runtime agent override
    if (agentName) {
      const override = this.getAgentOverride(agentName);
      if (override) return override;
    }

    // 3. Agent definition model (from .agent.md)
    if (agentDefinitionModel && agentDefinitionModel !== 'auto') return agentDefinitionModel;

    // 4. Global default
    return this.defaultModel;
  }

  /** List available models */
  listModels(): ModelInfo[] {
    return [...KNOWN_MODELS];
  }

  /** Find a model by ID or fuzzy name match */
  findModel(query: string): ModelInfo | undefined {
    const lower = query.toLowerCase().trim();
    // Exact ID match
    const exact = KNOWN_MODELS.find(m => m.id === lower);
    if (exact) return exact;
    // Partial match on ID or name
    return KNOWN_MODELS.find(m =>
      m.id.includes(lower) || m.name.toLowerCase().includes(lower)
    );
  }

  /** Check if a model ID is valid */
  isValidModel(modelId: string): boolean {
    return !!this.findModel(modelId);
  }

  /** Get current state for display */
  getStatus(): {
    defaultModel: string;
    agentOverrides: Record<string, string>;
    availableModels: number;
  } {
    return {
      defaultModel: this.defaultModel,
      agentOverrides: this.getAgentOverrides(),
      availableModels: KNOWN_MODELS.length,
    };
  }

  private persist(key: string, value: string): void {
    if (this.stmts) {
      this.stmts.set.run({ key, value, updatedAt: new Date().toISOString() });
    }
  }
}

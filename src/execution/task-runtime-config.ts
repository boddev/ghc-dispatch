import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const TaskRuntimeConfigSchema = z.object({
  mode: z.literal('copilot-cli-autopilot').default('copilot-cli-autopilot'),
  enableConfigDiscovery: z.boolean().default(true),
  useEnabledSkills: z.boolean().default(true),
  disabledSkills: z.array(z.string()).default([]),
  mcpServers: z.record(z.unknown()).default({}),
  disabledMcpServers: z.array(z.string()).default([]),
  availableTools: z.array(z.string()).default([]),
  excludedTools: z.array(z.string()).default([]),
  permissionMode: z.enum(['autopilot', 'deny-blocked']).default('autopilot'),
  infiniteSessions: z.object({
    enabled: z.boolean().optional(),
    backgroundCompactionThreshold: z.number().min(0).max(1).optional(),
    bufferExhaustionThreshold: z.number().min(0).max(1).optional(),
  }).default({ enabled: true }),
}).default({});

export type TaskRuntimeConfig = z.infer<typeof TaskRuntimeConfigSchema>;

export const DEFAULT_TASK_RUNTIME_CONFIG: TaskRuntimeConfig = TaskRuntimeConfigSchema.parse({});

export class TaskRuntimeConfigManager {
  constructor(private configPath: string) {
    this.ensureConfigFile();
  }

  get path(): string {
    return this.configPath;
  }

  get(): TaskRuntimeConfig {
    this.ensureConfigFile();
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      return this.normalize(raw);
    } catch (err) {
      throw new Error(`Failed to read task runtime config at ${this.configPath}: ${err}`);
    }
  }

  update(patch: Partial<TaskRuntimeConfig>): TaskRuntimeConfig {
    const next = this.normalize({ ...this.get(), ...patch });
    this.write(next);
    return next;
  }

  reset(): TaskRuntimeConfig {
    this.write(DEFAULT_TASK_RUNTIME_CONFIG);
    return DEFAULT_TASK_RUNTIME_CONFIG;
  }

  private ensureConfigFile(): void {
    if (existsSync(this.configPath)) return;
    mkdirSync(dirname(this.configPath), { recursive: true });
    this.write(DEFAULT_TASK_RUNTIME_CONFIG);
  }

  private write(config: TaskRuntimeConfig): void {
    writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  }

  private normalize(input: unknown): TaskRuntimeConfig {
    return TaskRuntimeConfigSchema.parse(input);
  }
}

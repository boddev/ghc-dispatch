import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const ExecutionSettingsSchema = z.object({
  maxConcurrentSessions: z.coerce.number().int().min(1).max(16),
  taskSessionIdleTimeoutMs: z.coerce.number().int().min(30_000).max(7_200_000),
});

export type ExecutionSettings = z.infer<typeof ExecutionSettingsSchema>;

export class ExecutionSettingsManager {
  constructor(private settingsPath: string, private defaults: ExecutionSettings) {
    this.ensureSettingsFile();
  }

  get path(): string {
    return this.settingsPath;
  }

  get(): ExecutionSettings {
    this.ensureSettingsFile();
    const raw = JSON.parse(readFileSync(this.settingsPath, 'utf-8'));
    return ExecutionSettingsSchema.parse({ ...this.defaults, ...raw });
  }

  update(patch: Partial<ExecutionSettings>): ExecutionSettings {
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const next = ExecutionSettingsSchema.parse({ ...this.get(), ...definedPatch });
    writeFileSync(this.settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return next;
  }

  private ensureSettingsFile(): void {
    if (existsSync(this.settingsPath)) return;
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, `${JSON.stringify(this.defaults, null, 2)}\n`, 'utf-8');
  }
}

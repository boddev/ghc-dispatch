import { z } from 'zod';

const ConfigSchema = z.object({
  copilotModel: z.string().default('claude-sonnet-4.6'),
  apiPort: z.coerce.number().int().min(1).max(65535).default(7878),
  maxConcurrentSessions: z.coerce.number().int().min(1).max(16).default(4),
  maxRetriesPerTask: z.coerce.number().int().min(0).max(10).default(3),
  retryBackoffMs: z.coerce.number().int().min(100).default(2000),
  worktreeRetentionMinutes: z.coerce.number().int().min(0).default(60),
  logRetentionDays: z.coerce.number().int().min(1).default(30),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    copilotModel: env.COPILOT_MODEL,
    apiPort: env.API_PORT,
    maxConcurrentSessions: env.MAX_CONCURRENT_SESSIONS,
    maxRetriesPerTask: env.MAX_RETRIES_PER_TASK,
    retryBackoffMs: env.RETRY_BACKOFF_MS,
    worktreeRetentionMinutes: env.WORKTREE_RETENTION_MINUTES,
    logRetentionDays: env.LOG_RETENTION_DAYS,
  });
}

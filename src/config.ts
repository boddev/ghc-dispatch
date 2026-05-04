import { z } from 'zod';

const ConfigSchema = z.object({
  copilotModel: z.string().default('claude-sonnet-4.6'),
  copilotDefaultRemote: z
    .union([z.boolean(), z.string()])
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      const s = v.trim().toLowerCase();
      return !(s === '0' || s === 'false' || s === 'no' || s === 'off' || s === '');
    })
    .default(true),
  apiPort: z.coerce.number().int().min(1).max(65535).default(7878),
  apiKey: z.string().optional(),
  githubWebhookSecret: z.string().optional(),
  maxConcurrentSessions: z.coerce.number().int().min(1).max(16).default(4),
  maxRetriesPerTask: z.coerce.number().int().min(0).max(10).default(3),
  retryBackoffMs: z.coerce.number().int().min(100).default(2000),
  worktreeRetentionMinutes: z.coerce.number().int().min(0).default(60),
  logRetentionDays: z.coerce.number().int().min(1).default(30),
  discordBotToken: z.string().optional(),
  discordAllowedChannels: z.string().default(''),
  discordAdminUsers: z.string().default(''),
  discordCommandPrefix: z.string().default('!dispatch'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    copilotModel: env.COPILOT_MODEL,
    copilotDefaultRemote: env.COPILOT_DEFAULT_REMOTE,
    apiPort: env.API_PORT,
    apiKey: env.DISPATCH_API_KEY,
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    maxConcurrentSessions: env.MAX_CONCURRENT_SESSIONS,
    maxRetriesPerTask: env.MAX_RETRIES_PER_TASK,
    retryBackoffMs: env.RETRY_BACKOFF_MS,
    worktreeRetentionMinutes: env.WORKTREE_RETENTION_MINUTES,
    logRetentionDays: env.LOG_RETENTION_DAYS,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordAllowedChannels: env.DISCORD_ALLOWED_CHANNELS,
    discordAdminUsers: env.DISCORD_ADMIN_USERS,
    discordCommandPrefix: env.DISCORD_COMMAND_PREFIX,
  });
}

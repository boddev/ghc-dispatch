/**
 * Discord surface adapter for GHC Orchestrator.
 *
 * Integrates with the Copilot CLI Discord bridge extension to receive
 * task commands from Discord and relay results back.
 */

export interface DiscordMessage {
  content: string;
  author: string;
  channel: string;
}

export interface DiscordAdapter {
  onMessage(handler: (msg: DiscordMessage) => Promise<string>): void;
  send(channel: string, content: string): Promise<void>;
}

/**
 * Parse a Discord message into a task command.
 * Supports:
 *   !task create "Fix the bug" --agent @coder --priority high
 *   !task list
 *   !task status <id>
 *   !task cancel <id>
 */
export function parseDiscordCommand(content: string): {
  command: string;
  args: Record<string, string>;
} | null {
  if (!content.startsWith('!task')) return null;

  const parts = content.slice(5).trim().split(/\s+/);
  const command = parts[0] ?? '';
  const args: Record<string, string> = {};

  // Extract quoted title
  const titleMatch = content.match(/"([^"]+)"/);
  if (titleMatch) args.title = titleMatch[1];

  // Extract flags
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith('--') && i + 1 < parts.length) {
      const key = parts[i].slice(2);
      args[key] = parts[++i];
    }
  }

  // First non-flag arg after command (for status/cancel)
  if (!args.title && parts[1] && !parts[1].startsWith('--') && !parts[1].startsWith('"')) {
    args.id = parts[1];
  }

  return { command, args };
}

export function formatTaskForDiscord(task: any): string {
  const emoji: Record<string, string> = {
    pending: '⏳',
    queued: '📋',
    running: '🔄',
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
    paused: '⏸️',
  };

  return [
    `${emoji[task.status] ?? '❓'} **${task.title}**`,
    `ID: \`${task.id}\``,
    `Status: ${task.status} | Agent: ${task.agent} | Priority: ${task.priority}`,
    task.result?.summary ? `Result: ${task.result.summary.slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

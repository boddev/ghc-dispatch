/**
 * Dispatch TUI — Interactive Terminal Interface
 *
 * A persistent readline session that connects to the running dispatch daemon.
 * Supports /slash commands for instant actions and natural language for task creation.
 * Streams real-time events from the daemon via SSE.
 */

import * as readline from 'node:readline';
import * as http from 'node:http';

const API_BASE = process.env.DISPATCH_API_URL ?? 'http://localhost:7878';

// --- Colors ---
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const EMOJI: Record<string, string> = {
  pending: '⏳', queued: '📋', running: '🔄', completed: '✅',
  failed: '❌', cancelled: '🚫', paused: '⏸️',
};

// --- API Client ---
async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const opts: http.RequestOptions = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data as any); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- SSE Listener ---
function connectSSE(onEvent: (event: any) => void): () => void {
  let aborted = false;
  const connect = () => {
    if (aborted) return;
    http.get(`${API_BASE}/api/events/stream`, (res) => {
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const blocks = buf.split('\n\n');
        buf = blocks.pop() ?? '';
        for (const block of blocks) {
          const line = block.split('\n').find(l => l.startsWith('data: '));
          if (line) {
            try { onEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      });
      res.on('end', () => { if (!aborted) setTimeout(connect, 2000); });
      res.on('error', () => { if (!aborted) setTimeout(connect, 5000); });
    }).on('error', () => { if (!aborted) setTimeout(connect, 5000); });
  };
  connect();
  return () => { aborted = true; };
}

// --- Slash Command Handlers ---
const COMMANDS: Record<string, { desc: string; usage?: string; handler: (args: string) => Promise<void> }> = {
  help: {
    desc: 'Show available commands',
    handler: async () => {
      console.log(`\n${C.bold}  Dispatch TUI Commands${C.reset}\n`);
      const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        console.log(`  ${C.cyan}/${name.padEnd(maxLen)}${C.reset}  ${cmd.desc}`);
      }
      console.log(`\n  ${C.dim}Type anything without / to create a task from natural language.${C.reset}\n`);
    },
  },

  tasks: {
    desc: 'List all tasks',
    usage: '/tasks [status]',
    handler: async (args) => {
      const status = args.trim() || undefined;
      const url = status ? `/api/tasks?status=${status}&limit=20` : '/api/tasks?limit=20';
      const tasks: any[] = await api('GET', url);
      if (tasks.length === 0) { console.log(`  ${C.dim}No tasks found.${C.reset}`); return; }
      console.log(`\n  ${'ID'.padEnd(10)} ${'STATUS'.padEnd(10)} ${'PRIORITY'.padEnd(8)} ${'AGENT'.padEnd(18)} TITLE`);
      console.log(`  ${'─'.repeat(75)}`);
      for (const t of tasks) {
        const e = EMOJI[t.status] ?? '❓';
        console.log(`  ${C.dim}${t.id.slice(-8)}${C.reset}   ${e} ${t.status.padEnd(9)} ${t.priority.padEnd(8)} ${t.agent.padEnd(18)} ${t.title}`);
      }
      console.log(`  ${C.dim}${tasks.length} task(s)${C.reset}\n`);
    },
  },

  create: {
    desc: 'Create a new task',
    usage: '/create <title> [@agent] [!priority]',
    handler: async (args) => {
      if (!args.trim()) { console.log(`  Usage: /create "task title" [@coder] [!high]`); return; }
      const agentMatch = args.match(/@([\w-]+)/);
      const priMatch = args.match(/!(critical|high|normal|low)/);
      const title = args.replace(/@[\w-]+/, '').replace(/!(critical|high|normal|low)/, '').trim().replace(/^["']|["']$/g, '');
      const task: any = await api('POST', '/api/tasks', {
        title,
        agent: agentMatch ? `@${agentMatch[1]}` : '@general-purpose',
        priority: priMatch?.[1] ?? 'normal',
        createdBy: 'tui',
      });
      console.log(`  ${C.green}✅ Task created: ${task.id}${C.reset}`);
      console.log(`     ${task.title} — ${task.agent} (${task.priority})\n`);
    },
  },

  status: {
    desc: 'Show task detail',
    usage: '/status <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /status <task-id>'); return; }
      const t: any = await api('GET', `/api/tasks/${id}`);
      if (t.error) { console.log(`  ${C.red}${t.error}${C.reset}`); return; }
      console.log(`\n  ${C.bold}${t.title}${C.reset}`);
      console.log(`  ID: ${t.id}`);
      console.log(`  Status: ${EMOJI[t.status] ?? ''} ${t.status} | Agent: ${t.agent} | Priority: ${t.priority}`);
      console.log(`  Created: ${new Date(t.createdAt).toLocaleString()} | Retries: ${t.retryCount}/${t.maxRetries}`);
      if (t.result?.summary) console.log(`  Result: ${t.result.summary.slice(0, 200)}`);
      if (t.result?.error) console.log(`  ${C.red}Error: ${t.result.error.slice(0, 200)}${C.reset}`);
      console.log();
    },
  },

  cancel: {
    desc: 'Cancel a task',
    usage: '/cancel <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /cancel <task-id>'); return; }
      await api('POST', `/api/tasks/${id}/cancel`);
      console.log(`  ${C.yellow}🚫 Task ${id} cancelled${C.reset}`);
    },
  },

  retry: {
    desc: 'Retry a failed task',
    usage: '/retry <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /retry <task-id>'); return; }
      const t: any = await api('POST', `/api/tasks/${id}/retry`);
      console.log(`  ${C.blue}🔄 Task ${id} re-queued (retry ${t.retryCount})${C.reset}`);
    },
  },

  enqueue: {
    desc: 'Queue a pending task',
    usage: '/enqueue <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /enqueue <task-id>'); return; }
      await api('POST', `/api/tasks/${id}/enqueue`);
      console.log(`  📋 Task ${id} queued`);
    },
  },

  execute: {
    desc: 'Enqueue and immediately run a task',
    usage: '/execute <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /execute <task-id>'); return; }
      await api('POST', `/api/tasks/${id}/execute`);
      console.log(`  🚀 Task ${id} dispatched for execution`);
    },
  },

  events: {
    desc: 'Show event history for a task',
    usage: '/events <task-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /events <task-id>'); return; }
      const events: any[] = await api('GET', `/api/tasks/${id}/events`);
      if (events.length === 0) { console.log(`  ${C.dim}No events.${C.reset}`); return; }
      for (const e of events.slice(-20)) {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const content = e.payload?.content ? ` — ${String(e.payload.content).slice(0, 80)}` : '';
        console.log(`  ${C.dim}${time}${C.reset} ${e.payload.type}${content}`);
      }
      console.log(`  ${C.dim}${events.length} total events${C.reset}\n`);
    },
  },

  agents: {
    desc: 'List available agents',
    handler: async () => {
      const agents: any[] = await api('GET', '/api/agents');
      for (const a of agents) {
        console.log(`  ${C.cyan}${a.name}${C.reset}  ${a.model}  ${C.dim}${a.description}${C.reset}`);
      }
      console.log();
    },
  },

  skills: {
    desc: 'List installed skills',
    handler: async () => {
      const data: any = await api('GET', '/api/skills');
      if (data.userInstalled?.length) {
        console.log(`\n  ${C.bold}User-Installed (${data.userInstalled.length})${C.reset}`);
        for (const s of data.userInstalled) console.log(`    ${s.enabled ? '●' : '○'} ${s.name} ${C.dim}(${s.origin})${C.reset}`);
      }
      if (data.systemCreated?.length) {
        console.log(`  ${C.bold}System-Created (${data.systemCreated.length})${C.reset}`);
        for (const s of data.systemCreated) console.log(`    ${s.enabled ? '●' : '○'} ${s.name} ${C.dim}(${s.origin})${C.reset}`);
      }
      if (!data.userInstalled?.length && !data.systemCreated?.length) console.log(`  ${C.dim}No skills installed.${C.reset}`);
      console.log();
    },
  },

  stats: {
    desc: 'System statistics',
    handler: async () => {
      const [stats, mem]: [any, any] = await Promise.all([
        api('GET', '/api/stats'),
        api('GET', '/api/memory/stats'),
      ]);
      console.log(`\n  ${C.bold}Tasks${C.reset}`);
      for (const [k, v] of Object.entries(stats.tasks ?? {})) console.log(`    ${k}: ${v}`);
      console.log(`  Queue: ${stats.queue} | Running: ${stats.running} | Sessions: ${stats.sessions?.active}/${(stats.sessions?.active ?? 0) + (stats.sessions?.available ?? 0)}`);
      console.log(`  Approvals: ${stats.pendingApprovals}`);
      console.log(`\n  ${C.bold}Memory${C.reset}`);
      console.log(`    Messages: ${mem.totalMessages} | Facts: ${mem.totalFacts} | Entities: ${mem.totalEntities} | Wiki: ${mem.wikiPages}\n`);
    },
  },

  model: {
    desc: 'Show or switch model',
    usage: '/model [name] [@agent]',
    handler: async (args) => {
      if (!args.trim()) {
        const data: any = await api('GET', '/api/models');
        console.log(`  Current default: ${C.bold}${data.current}${C.reset}`);
        if (Object.keys(data.agentOverrides ?? {}).length) {
          for (const [a, m] of Object.entries(data.agentOverrides)) console.log(`    ${a}: ${m}`);
        }
        console.log();
        return;
      }
      const parts = args.trim().split(/\s+/);
      const model = parts[0];
      const agentIdx = parts.indexOf('--agent');
      const agent = agentIdx >= 0 && agentIdx + 1 < parts.length ? parts[agentIdx + 1] : undefined;
      const atIdx = parts.findIndex(p => p.startsWith('@'));
      const agentAt = atIdx >= 0 ? parts[atIdx] : agent;

      const result: any = await api('POST', '/api/models/switch', { model, agent: agentAt });
      if (result.error) { console.log(`  ${C.red}${result.error}${C.reset}`); return; }
      console.log(`  ${C.green}✅ ${result.message}${C.reset}`);
    },
  },

  models: {
    desc: 'List available models',
    handler: async () => {
      const data: any = await api('GET', '/api/models');
      console.log(`\n  ${C.bold}Available Models${C.reset}  (current: ${data.current})\n`);
      for (const m of data.available ?? []) {
        const marker = m.id === data.current ? ` ${C.green}◄${C.reset}` : '';
        console.log(`  ${m.id.padEnd(24)} ${C.dim}${m.provider.padEnd(12)} ${m.tier}${C.reset}${marker}`);
      }
      console.log();
    },
  },

  recall: {
    desc: 'Search memory across all channels',
    usage: '/recall <topic>',
    handler: async (args) => {
      if (!args.trim()) { console.log('  Usage: /recall <topic>'); return; }
      const suggestions: any[] = await api('POST', '/api/memory/suggest', { message: args, channel: 'tui' });
      if (suggestions.length === 0) { console.log(`  ${C.dim}No memories found.${C.reset}`); return; }
      for (const s of suggestions.slice(0, 8)) {
        const src = s.channel ? ` ${C.dim}(${s.channel})${C.reset}` : '';
        console.log(`  ${C.yellow}[${s.type}]${C.reset} ${s.source}${src}`);
        console.log(`    ${s.content.slice(0, 150)}`);
      }
      console.log();
    },
  },

  approvals: {
    desc: 'List pending approvals',
    handler: async () => {
      const approvals: any[] = await api('GET', '/api/approvals');
      if (approvals.length === 0) { console.log(`  ${C.dim}No pending approvals.${C.reset}`); return; }
      for (const a of approvals) {
        console.log(`  ${C.yellow}⚠️  ${a.description}${C.reset}`);
        console.log(`    ID: ${a.id} | Task: ${a.taskId} | Type: ${a.type} | Expires: ${new Date(a.expiresAt).toLocaleTimeString()}`);
        console.log(`    ${C.dim}/approve ${a.id}  or  /reject ${a.id}${C.reset}`);
      }
      console.log();
    },
  },

  approve: {
    desc: 'Approve a pending request',
    usage: '/approve <approval-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /approve <approval-id>'); return; }
      await api('POST', `/api/approvals/${id}/approve`, { decidedBy: 'tui-user' });
      console.log(`  ${C.green}✅ Approved: ${id}${C.reset}`);
    },
  },

  reject: {
    desc: 'Reject a pending request',
    usage: '/reject <approval-id>',
    handler: async (args) => {
      const id = args.trim();
      if (!id) { console.log('  Usage: /reject <approval-id>'); return; }
      await api('POST', `/api/approvals/${id}/reject`, { decidedBy: 'tui-user' });
      console.log(`  ${C.red}❌ Rejected: ${id}${C.reset}`);
    },
  },

  checkin: {
    desc: 'Run a proactive check-in',
    handler: async () => {
      const data: any = await api('GET', '/api/checkin');
      if (!data.messages?.length) { console.log(`  ${C.green}✅ All clear — nothing to report.${C.reset}`); return; }
      console.log(`\n${data.formatted}\n`);
    },
  },

  automation: {
    desc: 'List automation jobs',
    handler: async () => {
      const jobs: any[] = await api('GET', '/api/automation');
      if (jobs.length === 0) { console.log(`  ${C.dim}No automation jobs.${C.reset}`); return; }
      for (const j of jobs) {
        const icon = j.type === 'cron' ? '⏰' : j.type === 'webhook' ? '🌐' : '⚡';
        const en = j.enabled ? '' : ` ${C.dim}(disabled)${C.reset}`;
        console.log(`  ${icon} ${C.bold}${j.name}${C.reset}${en}  ${C.dim}${j.type} · runs: ${j.runCount}${C.reset}`);
      }
      console.log();
    },
  },

  reload: {
    desc: 'Hot-reload agents and skills',
    handler: async () => {
      const data: any = await api('POST', '/api/reload');
      console.log(`  ${C.green}🔄 Reloaded: ${data.agents} agents, ${data.skills} skills${C.reset}`);
    },
  },

  restart: {
    desc: 'Restart the daemon',
    handler: async () => {
      console.log(`  ${C.yellow}🔄 Restarting daemon...${C.reset}`);
      await api('POST', '/api/restart');
      console.log(`  ${C.dim}Daemon is restarting. TUI will reconnect.${C.reset}`);
    },
  },

  update: {
    desc: 'Update dispatch to latest version',
    handler: async () => {
      console.log(`  ${C.yellow}🔄 Checking for updates...${C.reset}`);
      const data: any = await api('POST', '/api/update');
      if (data.success) {
        console.log(`  ${C.green}✅ Updated: ${data.previousVersion} → ${data.newVersion} (${data.method})${C.reset}`);
      } else {
        console.log(`  ${C.red}❌ Update failed: ${data.output?.slice(0, 200)}${C.reset}`);
      }
    },
  },

  clear: {
    desc: 'Clear the screen',
    handler: async () => {
      console.clear();
    },
  },

  quit: {
    desc: 'Exit the TUI',
    handler: async () => {
      console.log(`\n  ${C.dim}Goodbye.${C.reset}\n`);
      process.exit(0);
    },
  },
};

// --- TUI Main ---
export async function startTui(): Promise<void> {
  console.log(`\n  ${C.bold}${C.cyan}⚡ Dispatch TUI${C.reset}`);
  console.log(`  ${C.dim}Connected to ${API_BASE}${C.reset}`);
  console.log(`  ${C.dim}Type /help for commands, or type naturally to create tasks.${C.reset}`);
  console.log(`  ${C.dim}Press Ctrl+C or type /quit to exit.${C.reset}\n`);

  // Check if daemon is running
  try {
    const health: any = await api('GET', '/api/health');
    console.log(`  ${C.green}✓${C.reset} Daemon v${health.version} — uptime ${Math.floor(health.uptime)}s\n`);
  } catch {
    console.log(`  ${C.red}✗${C.reset} Cannot reach daemon at ${API_BASE}`);
    console.log(`  ${C.dim}  Run 'dispatch --start' in another terminal, or press Enter to start it here.${C.reset}\n`);
  }

  // Connect SSE for real-time events
  const disconnectSSE = connectSSE((event) => {
    if (event.type === 'task.completed') {
      process.stdout.write(`\r  ${C.green}✅ Task ${event.taskId} completed${C.reset}\n> `);
    } else if (event.type === 'task.failed') {
      process.stdout.write(`\r  ${C.red}❌ Task ${event.taskId} failed${C.reset}\n> `);
    } else if (event.type === 'approval.requested') {
      process.stdout.write(`\r  ${C.yellow}⚠️  Approval requested: ${event.approvalId}${C.reset}\n> `);
    }
  });

  // Readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input.startsWith('/')) {
      // Slash command
      const spaceIdx = input.indexOf(' ');
      const cmdName = (spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1)).toLowerCase();
      const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1) : '';

      const cmd = COMMANDS[cmdName];
      if (!cmd) {
        console.log(`  ${C.red}Unknown command: /${cmdName}${C.reset}. Type /help for available commands.`);
        rl.prompt();
        return;
      }

      try {
        await cmd.handler(cmdArgs);
      } catch (err: any) {
        console.log(`  ${C.red}Error: ${err.message}${C.reset}`);
      }
    } else {
      // Natural language → create a task
      try {
        const task: any = await api('POST', '/api/tasks', {
          title: input.slice(0, 100),
          description: input,
          agent: '@general-purpose',
          createdBy: 'tui',
        });
        console.log(`  ${C.green}✅ Task created: ${task.id}${C.reset}`);
        console.log(`     ${task.title} — ${task.agent}\n`);

        // Log to memory
        try {
          await api('POST', '/api/conversations', {
            channel: 'tui', speaker: 'user', content: input,
          });
        } catch {}
      } catch (err: any) {
        console.log(`  ${C.red}Error: ${err.message}${C.reset}`);
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    disconnectSSE();
    console.log(`\n  ${C.dim}Goodbye.${C.reset}\n`);
    process.exit(0);
  });

  // Handle Escape to cancel current input
  if (process.stdin.isTTY) {
    process.stdin.on('keypress', (_, key) => {
      if (key?.name === 'escape') {
        rl.write(null, { ctrl: true, name: 'u' }); // clear line
      }
    });
  }
}

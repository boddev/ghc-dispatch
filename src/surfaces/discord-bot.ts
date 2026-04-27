/**
 * Discord Bot — Full Discord integration for GHC Dispatch.
 *
 * Connects to Discord as a bot, listens in configured channels,
 * handles commands and natural language, logs conversations to
 * the memory system, and relays task results back.
 *
 * Supports:
 * - Command prefix (!dispatch or configurable)
 * - Natural language conversation (messages mentioning the bot)
 * - Task management (create, list, status, cancel, retry, enqueue)
 * - Approval workflows (approve/reject from Discord)
 * - Skill queries
 * - Memory/recall from conversations
 * - Event notifications (task completed/failed pushed to channel)
 */

import { Client, GatewayIntentBits, type Message, type TextChannel, EmbedBuilder, type Channel } from 'discord.js';
import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { SessionRunner } from '../execution/session-runner.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { EventBus } from '../control-plane/event-bus.js';
import type { ModelManager } from '../execution/model-manager.js';
import type { Config } from '../config.js';

export interface DiscordBotDeps {
  taskManager: TaskManager;
  approvalManager: ApprovalManager;
  sessionRunner: SessionRunner;
  skillManager: SkillManager;
  memoryManager: MemoryManager;
  eventBus: EventBus;
  modelManager: ModelManager;
  config: Config;
}

export class DiscordBot {
  private client: Client;
  private deps: DiscordBotDeps;
  private prefix: string;
  private allowedChannels: Set<string>;
  private notifyChannelId: string | null = null;

  constructor(deps: DiscordBotDeps) {
    this.deps = deps;
    this.prefix = deps.config.discordCommandPrefix || '!dispatch';
    this.allowedChannels = new Set(
      (deps.config.discordAllowedChannels || '').split(',').map(s => s.trim()).filter(Boolean)
    );

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on('ready', () => {
      console.log(`   Discord: logged in as ${this.client.user?.tag}`);
      this.setupEventNotifications();
    });

    this.client.on('messageCreate', (msg) => this.handleMessage(msg));
  }

  async start(): Promise<void> {
    const token = this.deps.config.discordBotToken;
    if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
    await this.client.login(token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  isRunning(): boolean {
    return this.client.isReady();
  }

  private isAllowedChannel(channelId: string): boolean {
    if (this.allowedChannels.size === 0) return true; // no restriction
    return this.allowedChannels.has(channelId);
  }

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;
    if (!this.isAllowedChannel(msg.channelId)) return;

    const content = msg.content.trim();
    const isMention = msg.mentions.has(this.client.user!);
    const isCommand = content.startsWith(this.prefix);
    const isDM = !msg.guild;

    // Record in conversation log
    this.deps.memoryManager.recordMessage({
      channel: 'discord',
      threadId: msg.channelId,
      speaker: msg.author.username,
      speakerType: 'user',
      role: 'user',
      content: content,
      metadata: {
        discordUserId: msg.author.id,
        discordChannelId: msg.channelId,
        guildId: msg.guild?.id,
        isDM,
      },
    });

    if (isCommand) {
      await this.handleCommand(msg, content.slice(this.prefix.length).trim());
    } else if (isMention || isDM) {
      await this.handleConversation(msg, content.replace(/<@!?\d+>/g, '').trim());
    }
  }

  private async handleCommand(msg: Message, input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const command = parts[0]?.toLowerCase();

    try {
      switch (command) {
        case 'create':
          await this.cmdCreate(msg, input);
          break;
        case 'list':
          await this.cmdList(msg, input);
          break;
        case 'status':
          await this.cmdStatus(msg, parts[1]);
          break;
        case 'cancel':
          await this.cmdCancel(msg, parts[1]);
          break;
        case 'retry':
          await this.cmdRetry(msg, parts[1]);
          break;
        case 'enqueue':
          await this.cmdEnqueue(msg, parts[1]);
          break;
        case 'approve':
          await this.cmdApprove(msg, parts[1]);
          break;
        case 'reject':
          await this.cmdReject(msg, parts[1]);
          break;
        case 'agents':
          await this.cmdAgents(msg);
          break;
        case 'skills':
          await this.cmdSkills(msg);
          break;
        case 'stats':
          await this.cmdStats(msg);
          break;
        case 'recall':
          await this.cmdRecall(msg, parts.slice(1).join(' '));
          break;
        case 'model':
          await this.cmdModel(msg, parts.slice(1));
          break;
        case 'events':
          await this.cmdEvents(msg, parts[1]);
          break;
        case 'reload':
          await this.cmdReload(msg);
          break;
        case 'restart':
          await this.cmdRestart(msg);
          break;
        case 'update':
          await this.cmdUpdate(msg);
          break;
        case 'checkin':
          await this.cmdCheckin(msg);
          break;
        case 'version':
          await this.cmdVersion(msg);
          break;
        case 'help':
        default:
          await this.cmdHelp(msg);
          break;
      }
    } catch (err: any) {
      await msg.reply(`❌ Error: ${err.message}`);
    }

    // Log bot response
    this.logBotMessage(msg.channelId, `[command response for: ${command}]`);
  }

  private async handleConversation(msg: Message, text: string): Promise<void> {
    if (!text) return;

    // Check for relevance suggestions
    const suggestions = this.deps.memoryManager.getRelevanceSuggestions(text, 'discord', 3);

    let reply = '';

    // If the message looks like a task request, offer to create one
    const taskPatterns = /\b(fix|build|create|deploy|test|refactor|review|implement|add|remove|update)\b/i;
    if (taskPatterns.test(text)) {
      const task = this.deps.taskManager.createTask({
        title: text.slice(0, 100),
        description: text,
        agent: '@general-purpose',
        createdBy: `discord:${msg.author.username}`,
      });
      reply = `📋 Created task: \`${task.id}\`\n> ${task.title}`;
    } else {
      reply = `🤖 I heard you! Use \`${this.prefix} help\` to see available commands.`;
    }

    // Append relevant context from other channels
    if (suggestions.length > 0) {
      reply += '\n\n💡 **Related context:**';
      for (const s of suggestions.slice(0, 3)) {
        const source = s.channel && s.channel !== 'discord' ? ` *(from ${s.channel})*` : '';
        reply += `\n> ${s.content.slice(0, 150)}${source}`;
      }
    }

    await msg.reply(reply);
    this.logBotMessage(msg.channelId, reply);
  }

  // --- Commands ---

  private async cmdCreate(msg: Message, input: string): Promise<void> {
    const titleMatch = input.match(/"([^"]+)"/);
    const title = titleMatch?.[1] ?? input.replace(/^create\s+/i, '').trim();
    if (!title) { await msg.reply('Usage: `!dispatch create "Task title" [--agent @coder] [--priority high]`'); return; }

    const agent = this.extractFlag(input, '--agent') ?? '@general-purpose';
    const priority = this.extractFlag(input, '--priority') ?? 'normal';
    const repo = this.extractFlag(input, '--repo');

    const task = this.deps.taskManager.createTask({
      title,
      agent,
      priority: priority as any,
      repo,
      createdBy: `discord:${msg.author.username}`,
    });

    this.notifyChannelId = msg.channelId;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('✅ Task Created')
      .addFields(
        { name: 'ID', value: `\`${task.id}\``, inline: true },
        { name: 'Agent', value: task.agent, inline: true },
        { name: 'Priority', value: task.priority, inline: true },
        { name: 'Title', value: task.title },
      )
      .setTimestamp();

    await msg.reply({ embeds: [embed] });
  }

  private async cmdList(msg: Message, input: string): Promise<void> {
    const statusFilter = this.extractFlag(input, '--status');
    const limit = parseInt(this.extractFlag(input, '--limit') ?? '10', 10);
    const tasks = this.deps.taskManager.listTasks(statusFilter as any, limit);

    if (tasks.length === 0) {
      await msg.reply('No tasks found.');
      return;
    }

    const emoji: Record<string, string> = {
      pending: '⏳', queued: '📋', running: '🔄', completed: '✅',
      failed: '❌', cancelled: '🚫', paused: '⏸️',
    };

    const lines = tasks.map(t =>
      `${emoji[t.status] ?? '❓'} \`${t.id.slice(-8)}\` **${t.title.slice(0, 50)}** — ${t.agent} (${t.priority})`
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📋 Tasks (${tasks.length})`)
      .setDescription(lines.join('\n'));

    await msg.reply({ embeds: [embed] });
  }

  private async cmdStatus(msg: Message, taskId?: string): Promise<void> {
    if (!taskId) { await msg.reply('Usage: `!dispatch status <task-id>`'); return; }
    const task = this.deps.taskManager.getTask(taskId);
    if (!task) { await msg.reply(`Task not found: \`${taskId}\``); return; }

    const embed = new EmbedBuilder()
      .setColor(task.status === 'completed' ? 0x57F287 : task.status === 'failed' ? 0xED4245 : 0x5865F2)
      .setTitle(`${task.title}`)
      .addFields(
        { name: 'ID', value: `\`${task.id}\``, inline: true },
        { name: 'Status', value: task.status, inline: true },
        { name: 'Agent', value: task.agent, inline: true },
        { name: 'Priority', value: task.priority, inline: true },
        { name: 'Retries', value: `${task.retryCount}/${task.maxRetries}`, inline: true },
        { name: 'Created', value: new Date(task.createdAt).toLocaleString(), inline: true },
      )
      .setTimestamp();

    if (task.description) embed.setDescription(task.description.slice(0, 300));
    if (task.result?.summary) embed.addFields({ name: 'Result', value: task.result.summary.slice(0, 500) });
    if (task.result?.error) embed.addFields({ name: 'Error', value: task.result.error.slice(0, 500) });

    await msg.reply({ embeds: [embed] });
  }

  private async cmdCancel(msg: Message, taskId?: string): Promise<void> {
    if (!taskId) { await msg.reply('Usage: `!dispatch cancel <task-id>`'); return; }
    const task = this.deps.taskManager.cancelTask(taskId, `Cancelled by ${msg.author.username} via Discord`);
    await msg.reply(`🚫 Task cancelled: \`${task.id}\``);
  }

  private async cmdRetry(msg: Message, taskId?: string): Promise<void> {
    if (!taskId) { await msg.reply('Usage: `!dispatch retry <task-id>`'); return; }
    const task = this.deps.taskManager.retryTask(taskId);
    await msg.reply(`🔄 Task re-queued: \`${task.id}\` (retry ${task.retryCount})`);
  }

  private async cmdEnqueue(msg: Message, taskId?: string): Promise<void> {
    if (!taskId) { await msg.reply('Usage: `!dispatch enqueue <task-id>`'); return; }
    const task = this.deps.taskManager.enqueueTask(taskId);
    await msg.reply(`📋 Task queued: \`${task.id}\``);
  }

  private async cmdApprove(msg: Message, approvalId?: string): Promise<void> {
    if (!approvalId) { await msg.reply('Usage: `!dispatch approve <approval-id>`'); return; }
    const approval = this.deps.approvalManager.approve(approvalId, `discord:${msg.author.username}`);
    if (!approval) { await msg.reply('Approval not found or already decided.'); return; }
    await msg.reply(`✅ Approved: \`${approval.id}\` for task \`${approval.taskId}\``);
  }

  private async cmdReject(msg: Message, approvalId?: string): Promise<void> {
    if (!approvalId) { await msg.reply('Usage: `!dispatch reject <approval-id>`'); return; }
    const approval = this.deps.approvalManager.reject(approvalId, `discord:${msg.author.username}`);
    if (!approval) { await msg.reply('Approval not found or already decided.'); return; }
    await msg.reply(`❌ Rejected: \`${approval.id}\` for task \`${approval.taskId}\``);
  }

  private async cmdAgents(msg: Message): Promise<void> {
    const agents = this.deps.skillManager ? [] : []; // placeholder
    // Get agents from agent loader indirectly via task manager
    const lines = ['**Available Agents:**'];
    lines.push('`@orchestrator` — Routes tasks and manages workflows');
    lines.push('`@coder` — Software engineering specialist');
    lines.push('`@designer` — UI/UX design specialist');
    lines.push('`@general-purpose` — Research, docs, general tasks');
    await msg.reply(lines.join('\n'));
  }

  private async cmdSkills(msg: Message): Promise<void> {
    const userSkills = this.deps.skillManager.listUserInstalled();
    const systemSkills = this.deps.skillManager.listSystemCreated();

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🛠️ Skills');

    if (userSkills.length > 0) {
      embed.addFields({
        name: `User-installed (${userSkills.length})`,
        value: userSkills.map(s => `• **${s.name}** — ${s.description.slice(0, 60) || 'No description'}`).join('\n').slice(0, 1024),
      });
    }

    if (systemSkills.length > 0) {
      embed.addFields({
        name: `System-created (${systemSkills.length})`,
        value: systemSkills.map(s => `• **${s.name}** — ${s.description.slice(0, 60) || 'No description'}`).join('\n').slice(0, 1024),
      });
    }

    if (userSkills.length === 0 && systemSkills.length === 0) {
      embed.setDescription('No skills installed yet.');
    }

    await msg.reply({ embeds: [embed] });
  }

  private async cmdStats(msg: Message): Promise<void> {
    const taskStats = this.deps.taskManager.getStats();
    const memStats = this.deps.memoryManager.getStats();

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Dispatch Stats')
      .addFields(
        { name: 'Tasks', value: Object.entries(taskStats).map(([k, v]) => `${k}: ${v}`).join('\n') || 'None', inline: true },
        { name: 'Memory', value: `Messages: ${memStats.totalMessages}\nFacts: ${memStats.totalFacts}\nEntities: ${memStats.totalEntities}`, inline: true },
        { name: 'Skills', value: `User: ${this.deps.skillManager.listUserInstalled().length}\nSystem: ${this.deps.skillManager.listSystemCreated().length}`, inline: true },
      )
      .setTimestamp();

    await msg.reply({ embeds: [embed] });
  }

  private async cmdRecall(msg: Message, query: string): Promise<void> {
    if (!query) { await msg.reply('Usage: `!dispatch recall <topic>`'); return; }

    const suggestions = this.deps.memoryManager.getRelevanceSuggestions(query, 'discord', 5);
    const facts = this.deps.memoryManager.proactive.searchFacts(query, 5);

    if (suggestions.length === 0 && facts.length === 0) {
      await msg.reply(`🔍 No memories found for: "${query}"`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle(`🧠 Recall: "${query}"`);

    if (facts.length > 0) {
      embed.addFields({
        name: 'Known Facts',
        value: facts.map(f => `• [${f.entitySlug}] ${f.fact}`).join('\n').slice(0, 1024),
      });
    }

    if (suggestions.length > 0) {
      embed.addFields({
        name: 'Related Conversations',
        value: suggestions
          .filter(s => s.type === 'conversation' || s.type === 'episodic')
          .slice(0, 3)
          .map(s => `> ${s.content.slice(0, 150)}${s.channel ? ` *(${s.channel})*` : ''}`)
          .join('\n').slice(0, 1024) || 'None found',
      });
    }

    await msg.reply({ embeds: [embed] });
  }

  private async cmdModel(msg: Message, parts: string[]): Promise<void> {
    const mm = this.deps.modelManager;
    const modelArg = parts[0];

    if (!modelArg) {
      // Show current model
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🧠 Current Model')
        .addFields({ name: 'Default', value: `\`${mm.getDefault()}\`` });

      const overrides = mm.getAgentOverrides();
      if (Object.keys(overrides).length > 0) {
        embed.addFields({
          name: 'Agent Overrides',
          value: Object.entries(overrides).map(([a, m]) => `${a}: \`${m}\``).join('\n'),
        });
      }

      await msg.reply({ embeds: [embed] });
      return;
    }

    // Check for --agent flag
    const agentIdx = parts.indexOf('--agent');
    const agentArg = agentIdx >= 0 && agentIdx + 1 < parts.length ? parts[agentIdx + 1] : undefined;

    const found = mm.findModel(modelArg);
    if (!found) {
      const models = mm.listModels().map(m => `\`${m.id}\``).join(', ');
      await msg.reply(`❌ Unknown model: \`${modelArg}\`\nAvailable: ${models}`);
      return;
    }

    if (agentArg) {
      mm.setAgentModel(agentArg, found.id);
      await msg.reply(`✅ Agent **${agentArg}** switched to \`${found.id}\` (${found.name})`);
    } else {
      mm.setDefault(found.id);
      await msg.reply(`✅ Default model switched to \`${found.id}\` (${found.name})`);
    }
  }

  private async cmdEvents(msg: Message, taskId?: string): Promise<void> {
    if (!taskId) { await msg.reply('Usage: `!dispatch events <task-id>`'); return; }
    const events = this.deps.taskManager.getTaskEvents(taskId);
    if (events.length === 0) { await msg.reply('No events found.'); return; }

    const lines = events.slice(-15).map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString();
      const content = 'content' in e.payload ? ` — ${String((e.payload as any).content).slice(0, 80)}` : '';
      return `\`${time}\` ${e.payload.type}${content}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📋 Events for ${taskId.slice(-8)}`)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: `${events.length} total events` });

    await msg.reply({ embeds: [embed] });
  }

  private async cmdReload(msg: Message): Promise<void> {
    try {
      const resp = await fetch('http://localhost:7878/api/reload', { method: 'POST' });
      const data = await resp.json() as any;
      await msg.reply(`🔄 Reloaded: ${data.agents} agents, ${data.skills} skills`);
    } catch {
      await msg.reply('❌ Could not reach daemon for reload.');
    }
  }

  private async cmdRestart(msg: Message): Promise<void> {
    await msg.reply('🔄 Restarting dispatch daemon...');
    try {
      await fetch('http://localhost:7878/api/restart', { method: 'POST' });
    } catch {
      await msg.reply('❌ Could not reach daemon for restart.');
    }
  }

  private async cmdUpdate(msg: Message): Promise<void> {
    await msg.reply('🔄 Checking for updates...');
    try {
      const resp = await fetch('http://localhost:7878/api/update', { method: 'POST' });
      const data = await resp.json() as any;
      if (data.success) {
        await msg.reply(`✅ Updated: ${data.previousVersion} → ${data.newVersion} (via ${data.method})`);
      } else {
        await msg.reply(`❌ Update failed: ${data.output?.slice(0, 200) ?? 'unknown error'}`);
      }
    } catch {
      await msg.reply('❌ Could not reach daemon for update.');
    }
  }

  private async cmdCheckin(msg: Message): Promise<void> {
    try {
      const resp = await fetch('http://localhost:7878/api/checkin');
      const data = await resp.json() as any;
      if (!data.messages?.length) {
        await msg.reply('✅ All clear — nothing to report.');
        return;
      }
      const emoji: Record<string, string> = { warning: '⚠️', info: 'ℹ️', suggestion: '💡' };
      const lines = data.messages.map((m: any) => `${emoji[m.type] ?? ''} **${m.title}**\n${m.body}`);
      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🔔 Dispatch Check-In')
        .setDescription(lines.join('\n\n').slice(0, 4000));
      await msg.reply({ embeds: [embed] });
    } catch {
      await msg.reply('❌ Could not reach daemon for check-in.');
    }
  }

  private async cmdVersion(msg: Message): Promise<void> {
    try {
      const resp = await fetch('http://localhost:7878/api/health');
      const data = await resp.json() as any;
      await msg.reply(`🤖 Dispatch v${data.version} — uptime: ${Math.floor(data.uptime)}s`);
    } catch {
      await msg.reply('dispatch 0.1.0 (daemon offline)');
    }
  }

  private async cmdHelp(msg: Message): Promise<void> {
    const p = this.prefix;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 GHC Dispatch — Discord Commands')
      .setDescription(`Prefix: \`${p}\``)
      .addFields(
        { name: 'Task Management', value: [
          `\`${p} create "title" [--agent @coder] [--priority high]\``,
          `\`${p} list [--status running]\``,
          `\`${p} status <task-id>\``,
          `\`${p} cancel <task-id>\``,
          `\`${p} retry <task-id>\``,
          `\`${p} enqueue <task-id>\``,
        ].join('\n') },
        { name: 'Approvals', value: [
          `\`${p} approve <approval-id>\``,
          `\`${p} reject <approval-id>\``,
        ].join('\n') },
        { name: 'Info & Memory', value: [
          `\`${p} agents\` — list available agents`,
          `\`${p} skills\` — list installed skills`,
          `\`${p} stats\` — system statistics`,
          `\`${p} recall <topic>\` — search memory for a topic`,
          `\`${p} events <task-id>\` — task event history`,
          `\`${p} model [name] [--agent @x]\` — show/switch model`,
        ].join('\n') },
        { name: 'System', value: [
          `\`${p} reload\` — hot-reload agents and skills`,
          `\`${p} restart\` — restart the daemon`,
          `\`${p} update\` — update to latest version`,
          `\`${p} checkin\` — run a proactive check-in now`,
          `\`${p} version\` — show version and uptime`,
        ].join('\n') },
        { name: 'Natural Language', value: 'Mention the bot or DM it to create tasks from natural language. Cross-channel context is included automatically.' },
      )
      .setFooter({ text: 'All conversations are logged for cross-channel context' });

    await msg.reply({ embeds: [embed] });
  }

  // --- Event Notifications ---

  private setupEventNotifications(): void {
    const notify = async (title: string, description: string, color: number) => {
      if (!this.notifyChannelId) return;
      try {
        const channel = await this.client.channels.fetch(this.notifyChannelId);
        if (channel && 'send' in channel) {
          const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
          await (channel as TextChannel).send({ embeds: [embed] });
        }
      } catch {}
    };

    this.deps.eventBus.on('task.completed', (event) => {
      if ('taskId' in event) {
        const task = this.deps.taskManager.getTask(event.taskId);
        if (task?.createdBy.startsWith('discord:')) {
          notify('✅ Task Completed', `**${task.title}**\n${task.result?.summary?.slice(0, 300) ?? ''}`, 0x57F287);
        }
      }
    });

    this.deps.eventBus.on('task.failed', (event) => {
      if ('taskId' in event) {
        const task = this.deps.taskManager.getTask(event.taskId);
        if (task?.createdBy.startsWith('discord:')) {
          notify('❌ Task Failed', `**${task.title}**\n${task.result?.error?.slice(0, 300) ?? 'Unknown error'}`, 0xED4245);
        }
      }
    });

    this.deps.eventBus.on('approval.requested', (event) => {
      if ('taskId' in event && 'approvalId' in event) {
        const approval = this.deps.approvalManager.getById((event as any).approvalId);
        if (approval) {
          notify(
            '⚠️ Approval Required',
            `**${approval.description}**\nTask: \`${approval.taskId}\`\nType: ${approval.type}\n\nReply with \`${this.prefix} approve ${approval.id}\` or \`${this.prefix} reject ${approval.id}\``,
            0xFEE75C,
          );
        }
      }
    });
  }

  private logBotMessage(channelId: string, content: string): void {
    this.deps.memoryManager.recordMessage({
      channel: 'discord',
      threadId: channelId,
      speaker: 'dispatch',
      speakerType: 'agent',
      role: 'assistant',
      content,
    });
  }

  private extractFlag(input: string, flag: string): string | undefined {
    const regex = new RegExp(`${flag}\\s+(\\S+)`);
    return input.match(regex)?.[1];
  }
}

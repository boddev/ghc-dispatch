import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { DispatchClient } from './client';
import { TaskTreeProvider, TaskItem } from './providers/task-tree';
import { AgentTreeProvider, AgentItem } from './providers/agent-tree';
import { SkillTreeProvider, SkillItem } from './providers/skill-tree';
import { AutomationTreeProvider } from './providers/automation-tree';
import { ApprovalTreeProvider, ApprovalItem } from './providers/approval-tree';
import { FeatureItem, FeatureTreeProvider } from './providers/feature-tree';
import { showTaskDetail } from './panels/task-detail';
import { showTaskForm } from './panels/task-form';
import { showDispatchChat } from './panels/dispatch-chat';
import { showFeatureDetail } from './panels/feature-detail';

let sseDisconnect: (() => void) | null = null;

async function isDaemonRunning(client: DispatchClient): Promise<boolean> {
  try {
    await client.get('/api/health', { timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function ensureDaemonRunning(client: DispatchClient): Promise<boolean> {
  if (await isDaemonRunning(client)) return true;

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Starting Dispatch daemon…',
      cancellable: false,
    },
    async (progress) => {
      let proc;
      try {
        proc = spawn('dispatch', ['--start'], {
          detached: true,
          stdio: 'ignore',
          shell: true,
          windowsHide: true,
        });
        proc.unref();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to launch \`dispatch --start\`: ${err.message ?? err}. ` +
          `Make sure the dispatch CLI is installed (npm link in the ghc-dispatch repo) and on your PATH.`
        );
        return false;
      }

      const start = Date.now();
      const timeoutMs = 30_000;
      while (Date.now() - start < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 1_000));
        progress.report({ message: `Waiting for http API on ${client['baseUrl' as keyof DispatchClient] ?? 'localhost:7878'}…` });
        if (await isDaemonRunning(client)) return true;
      }

      vscode.window.showWarningMessage(
        'Dispatch daemon did not become ready within 30s. Check the daemon logs (`dispatch --start` in a terminal) for details.'
      );
      return false;
    },
  );
}

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('dispatch');
  const apiUrl = config.get<string>('apiUrl', 'http://localhost:7878');
  const refreshInterval = config.get<number>('autoRefreshInterval', 5000);
  const autoStartDaemon = config.get<boolean>('autoStartDaemon', true);

  const client = new DispatchClient(apiUrl);

  const pendingDaemonStart = autoStartDaemon ? ensureDaemonRunning(client) : null;

  // --- TreeView Providers ---
  const taskTree = new TaskTreeProvider(client);
  const agentTree = new AgentTreeProvider(client);
  const skillTree = new SkillTreeProvider(client);
  const autoTree = new AutomationTreeProvider(client);
  const approvalTree = new ApprovalTreeProvider(client);
  const featureTree = new FeatureTreeProvider(client);

  const taskView = vscode.window.createTreeView('dispatch.tasks', { treeDataProvider: taskTree, showCollapseAll: true });
  const agentView = vscode.window.createTreeView('dispatch.agents', { treeDataProvider: agentTree });
  const skillView = vscode.window.createTreeView('dispatch.skills', { treeDataProvider: skillTree, showCollapseAll: true });
  const featureView = vscode.window.createTreeView('dispatch.features', { treeDataProvider: featureTree, showCollapseAll: true });
  const automationView = vscode.window.createTreeView('dispatch.automation', { treeDataProvider: autoTree });
  const approvalView = vscode.window.createTreeView('dispatch.approvals', { treeDataProvider: approvalTree });
  const dispatchViews = [taskView, agentView, skillView, featureView, automationView, approvalView];
  let lastFeatureCatalogOpenAt = 0;
  let lastDispatchRestoreAt = 0;
  const openFeatureCatalogFromActivityBar = () => {
    const now = Date.now();
    if (now - lastFeatureCatalogOpenAt < 1500) return;
    lastFeatureCatalogOpenAt = now;
    showFeatureDetail(client, handleFeatureAction);
  };
  const restoreDispatchContainer = () => {
    const now = Date.now();
    if (now - lastDispatchRestoreAt < 1000) return;
    lastDispatchRestoreAt = now;
    setTimeout(() => {
      if (!dispatchViews.some(view => view.visible)) {
        void vscode.commands.executeCommand('workbench.view.extension.dispatch');
      }
    }, 50);
  };

  for (const view of dispatchViews) {
    context.subscriptions.push(
      view,
      view.onDidChangeVisibility(event => {
        if (event.visible) {
          openFeatureCatalogFromActivityBar();
        } else {
          restoreDispatchContainer();
        }
      }),
    );
  }

  // --- Status Bar ---
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'dispatch.showStats';
  statusBar.text = '$(pulse) Dispatch';
  statusBar.tooltip = 'GHC Dispatch — click for stats';
  statusBar.show();
  context.subscriptions.push(statusBar);

  async function updateStatusBar() {
    try {
      const stats: any = await client.get('/api/stats');
      const running = stats.running ?? 0;
      const queued = stats.queue ?? 0;
      statusBar.text = `$(pulse) Dispatch: ${running} running, ${queued} queued`;
    } catch {
      statusBar.text = '$(pulse) Dispatch (offline)';
    }
  }

  // --- Auto-refresh ---
  let refreshInFlight = false;
  const refreshAll = async (includeStatic = false) => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await taskTree.fetchTasks();
      approvalTree.refresh();
      if (includeStatic) {
        featureTree.refresh();
        agentTree.refresh();
        skillTree.refresh();
        autoTree.refresh();
      }
      await updateStatusBar();
    } finally {
      refreshInFlight = false;
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        !event.affectsConfiguration('dispatch.maxConcurrentSessions')
        && !event.affectsConfiguration('dispatch.taskSessionIdleTimeoutMinutes')
      ) {
        return;
      }
      await syncExecutionSettingsFromVsCode(client, true);
      await refreshAll(true);
    }),
  );

  if (refreshInterval > 0) {
    const timer = setInterval(() => void refreshAll(false), refreshInterval);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });

    const staticTimer = setInterval(
      () => void refreshAll(true),
      Math.max(refreshInterval * 6, 30_000),
    );
    context.subscriptions.push({ dispose: () => clearInterval(staticTimer) });
  }

  // Initial load
  void syncExecutionSettingsFromVsCode(client, false);
  void refreshAll(true);
  setTimeout(() => void refreshAll(true), 2_000);
  setTimeout(() => void refreshAll(true), 10_000);

  if (pendingDaemonStart) {
    void pendingDaemonStart.then((ok) => {
      if (ok) void refreshAll(true);
    });
  }

  // --- SSE for real-time task updates ---
  sseDisconnect = client.createSseStream('/api/events/stream', (event) => {
    // Refresh tasks on state changes
    if (event.type?.startsWith('task.')) {
      void refreshAll(false);
    }
    // Show notification for approvals
    if (event.type === 'approval.requested') {
      showApprovalNotification(client, event, approvalTree);
    }
    // Notify on task completion/failure
    if (event.type === 'task.completed' || event.type === 'task.failed') {
      const icon = event.type === 'task.completed' ? '✅' : '❌';
      vscode.window.showInformationMessage(`${icon} Task ${event.taskId}: ${event.type.split('.')[1]}`);
    }
  });
  context.subscriptions.push({ dispose: () => { sseDisconnect?.(); } });

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('dispatch.refreshTasks', () => void refreshAll(true)),

    vscode.commands.registerCommand('dispatch.openChat', () => {
      showDispatchChat(client);
    }),

    vscode.commands.registerCommand('dispatch.openFeatureCatalog', () => {
      showFeatureDetail(client, handleFeatureAction);
    }),

    vscode.commands.registerCommand('dispatch.openFeatureDetail', (arg?: string | FeatureItem) => {
      const featureId = typeof arg === 'string' ? arg : arg?.featureId;
      showFeatureDetail(client, handleFeatureAction, featureId);
    }),

    vscode.commands.registerCommand('dispatch.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'dispatch');
    }),

    vscode.commands.registerCommand('dispatch.configureTaskRuntime', async () => {
      await configureTaskRuntime(client);
    }),

    vscode.commands.registerCommand('dispatch.configureExecutionSettings', async () => {
      await configureExecutionSettings(client);
      await refreshAll(true);
    }),

    vscode.commands.registerCommand('dispatch.configureWorkIQ', async () => {
      await configureWorkIQ(client);
      await refreshAll(true);
    }),

    vscode.commands.registerCommand('dispatch.switchModel', async () => {
      await switchModel(client);
      refreshAll();
    }),

    vscode.commands.registerCommand('dispatch.resetAgentModel', async () => {
      await resetAgentModel(client);
      refreshAll();
    }),

    vscode.commands.registerCommand('dispatch.reload', async () => {
      await client.post('/api/reload');
      vscode.window.showInformationMessage('Dispatch agents and skills reloaded');
      refreshAll();
    }),

    vscode.commands.registerCommand('dispatch.restartDaemon', async () => {
      const confirm = await vscode.window.showWarningMessage('Restart the Dispatch daemon?', { modal: true }, 'Restart');
      if (confirm !== 'Restart') return;
      await client.post('/api/restart');
      vscode.window.showInformationMessage('Dispatch daemon restart requested');
    }),

    vscode.commands.registerCommand('dispatch.updateDaemon', async () => {
      const confirm = await vscode.window.showWarningMessage('Run Dispatch self-update?', { modal: true }, 'Update');
      if (confirm !== 'Update') return;
      const result: any = await client.post('/api/update');
      vscode.window.showInformationMessage(result.message ?? 'Dispatch update requested');
    }),

    vscode.commands.registerCommand('dispatch.openAgentConfig', async (item?: AgentItem) => {
      await openAgentConfig(client, item);
    }),

    vscode.commands.registerCommand('dispatch.createAgent', async () => {
      await createAgent(client, agentTree);
    }),

    vscode.commands.registerCommand('dispatch.createAgentTeam', async () => {
      await createAgentTeam(client, agentTree);
    }),

    vscode.commands.registerCommand('dispatch.runAgentTeam', async (item?: AgentItem) => {
      await runAgentTeam(client, taskTree, item);
    }),

    vscode.commands.registerCommand('dispatch.openTeamConfig', async (item?: AgentItem) => {
      await openTeamConfig(client, item);
    }),

    vscode.commands.registerCommand('dispatch.openSkillConfig', async (item?: SkillItem) => {
      await openSkillConfig(client, item);
    }),

    vscode.commands.registerCommand('dispatch.installSkillFromGitHub', async () => {
      await installSkill(client, skillTree);
    }),

    vscode.commands.registerCommand('dispatch.installSkillFromRegistry', async () => {
      await installSkillFromSkillsSh(client, skillTree);
    }),

    vscode.commands.registerCommand('dispatch.createSkill', async () => {
      await createSkill(client, skillTree);
    }),

    vscode.commands.registerCommand('dispatch.createAutomationJob', async () => {
      await createAutomationJob(client, autoTree);
    }),

    vscode.commands.registerCommand('dispatch.createTask', async () => {
      await showTaskForm(client, undefined, () => taskTree.fetchTasks());
    }),

    vscode.commands.registerCommand('dispatch.showStats', async () => {
      try {
        const stats: any = await client.get('/api/stats');
        const memStats: any = await client.get('/api/memory/stats');
        const lines = [
          `**Tasks:** ${JSON.stringify(stats.tasks)}`,
          `**Queue:** ${stats.queue} | **Running:** ${stats.running}`,
          `**Sessions:** ${stats.sessions?.active}/${(stats.sessions?.active ?? 0) + (stats.sessions?.available ?? 0)}`,
          `**Pending Approvals:** ${stats.pendingApprovals}`,
          `**Memory:** ${memStats.totalMessages} messages, ${memStats.totalFacts} facts, ${memStats.totalEntities} entities`,
        ];
        vscode.window.showInformationMessage(lines.join(' | '));
      } catch (err: any) {
        vscode.window.showErrorMessage(`Cannot reach dispatch daemon: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('dispatch.recall', async () => {
      const query = await vscode.window.showInputBox({ prompt: 'What do you want to recall?', placeHolder: 'authentication tokens' });
      if (!query) return;

      try {
        const suggestions: any[] = await client.post('/api/memory/suggest', { message: query, channel: 'vscode' });
        if (suggestions.length === 0) {
          vscode.window.showInformationMessage('No memories found.');
          return;
        }

        const items = suggestions.map(s => ({
          label: `[${s.type}] ${s.source}`,
          detail: s.content.slice(0, 200),
          description: s.channel ? `(${s.channel})` : '',
        }));

        await vscode.window.showQuickPick(items, { placeHolder: `${suggestions.length} memories found` });
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    }),

    vscode.commands.registerCommand('dispatch.openTaskDetail', (arg: string | TaskItem) => {
      const taskId = typeof arg === 'string' ? arg : arg?.taskId;
      if (!taskId) return;
      showTaskDetail(client, taskId);
    }),

    vscode.commands.registerCommand('dispatch.editTask', async (arg: string | TaskItem) => {
      const taskId = typeof arg === 'string' ? arg : arg?.taskId;
      if (!taskId) return;
      await showTaskForm(client, taskId, () => taskTree.fetchTasks());
    }),

    vscode.commands.registerCommand('dispatch.cancelTask', async (item: TaskItem) => {
      if (!item?.taskId) return;
      await client.post(`/api/tasks/${item.taskId}/cancel`);
      vscode.window.showInformationMessage(`Task ${item.taskId} cancelled`);
      taskTree.fetchTasks();
    }),

    vscode.commands.registerCommand('dispatch.deleteTask', async (item: TaskItem) => {
      if (!item?.taskId) return;
      await deleteTask(client, taskTree, item);
    }),

    vscode.commands.registerCommand('dispatch.retryTask', async (item: TaskItem) => {
      if (!item?.taskId) return;
      await client.post(`/api/tasks/${item.taskId}/retry`);
      vscode.window.showInformationMessage(`Task ${item.taskId} retried`);
      taskTree.fetchTasks();
    }),

    vscode.commands.registerCommand('dispatch.enqueueTask', async (item: TaskItem) => {
      if (!item?.taskId) return;
      await client.post(`/api/tasks/${item.taskId}/enqueue`);
      vscode.window.showInformationMessage(`Task ${item.taskId} enqueued`);
      taskTree.fetchTasks();
    }),

    vscode.commands.registerCommand('dispatch.approveApproval', async (item: ApprovalItem) => {
      if (!item?.approvalId) return;
      await client.post(`/api/approvals/${item.approvalId}/approve`, { decidedBy: 'vscode-user' });
      vscode.window.showInformationMessage(`Approval ${item.approvalId} approved`);
      approvalTree.refresh();
    }),

    vscode.commands.registerCommand('dispatch.rejectApproval', async (item: ApprovalItem) => {
      if (!item?.approvalId) return;
      await client.post(`/api/approvals/${item.approvalId}/reject`, { decidedBy: 'vscode-user' });
      vscode.window.showInformationMessage(`Approval ${item.approvalId} rejected`);
      approvalTree.refresh();
    }),

    vscode.commands.registerCommand('dispatch.enableSkill', async (item: SkillItem) => {
      if (!item?.skillId) return;
      await client.post(`/api/skills/${item.skillId}/enable`);
      skillTree.refresh();
    }),

    vscode.commands.registerCommand('dispatch.disableSkill', async (item: SkillItem) => {
      if (!item?.skillId) return;
      await client.post(`/api/skills/${item.skillId}/disable`);
      skillTree.refresh();
    }),

    vscode.commands.registerCommand('dispatch.openMemory', async () => {
      // Quick pick for memory exploration
      const choice = await vscode.window.showQuickPick([
        { label: '$(search) Search Facts', description: 'Search extracted knowledge', value: 'facts' },
        { label: '$(book) Entity Profiles', description: 'Browse known entities', value: 'entities' },
        { label: '$(history) Recent Episodes', description: 'Conversation summaries', value: 'episodes' },
        { label: '$(comment-discussion) Recent Conversations', description: 'Cross-channel messages', value: 'conversations' },
      ], { placeHolder: 'What would you like to explore?' });

      if (!choice) return;

      if (choice.value === 'facts') {
        const q = await vscode.window.showInputBox({ prompt: 'Search facts' });
        if (!q) return;
        const facts: any[] = await client.get(`/api/memory/facts?q=${encodeURIComponent(q)}`);
        const items = facts.map(f => ({ label: f.entitySlug, detail: f.fact, description: f.entityType }));
        await vscode.window.showQuickPick(items, { placeHolder: `${facts.length} facts found` });
      } else if (choice.value === 'entities') {
        const entities: any[] = await client.get('/api/memory/entities');
        const items = entities.map(e => ({ label: e.entitySlug, description: `${e.entityType} · ${e.factCount} facts` }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select entity for profile' });
        if (picked) {
          const profile: any = await client.get(`/api/memory/profile/${picked.label}`);
          vscode.window.showInformationMessage(profile.profile || 'No profile data');
        }
      } else if (choice.value === 'episodes') {
        const episodes: any[] = await client.get('/api/memory/episodes?limit=10');
        const items = episodes.map(e => ({ label: `${e.date} — ${e.channel}`, detail: e.summary.slice(0, 200), description: `${e.messageCount} msgs` }));
        await vscode.window.showQuickPick(items, { placeHolder: `${episodes.length} recent episodes` });
      } else {
        const msgs: any[] = await client.get('/api/conversations?limit=30');
        const items = msgs.map(m => ({ label: `[${m.channel}] ${m.speaker}`, detail: m.content.slice(0, 150), description: new Date(m.timestamp).toLocaleTimeString() }));
        await vscode.window.showQuickPick(items, { placeHolder: `${msgs.length} recent messages` });
      }
    }),

    vscode.commands.registerCommand('dispatch.runBrowserCommand', async () => {
      const command = await vscode.window.showInputBox({
        prompt: 'Browser automation command',
        placeHolder: 'Go to https://example.com and summarize the page',
      });
      if (!command) return;
      const result: any = await client.post('/api/browser/command', { command });
      const message = result.success
        ? result.description ?? 'Browser command completed'
        : result.error ?? result.description ?? 'Browser command failed';
      vscode.window.showInformationMessage(message);
    }),

    vscode.commands.registerCommand('dispatch.showCheckIn', async () => {
      const result: any = await client.get('/api/checkin');
      vscode.window.showInformationMessage(result.formatted ?? 'No check-in messages.');
    }),
  );

  async function handleFeatureAction(actionId: string) {
    const commandMap: Record<string, string> = {
      'tasks.create': 'dispatch.createTask',
      'tasks.refresh': 'dispatch.refreshTasks',
      'tasks.configureExecution': 'dispatch.configureExecutionSettings',
      'taskRuntime.configure': 'dispatch.configureTaskRuntime',
      'workiq.configure': 'dispatch.configureWorkIQ',
      'features.openFullCatalog': 'dispatch.openFeatureCatalog',
      'agents.create': 'dispatch.createAgent',
      'agents.openConfig': 'dispatch.openAgentConfig',
      'teams.create': 'dispatch.createAgentTeam',
      'teams.run': 'dispatch.runAgentTeam',
      'skills.create': 'dispatch.createSkill',
      'skills.installRegistry': 'dispatch.installSkillFromRegistry',
      'skills.installGitHub': 'dispatch.installSkillFromGitHub',
      'automation.create': 'dispatch.createAutomationJob',
      'approvals.refresh': 'dispatch.refreshTasks',
      'models.switch': 'dispatch.switchModel',
      'models.reset': 'dispatch.resetAgentModel',
      'chat.open': 'dispatch.openChat',
      'memory.open': 'dispatch.openMemory',
      'browser.runCommand': 'dispatch.runBrowserCommand',
      'checkin.show': 'dispatch.showCheckIn',
      'system.openSettings': 'dispatch.openSettings',
      'system.reload': 'dispatch.reload',
      'system.restart': 'dispatch.restartDaemon',
      'system.update': 'dispatch.updateDaemon',
    };
    const command = commandMap[actionId];
    if (!command) {
      vscode.window.showWarningMessage(`No VS Code action is registered for feature action ${actionId}`);
      return;
    }
    await vscode.commands.executeCommand(command);
    refreshAll();
  }

  console.log('GHC Dispatch extension activated');
}

function hasConfiguredDispatchSetting(name: string): boolean {
  const inspected = vscode.workspace.getConfiguration('dispatch').inspect(name);
  return inspected?.globalValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.workspaceFolderValue !== undefined;
}

async function syncExecutionSettingsFromVsCode(client: DispatchClient, notify: boolean) {
  const config = vscode.workspace.getConfiguration('dispatch');
  const patch: Record<string, number> = {};

  if (hasConfiguredDispatchSetting('maxConcurrentSessions')) {
    const maxConcurrentSessions = config.get<number>('maxConcurrentSessions');
    if (typeof maxConcurrentSessions === 'number') patch.maxConcurrentSessions = maxConcurrentSessions;
  }

  if (hasConfiguredDispatchSetting('taskSessionIdleTimeoutMinutes')) {
    const timeoutMinutes = config.get<number>('taskSessionIdleTimeoutMinutes');
    if (typeof timeoutMinutes === 'number') patch.taskSessionIdleTimeoutMs = Math.round(timeoutMinutes * 60_000);
  }

  if (Object.keys(patch).length === 0) return;

  const updated: any = await client.post('/api/execution/settings', patch);
  if (notify) vscode.window.showInformationMessage(updated.message ?? 'Dispatch execution settings updated');
}

async function configureExecutionSettings(client: DispatchClient) {
  const payload: any = await client.get('/api/execution/settings');
  const maxSessionsInput = await vscode.window.showInputBox({
    prompt: 'Maximum Dispatch task sessions to run concurrently',
    placeHolder: '1-16',
    value: String(payload.settings?.maxConcurrentSessions ?? payload.sessions?.limit ?? 4),
    validateInput: value => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 16 ? undefined : 'Enter an integer from 1 to 16';
    },
  });
  if (maxSessionsInput === undefined) return;

  const timeoutMinutesInput = await vscode.window.showInputBox({
    prompt: 'Task session idle timeout in minutes',
    placeHolder: '5-120',
    value: String(Math.round((payload.settings?.taskSessionIdleTimeoutMs ?? 300_000) / 60_000)),
    validateInput: value => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120 ? undefined : 'Enter an integer from 1 to 120';
    },
  });
  if (timeoutMinutesInput === undefined) return;

  const updated: any = await client.post('/api/execution/settings', {
    maxConcurrentSessions: Number(maxSessionsInput),
    taskSessionIdleTimeoutMs: Number(timeoutMinutesInput) * 60_000,
  });
  const config = vscode.workspace.getConfiguration('dispatch');
  await config.update('maxConcurrentSessions', Number(maxSessionsInput), vscode.ConfigurationTarget.Global);
  await config.update('taskSessionIdleTimeoutMinutes', Number(timeoutMinutesInput), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    updated.message ?? `Max concurrent sessions set to ${maxSessionsInput}; task idle timeout set to ${timeoutMinutesInput} minute(s)`,
  );
}

async function configureWorkIQ(client: DispatchClient) {
  const payload: any = await client.get('/api/task-runtime/config');
  const enabled = payload.integrations?.workiq?.enabled === true;
  const configured = payload.integrations?.workiq?.configured === true;
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Enable WorkIQ for task sessions', value: true, picked: !enabled },
      { label: 'Disable WorkIQ for task sessions', value: false, picked: enabled },
    ],
    { placeHolder: enabled ? 'WorkIQ is currently enabled' : 'WorkIQ is currently disabled' },
  );
  if (!picked) return;
  let server: any | undefined;
  if (picked.value && !configured) {
    const command = await vscode.window.showInputBox({
      prompt: 'WorkIQ MCP command. Leave blank to rely on Copilot project config discovery.',
      placeHolder: 'npx',
    });
    if (command === undefined) return;
    if (command.trim()) {
      const args = await vscode.window.showInputBox({
        prompt: 'WorkIQ MCP command arguments',
        placeHolder: '-y package-name',
        value: '',
      });
      if (args === undefined) return;
      server = {
        type: 'local',
        command: command.trim(),
        args: args.split(/\s+/).filter(Boolean),
        tools: ['*'],
      };
    }
  }
  const updated: any = await client.post('/api/integrations/workiq', { enabled: picked.value, server });
  vscode.window.showInformationMessage(updated.message ?? 'WorkIQ configuration updated');
}

async function switchModel(client: DispatchClient) {
  const models: any = await client.get('/api/models');
  const targets = [
    { label: 'Default model', value: undefined },
    { label: 'Dispatch Chat', value: 'dispatch-chat' },
    ...Object.keys(models.agentOverrides ?? {}).map(agent => ({ label: `Agent override: ${agent}`, value: agent })),
    { label: 'Choose agent...', value: 'choose-agent' },
  ];
  const target = await vscode.window.showQuickPick(targets, { placeHolder: 'Switch model for default or agent?' });
  if (!target) return;

  let agent = target.value;
  if (agent === 'choose-agent') {
    const agents: any[] = await client.get('/api/agents');
    const picked = await vscode.window.showQuickPick(agents.map(a => a.name), { placeHolder: 'Select agent' });
    if (!picked) return;
    agent = picked;
  }

  const modelItems: vscode.QuickPickItem[] = models.available.map((m: any) => ({
    label: m.id,
    description: `${m.provider} · ${m.tier}`,
    detail: m.name,
  }));
  const pickedModel = await vscode.window.showQuickPick(
    modelItems,
    { placeHolder: `Current default: ${models.current}` },
  );
  if (!pickedModel) return;

  if (agent === 'dispatch-chat') {
    const result: any = await client.post('/api/chat/model', { model: pickedModel.label });
    vscode.window.showInformationMessage(result.message ?? `Dispatch Chat switched to ${pickedModel.label}`);
    return;
  }

  const result: any = await client.post('/api/models/switch', { model: pickedModel.label, agent });
  vscode.window.showInformationMessage(result.message ?? `Switched model to ${pickedModel.label}`);
}

async function resetAgentModel(client: DispatchClient) {
  const models: any = await client.get('/api/models');
  const overrides = Object.keys(models.agentOverrides ?? {});
  const targets = [
    ...(models.chatModelOverride ? [{ label: 'Dispatch Chat override', value: 'dispatch-chat' }] : []),
    ...overrides.map(agent => ({ label: agent, value: agent })),
  ];
  if (targets.length === 0) {
    vscode.window.showInformationMessage('No Dispatch Chat or agent model overrides configured.');
    return;
  }
  const picked = await vscode.window.showQuickPick(targets, { placeHolder: 'Reset which model override?' });
  if (!picked) return;
  if (picked.value === 'dispatch-chat') {
    const result: any = await client.post('/api/chat/model', { model: 'default' });
    vscode.window.showInformationMessage(result.message ?? 'Dispatch Chat model override cleared');
    return;
  }
  const result: any = await client.post('/api/models/reset', { agent: picked.value });
  vscode.window.showInformationMessage(result.message ?? `Reset ${picked.value}`);
}

async function configureTaskRuntime(client: DispatchClient) {
  const payload: any = await client.get('/api/task-runtime/config');
  const config = payload.config ?? {};
  const choice = await vscode.window.showQuickPick([
    {
      label: '$(gear) Toggle project config discovery',
      description: config.enableConfigDiscovery ? 'Currently on' : 'Currently off',
      value: 'discovery',
    },
    {
      label: '$(extensions) Configure skills for tasks',
      description: `${payload.skills?.filter((s: any) => s.disabledForTasks).length ?? 0} disabled for task sessions`,
      value: 'skills',
    },
    {
      label: '$(plug) Configure MCP servers for tasks',
      description: `${payload.mcpServers?.filter((s: any) => s.disabledForTasks).length ?? 0} disabled for task sessions`,
      value: 'mcp',
    },
    {
      label: '$(tools) Configure excluded tools',
      description: (config.excludedTools ?? []).join(', ') || 'No explicit exclusions',
      value: 'tools',
    },
    {
      label: '$(file-code) Open runtime config file',
      description: payload.configPath,
      value: 'open',
    },
    {
      label: '$(discard) Reset to autopilot defaults',
      description: 'Enable full Copilot CLI-style capabilities again',
      value: 'reset',
    },
  ], { placeHolder: 'Configure Dispatch task runtime capabilities' });
  if (!choice) return;

  if (choice.value === 'discovery') {
    const updated: any = await client.post('/api/task-runtime/config', {
      enableConfigDiscovery: !config.enableConfigDiscovery,
    });
    vscode.window.showInformationMessage(
      updated.config.enableConfigDiscovery
        ? 'Task runtime project config discovery enabled'
        : 'Task runtime project config discovery disabled',
    );
    return;
  }

  if (choice.value === 'skills') {
    const skills = (payload.skills ?? []) as any[];
    if (skills.length === 0) {
      vscode.window.showInformationMessage('No skills are installed.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      skills.map(skill => ({
        label: skill.name,
        description: skill.enabled ? 'Installed' : 'Disabled globally',
        picked: skill.disabledForTasks,
      })),
      { placeHolder: 'Select skills to turn off for Dispatch task sessions', canPickMany: true },
    );
    if (!picked) return;
    const updated: any = await client.post('/api/task-runtime/config', {
      disabledSkills: picked.map(item => item.label),
    });
    vscode.window.showInformationMessage(`${updated.config.disabledSkills.length} skill(s) turned off for task sessions`);
    return;
  }

  if (choice.value === 'mcp') {
    const servers = (payload.mcpServers ?? []) as any[];
    if (servers.length === 0) {
      vscode.window.showInformationMessage(`No explicit MCP servers are configured. Add servers in ${payload.configPath} or via project .mcp.json discovery.`);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      servers.map(server => ({
        label: server.name,
        picked: server.disabledForTasks,
      })),
      { placeHolder: 'Select MCP servers to turn off for Dispatch task sessions', canPickMany: true },
    );
    if (!picked) return;
    const updated: any = await client.post('/api/task-runtime/config', {
      disabledMcpServers: picked.map(item => item.label),
    });
    vscode.window.showInformationMessage(`${updated.config.disabledMcpServers.length} MCP server(s) turned off for task sessions`);
    return;
  }

  if (choice.value === 'tools') {
    const current = (config.excludedTools ?? []).join(', ');
    const input = await vscode.window.showInputBox({
      prompt: 'Comma-separated Copilot CLI tool names to exclude from Dispatch task sessions',
      placeHolder: 'shell, edit_file, web_fetch',
      value: current,
    });
    if (input === undefined) return;
    const excludedTools = input.split(',').map(part => part.trim()).filter(Boolean);
    const updated: any = await client.post('/api/task-runtime/config', { excludedTools });
    vscode.window.showInformationMessage(`${updated.config.excludedTools.length} tool exclusion(s) configured`);
    return;
  }

  if (choice.value === 'open') {
    await vscode.window.showTextDocument(vscode.Uri.file(payload.configPath));
    return;
  }

  if (choice.value === 'reset') {
    const confirm = await vscode.window.showWarningMessage('Reset task runtime to Copilot CLI autopilot defaults?', { modal: true }, 'Reset');
    if (confirm !== 'Reset') return;
    const updated: any = await client.post('/api/task-runtime/config/reset');
    vscode.window.showInformationMessage(updated.message ?? 'Task runtime reset');
  }
}

async function deleteTask(client: DispatchClient, taskTree: TaskTreeProvider, item: TaskItem) {
  const confirm = await vscode.window.showWarningMessage(
    `Permanently delete task "${item.label}"? This removes its Dispatch record, approvals, checkpoints, events, and captured artifacts.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;

  try {
    const result: any = await client.del(`/api/tasks/${encodeURIComponent(item.taskId)}`);
    const count = result.deletedTaskIds?.length ?? 1;
    vscode.window.showInformationMessage(count > 1 ? `Deleted ${count} tasks` : `Deleted task ${item.taskId}`);
    await taskTree.fetchTasks();
  } catch (err: any) {
    const message = err?.message ?? String(err);
    if (!message.includes('subtask')) {
      vscode.window.showErrorMessage(`Failed to delete task: ${message}`);
      return;
    }

    const recursiveConfirm = await vscode.window.showWarningMessage(
      `${message} Delete the task and all of its subtasks?`,
      { modal: true },
      'Delete All',
    );
    if (recursiveConfirm !== 'Delete All') return;

    const result: any = await client.del(`/api/tasks/${encodeURIComponent(item.taskId)}?recursive=true`);
    const count = result.deletedTaskIds?.length ?? 1;
    vscode.window.showInformationMessage(`Deleted ${count} tasks`);
    await taskTree.fetchTasks();
  }
}

async function openAgentConfig(client: DispatchClient, item?: AgentItem) {
  let agentName = item?.agentName;
  if (!agentName) {
    const agents: any[] = await client.get('/api/agents');
    const picked = await vscode.window.showQuickPick(
      agents.map(a => ({ label: a.name, description: a.model, detail: a.description })),
      { placeHolder: 'Open agent config' },
    );
    agentName = picked?.label;
  }
  if (!agentName) return;

  const detail: any = await client.get(`/api/agents/${encodeURIComponent(agentName)}/content`);
  if (detail.filePath) {
    await vscode.window.showTextDocument(vscode.Uri.file(detail.filePath));
    return;
  }

  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: detail.content });
  await vscode.window.showTextDocument(doc);
}

async function createAgent(client: DispatchClient, agentTree: AgentTreeProvider) {
  const description = await vscode.window.showInputBox({
    prompt: 'Describe what you want this agent to do or be',
    placeHolder: 'A gameplay designer who creates mechanics, level progression, and playtest plans',
  });
  if (!description) return;
  const models: any = await client.get('/api/models');
  const modelItems: vscode.QuickPickItem[] = models.available.map((m: any) => ({
    label: m.id,
    description: `${m.provider} · ${m.tier}`,
  }));
  const model = await vscode.window.showQuickPick(
    modelItems,
    { placeHolder: 'Copilot model to generate the agent definition' },
  );

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Generating Dispatch agent with Copilot...',
    cancellable: false,
  }, async () => {
    const agent: any = await client.post('/api/agents/generate', {
      description,
      model: model?.label,
    });
    vscode.window.showInformationMessage(`Created agent ${agent.name}`);
    agentTree.refresh();
    if (agent.filePath) await vscode.window.showTextDocument(vscode.Uri.file(agent.filePath));
  });
}

async function createAgentManually(client: DispatchClient, agentTree: AgentTreeProvider) {
  const name = await vscode.window.showInputBox({ prompt: 'Agent name', placeHolder: 'Gameplay Designer' });
  if (!name) return;
  const description = await vscode.window.showInputBox({ prompt: 'Agent description', placeHolder: 'Designs game mechanics and level progression' });
  if (!description) return;
  const systemPrompt = await vscode.window.showInputBox({ prompt: 'System prompt / operating instructions' });
  if (!systemPrompt) return;
  const agent: any = await client.post('/api/agents', {
    name,
    description,
    systemPrompt,
  });
  vscode.window.showInformationMessage(`Created agent ${agent.name}`);
  agentTree.refresh();
  if (agent.filePath) await vscode.window.showTextDocument(vscode.Uri.file(agent.filePath));
}

async function createAgentTeam(client: DispatchClient, agentTree: AgentTreeProvider) {
  const name = await vscode.window.showInputBox({ prompt: 'Team name', placeHolder: 'Game Creation Team' });
  if (!name) return;
  const description = await vscode.window.showInputBox({ prompt: 'Team description', placeHolder: 'Plans and builds playable game prototypes' }) ?? '';
  const domain = await vscode.window.showInputBox({ prompt: 'Team domain / business context', placeHolder: 'Video game development, cloud platform engineering, content strategy...' }) ?? '';
  const teamFunction = await vscode.window.showInputBox({ prompt: 'Team function', placeHolder: 'What this team is responsible for delivering' }) ?? description;
  const operatingModel = await vscode.window.showInputBox({ prompt: 'Operating model', placeHolder: 'How the team lead should plan, delegate, review, and hand off work' }) ?? '';
  const agents: any[] = await client.get('/api/agents');

  const leadMode = await vscode.window.showQuickPick(
    [
      { label: 'Generate a team-specific orchestrator', value: 'generate' },
      { label: 'Use an existing agent as team lead', value: 'existing' },
    ],
    { placeHolder: 'Team lead / orchestrator' },
  );
  if (!leadMode) return;

  let lead: { label: string; description?: string; detail?: string } | undefined;
  let availableAgents = agents;
  if (leadMode.value === 'generate') {
    const models: any = await client.get('/api/models');
    const model = await vscode.window.showQuickPick<vscode.QuickPickItem>(
      models.available.map((m: any) => ({ label: m.id, description: `${m.provider} · ${m.tier}` })),
      { placeHolder: 'Copilot model to generate the team orchestrator' },
    );
    const generated: any = await client.post('/api/agents/generate', {
      description: [
        `Create a team-specific orchestrator / team lead for "${name}".`,
        `Team description: ${description}`,
        `Domain: ${domain}`,
        `Function: ${teamFunction}`,
        `Operating model: ${operatingModel}`,
        'This lead should understand the team business context, route work to specialists, coordinate plans, review outputs, and produce executive-ready handoffs.',
      ].join('\n'),
      model: model?.label,
      teamType: domain || name,
      teamRole: 'team-lead',
    });
    lead = { label: generated.name, description: generated.model, detail: generated.description };
    availableAgents = await client.get('/api/agents');
  } else {
    if (availableAgents.length === 0) {
      vscode.window.showErrorMessage('Create at least one agent before creating a team.');
      return;
    }
    lead = await vscode.window.showQuickPick(
      availableAgents.map(a => ({ label: a.name, description: a.model, detail: a.description })),
      { placeHolder: 'Select team lead' },
    );
  }
  if (!lead) return;

  const members = await vscode.window.showQuickPick(
    availableAgents.filter(a => a.name !== lead.label).map(a => ({ label: a.name, description: a.model, detail: a.description })),
    { placeHolder: 'Select team members', canPickMany: true },
  );
  if (!members || members.length === 0) {
    vscode.window.showErrorMessage('Select at least one member agent.');
    return;
  }

  const team: any = await client.post('/api/teams', {
    name,
    description,
    leadAgent: lead.label,
    memberAgents: members.map(m => m.label),
    metadata: {
      domain,
      function: teamFunction,
      operatingModel,
      leadMode: leadMode.value,
    },
  });
  vscode.window.showInformationMessage(`Created agent team ${team.name}`);
  agentTree.refresh();
}

async function runAgentTeam(client: DispatchClient, taskTree: TaskTreeProvider, item?: AgentItem) {
  let teamId = item?.teamId;
  if (!teamId) {
    const teams: any[] = await client.get('/api/teams');
    const picked = await vscode.window.showQuickPick(
      teams.map(t => ({ label: t.name, description: `Lead: ${t.leadAgent}`, detail: t.description, id: t.id })),
      { placeHolder: 'Select team to run' },
    );
    teamId = picked?.id;
  }
  if (!teamId) return;

  const title = await vscode.window.showInputBox({ prompt: 'Team goal', placeHolder: 'Build a prototype platformer game' });
  if (!title) return;
  const description = await vscode.window.showInputBox({ prompt: 'Additional context', placeHolder: 'Constraints, audience, deliverables...' }) ?? '';
  const repo = await vscode.window.showInputBox({ prompt: 'Optional repository path', placeHolder: 'C:\\path\\to\\repo' });
  const approval = await vscode.window.showQuickPick(
    [
      { label: 'Require approval before execution', preApproved: false },
      { label: 'Pre-approved for execution', preApproved: true },
    ],
    { placeHolder: 'Execution approval for generated team tasks' },
  );

  const result: any = await client.post(`/api/teams/${teamId}/run`, {
    title,
    description,
    repo: repo || undefined,
    preApproved: approval?.preApproved === true,
  });
  vscode.window.showInformationMessage(`Created team run: lead task ${result.leadTask.id}, ${result.memberTasks.length} member tasks`);
  taskTree.fetchTasks();
}

async function openTeamConfig(client: DispatchClient, item?: AgentItem) {
  let teamId = item?.teamId;
  if (!teamId) {
    const teams: any[] = await client.get('/api/teams');
    const picked = await vscode.window.showQuickPick(
      teams.map(t => ({ label: t.name, description: `Lead: ${t.leadAgent}`, detail: t.description, id: t.id })),
      { placeHolder: 'Open team config' },
    );
    teamId = picked?.id;
  }
  if (!teamId) return;

  const team: any = await client.get(`/api/teams/${teamId}`);
  const agents: any[] = await client.get('/api/agents');
  const agentsByName = new Map(agents.map(agent => [agent.name, agent]));
  const describeAgent = (agentName: string) => {
    const agent = agentsByName.get(agentName);
    return [
      `### ${agentName}`,
      '',
      agent?.description ? agent.description : 'No description available.',
      '',
      `- **Role:** ${agentName === team.leadAgent ? 'Team lead' : 'Team member'}`,
      `- **Model:** ${agent?.model ?? 'Unknown'}`,
      agent?.filePath ? `- **Config:** \`${agent.filePath}\`` : '',
    ].filter(Boolean).join('\n');
  };

  const content = [
    `# ${team.name}`,
    '',
    '## Team Configuration',
    '',
    `- **ID:** ${team.id}`,
    `- **Lead:** ${team.leadAgent}`,
    `- **Members:** ${team.memberAgents.join(', ') || 'None'}`,
    `- **Created:** ${new Date(team.createdAt).toLocaleString()}`,
    `- **Updated:** ${new Date(team.updatedAt).toLocaleString()}`,
    '',
    '## Description',
    '',
    team.description || 'No description has been configured for this team.',
    '',
    '## Function',
    '',
    team.metadata?.function
      ? String(team.metadata.function)
      : team.description
      ? team.description
      : 'No explicit team function has been configured yet. Update the team description to document its function.',
    '',
    '## Domain / Business Context',
    '',
    team.metadata?.domain ? String(team.metadata.domain) : 'No team domain has been configured.',
    '',
    '## Operating Model',
    '',
    team.metadata?.operatingModel ? String(team.metadata.operatingModel) : 'No operating model has been configured.',
    '',
    '## Routing Rules',
    '',
    '- The team lead owns plan quality, sequencing, delegation, review, and final handoff.',
    '- Member agents should work within the team domain and return explicit assumptions, outputs, validation notes, and blockers.',
    '- If a task falls outside the team function, the lead should call that out and recommend a different team or agent.',
    '',
    '## Required Deliverables',
    '',
    '- Lead plan with owners, milestones, validation criteria, risks, and dependencies.',
    '- Member outputs with artifacts or notes tied back to the lead plan.',
    '- Final handoff that summarizes what changed, where artifacts were produced, and what remains.',
    '',
    '## Team Lead',
    '',
    describeAgent(team.leadAgent),
    '',
    '## Team Members',
    '',
    team.memberAgents.length
      ? team.memberAgents.map(describeAgent).join('\n\n')
      : 'No member agents have been configured.',
    '',
    '## Metadata',
    '',
    '```json',
    JSON.stringify(team.metadata ?? {}, null, 2),
    '```',
    '',
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content,
  });
  await vscode.window.showTextDocument(doc);
}

async function openSkillConfig(client: DispatchClient, item?: SkillItem) {
  let skillId = item?.skillId;
  let dirPath = item?.dirPath;
  if (!skillId) {
    const data: any = await client.get('/api/skills');
    const skills = [...(data.userInstalled ?? []), ...(data.systemCreated ?? [])];
    const picked = await vscode.window.showQuickPick(
      skills.map((s: any) => ({ label: s.id, description: s.origin, detail: s.description, dirPath: s.dirPath })),
      { placeHolder: 'Open skill config' },
    );
    skillId = picked?.label;
    dirPath = picked?.dirPath;
  }
  if (!skillId) return;

  if (dirPath) {
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(dirPath, 'SKILL.md')));
    return;
  }

  const detail: any = await client.get(`/api/skills/${skillId}/content`);
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: detail.content });
  await vscode.window.showTextDocument(doc);
}

async function installSkill(client: DispatchClient, skillTree: SkillTreeProvider) {
  const sourceType = await vscode.window.showQuickPick(
    [
      { label: 'skills.sh', description: 'Install from a skills.sh page, command, or owner/repo/skill spec' },
      { label: 'GitHub', description: 'Install from a GitHub repository URL' },
    ],
    { placeHolder: 'Install skill from where?' },
  );
  if (!sourceType) return;

  if (sourceType.label === 'skills.sh') {
    await installSkillFromSkillsSh(client, skillTree);
    return;
  }

  const repoUrl = await vscode.window.showInputBox({ prompt: 'GitHub skill repository URL', placeHolder: 'https://github.com/org/repo.git' });
  if (!repoUrl) return;
  const name = await vscode.window.showInputBox({
    prompt: 'Optional local skill name or skill subdirectory name',
    placeHolder: 'my-skill',
  });
  const skill: any = await client.post('/api/skills/install/github', { repoUrl, name: name || undefined });
  vscode.window.showInformationMessage(`Installed skill: ${skill.name}`);
  skillTree.refresh();
}

async function installSkillFromSkillsSh(client: DispatchClient, skillTree: SkillTreeProvider) {
  const source = await vscode.window.showInputBox({
    prompt: 'skills.sh URL, install command, or owner/repo/skill spec',
    placeHolder: 'https://skills.sh/microsoft/azure-skills/azure-ai',
  });
  if (!source) return;
  const skill: any = await client.post('/api/skills/install/skills-sh', { source });
  vscode.window.showInformationMessage(`Installed skill: ${skill.name}`);
  skillTree.refresh();
}

async function createSkill(client: DispatchClient, skillTree: SkillTreeProvider) {
  const name = await vscode.window.showInputBox({ prompt: 'Skill name', placeHolder: 'Repo Triage' });
  if (!name) return;
  const description = await vscode.window.showInputBox({ prompt: 'Skill description', placeHolder: 'Helps triage repository issues' }) ?? '';
  const instructions = await vscode.window.showInputBox({
    prompt: 'Skill instructions',
    placeHolder: 'Describe what this skill should teach Dispatch/Copilot to do',
  });
  if (!instructions) return;
  const skill: any = await client.post('/api/skills/create', { name, description, instructions });
  vscode.window.showInformationMessage(`Created skill: ${skill.name}`);
  skillTree.refresh();
}

async function createAutomationJob(client: DispatchClient, autoTree: AutomationTreeProvider) {
  const name = await vscode.window.showInputBox({ prompt: 'Automation job name', placeHolder: 'Daily repo check-in' });
  if (!name) return;

  const type = await vscode.window.showQuickPick(
    [
      { label: 'cron', description: 'Run on a schedule such as "every hour"' },
      { label: 'webhook', description: 'Run when a webhook path is called' },
      { label: 'event', description: 'Run when an internal event is emitted' },
    ],
    { placeHolder: 'Trigger type' },
  );
  if (!type) return;

  const action = await vscode.window.showQuickPick(
    [
      { label: 'create_task', description: 'Create a Dispatch task' },
      { label: 'log', description: 'Write a daemon log entry' },
      { label: 'http_request', description: 'Call an HTTP endpoint' },
      { label: 'run_command', description: 'Run a shell command on the daemon host' },
    ],
    { placeHolder: 'Action type' },
  );
  if (!action) return;

  const body: any = { name, type: type.label, action: action.label, actionConfig: {} };
  if (type.label === 'cron') {
    body.schedule = await vscode.window.showInputBox({ prompt: 'Schedule', placeHolder: 'every hour' });
    if (!body.schedule) return;
  } else if (type.label === 'webhook') {
    body.webhookPath = await vscode.window.showInputBox({ prompt: 'Webhook path', placeHolder: 'repo-triage' });
    if (!body.webhookPath) return;
  } else {
    body.eventType = await vscode.window.showInputBox({ prompt: 'Event type', placeHolder: 'task.completed' });
    if (!body.eventType) return;
  }

  if (action.label === 'create_task') {
    body.actionConfig.title = await vscode.window.showInputBox({ prompt: 'Task title', placeHolder: `Auto: ${name}` });
    body.actionConfig.description = await vscode.window.showInputBox({ prompt: 'Task description', placeHolder: 'Created by automation' }) ?? '';
    body.actionConfig.agent = await vscode.window.showQuickPick(['@general-purpose', '@coder', '@designer'], { placeHolder: 'Agent' }) ?? '@general-purpose';
    body.actionConfig.priority = await vscode.window.showQuickPick(['normal', 'low', 'high', 'critical'], { placeHolder: 'Priority' }) ?? 'normal';
  } else if (action.label === 'log') {
    body.actionConfig.message = await vscode.window.showInputBox({ prompt: 'Log message', placeHolder: `Automation ${name} triggered` });
  } else if (action.label === 'http_request') {
    body.actionConfig.url = await vscode.window.showInputBox({ prompt: 'URL', placeHolder: 'https://example.com/hook' });
    body.actionConfig.method = await vscode.window.showQuickPick(['GET', 'POST', 'PUT'], { placeHolder: 'HTTP method' }) ?? 'GET';
    body.actionConfig.body = await vscode.window.showInputBox({ prompt: 'Optional request body' }) ?? '';
  } else {
    const confirm = await vscode.window.showWarningMessage('run_command executes on the daemon host. Continue?', { modal: true }, 'Continue');
    if (confirm !== 'Continue') return;
    body.actionConfig.command = await vscode.window.showInputBox({ prompt: 'Command to run' });
  }

  const job: any = await client.post('/api/automation', body);
  vscode.window.showInformationMessage(`Created automation job: ${job.name}`);
  autoTree.refresh();
}

function showApprovalNotification(client: DispatchClient, event: any, approvalTree: ApprovalTreeProvider) {
  const approvalId = event.approvalId;
  vscode.window.showWarningMessage(
    `⚠️ Approval required for task ${event.taskId}`,
    'Approve', 'Reject',
  ).then(async (action) => {
    if (!action) return;
    const endpoint = action === 'Approve' ? 'approve' : 'reject';
    await client.post(`/api/approvals/${approvalId}/${endpoint}`, { decidedBy: 'vscode-user' });
    vscode.window.showInformationMessage(`Approval ${approvalId} ${endpoint}d`);
    approvalTree.refresh();
  });
}

export function deactivate() {
  sseDisconnect?.();
}

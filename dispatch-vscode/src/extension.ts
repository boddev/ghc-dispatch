import * as vscode from 'vscode';
import { DispatchClient } from './client';
import { TaskTreeProvider, TaskItem } from './providers/task-tree';
import { AgentTreeProvider } from './providers/agent-tree';
import { SkillTreeProvider, SkillItem } from './providers/skill-tree';
import { AutomationTreeProvider } from './providers/automation-tree';
import { ApprovalTreeProvider, ApprovalItem } from './providers/approval-tree';
import { showTaskDetail } from './panels/task-detail';

let sseDisconnect: (() => void) | null = null;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('dispatch');
  const apiUrl = config.get<string>('apiUrl', 'http://localhost:7878');
  const refreshInterval = config.get<number>('autoRefreshInterval', 5000);

  const client = new DispatchClient(apiUrl);

  // --- TreeView Providers ---
  const taskTree = new TaskTreeProvider(client);
  const agentTree = new AgentTreeProvider(client);
  const skillTree = new SkillTreeProvider(client);
  const autoTree = new AutomationTreeProvider(client);
  const approvalTree = new ApprovalTreeProvider(client);

  vscode.window.createTreeView('dispatch.tasks', { treeDataProvider: taskTree, showCollapseAll: true });
  vscode.window.createTreeView('dispatch.agents', { treeDataProvider: agentTree });
  vscode.window.createTreeView('dispatch.skills', { treeDataProvider: skillTree, showCollapseAll: true });
  vscode.window.createTreeView('dispatch.automation', { treeDataProvider: autoTree });
  vscode.window.createTreeView('dispatch.approvals', { treeDataProvider: approvalTree });

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
  const refreshAll = () => {
    taskTree.fetchTasks();
    agentTree.refresh();
    skillTree.refresh();
    autoTree.refresh();
    approvalTree.refresh();
    updateStatusBar();
  };

  if (refreshInterval > 0) {
    const timer = setInterval(refreshAll, refreshInterval);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  // Initial load
  refreshAll();

  // --- SSE for real-time task updates ---
  sseDisconnect = client.createSseStream('/api/events/stream', (event) => {
    // Refresh tasks on state changes
    if (event.type?.startsWith('task.')) {
      taskTree.fetchTasks();
      updateStatusBar();
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
    vscode.commands.registerCommand('dispatch.refreshTasks', () => refreshAll()),

    vscode.commands.registerCommand('dispatch.createTask', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'Task title', placeHolder: 'Fix the auth bug' });
      if (!title) return;

      const agent = await vscode.window.showQuickPick(
        ['@general-purpose', '@coder', '@designer'],
        { placeHolder: 'Select agent' },
      ) ?? '@general-purpose';

      const priority = await vscode.window.showQuickPick(
        ['normal', 'low', 'high', 'critical'],
        { placeHolder: 'Select priority' },
      ) ?? 'normal';

      try {
        const task: any = await client.post('/api/tasks', { title, agent, priority, createdBy: 'vscode' });
        vscode.window.showInformationMessage(`✅ Task created: ${task.id}`);
        taskTree.fetchTasks();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create task: ${err.message}`);
      }
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

    vscode.commands.registerCommand('dispatch.openTaskDetail', (taskId: string) => {
      if (!taskId) return;
      showTaskDetail(client, taskId);
    }),

    vscode.commands.registerCommand('dispatch.cancelTask', async (item: TaskItem) => {
      if (!item?.taskId) return;
      await client.post(`/api/tasks/${item.taskId}/cancel`);
      vscode.window.showInformationMessage(`Task ${item.taskId} cancelled`);
      taskTree.fetchTasks();
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
  );

  console.log('GHC Dispatch extension activated');
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

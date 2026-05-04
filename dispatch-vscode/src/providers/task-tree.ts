import * as vscode from 'vscode';
import { DispatchClient, DispatchHttpError } from '../client';

const STATUS_ICONS: Record<string, string> = {
  pending: '$(circle-outline)',
  queued: '$(list-ordered)',
  running: '$(sync~spin)',
  paused: '$(debug-pause)',
  completed: '$(pass-filled)',
  failed: '$(error)',
  cancelled: '$(circle-slash)',
};

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChange = new vscode.EventEmitter<TaskItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private tasks: any[] = [];
  private errorMessage = '';

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  async fetchTasks(): Promise<void> {
    try {
      this.tasks = await this.client.get('/api/tasks?limit=100');
      this.errorMessage = '';
    } catch (err) {
      this.tasks = [];
      this.errorMessage = err instanceof DispatchHttpError && err.statusCode === 429
        ? 'Dispatch daemon rate limited; waiting to retry'
        : 'Cannot connect to dispatch daemon';
    }
    this.refresh();
  }

  getTreeItem(element: TaskItem): vscode.TreeItem { return element; }

  async getChildren(element?: TaskItem): Promise<TaskItem[]> {
    if (element) return [];

    if (this.tasks.length === 0) await this.fetchTasks();

    const groups: Record<string, any[]> = {};
    for (const t of this.tasks) {
      (groups[t.status] ??= []).push(t);
    }

    const items: TaskItem[] = [];
    const order = ['running', 'queued', 'pending', 'paused', 'failed', 'completed', 'cancelled'];
    for (const status of order) {
      const group = groups[status];
      if (!group?.length) continue;
      for (const t of group) {
        const item = new TaskItem(
          t.title,
          t.id,
          `${t.agent} · ${t.priority} · ${t.status}`,
          t.status,
        );
        items.push(item);
      }
    }

    if (items.length === 0) {
      const empty = new TaskItem(this.errorMessage || 'No tasks found', '', '', '');
      empty.command = undefined;
      return [empty];
    }

    return items;
  }
}

export class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly taskId: string,
    public readonly detail: string,
    public readonly status: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${taskId}\n${detail}`;
    this.description = detail;
    const icon = STATUS_ICONS[status]?.match(/\$\(([^)~]+)(?:~spin)?\)/)?.[1];
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);

    if (taskId) {
      this.command = {
        command: 'dispatch.openTaskDetail',
        title: 'View Task Detail',
        arguments: [taskId],
      };
    }

    this.contextValue = status ? `task-${status}` : undefined;
  }
}

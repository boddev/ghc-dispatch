import * as vscode from 'vscode';
import { DispatchClient, DispatchHttpError } from '../client';

export class AutomationTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cachedItems: vscode.TreeItem[] = [];

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const jobs: any[] = await this.client.get('/api/automation');
      if (jobs.length === 0) {
        this.cachedItems = [new vscode.TreeItem('No automation jobs')];
        return this.cachedItems;
      }

      this.cachedItems = jobs.map(j => {
        const typeIcon = j.type === 'cron' ? 'clock' : j.type === 'webhook' ? 'globe' : 'zap';
        const enabled = j.enabled ? '' : ' (disabled)';
        const item = new vscode.TreeItem(`${j.name}${enabled}`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(typeIcon);
        item.description = `${j.type} · runs: ${j.runCount}`;
        item.tooltip = [
          j.name, `Type: ${j.type}`,
          j.schedule ? `Schedule: ${j.schedule}` : '',
          j.webhookPath ? `Webhook: /api/webhooks/${j.webhookPath}` : '',
          j.eventType ? `Event: ${j.eventType}` : '',
          `Action: ${j.action}`, `Runs: ${j.runCount}`,
          j.lastRunAt ? `Last run: ${j.lastRunAt}` : '',
        ].filter(Boolean).join('\n');
        return item;
      });
      return this.cachedItems;
    } catch (err) {
      if (this.cachedItems.length > 0) return this.cachedItems;
      return [new vscode.TreeItem(err instanceof DispatchHttpError && err.statusCode === 429
        ? 'Dispatch daemon rate limited; waiting to retry'
        : 'Cannot connect to dispatch daemon')];
    }
  }
}

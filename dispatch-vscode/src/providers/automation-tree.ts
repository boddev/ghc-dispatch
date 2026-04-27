import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export class AutomationTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const jobs: any[] = await this.client.get('/api/automation');
      if (jobs.length === 0) return [new vscode.TreeItem('No automation jobs')];

      return jobs.map(j => {
        const typeIcon = j.type === 'cron' ? '$(clock)' : j.type === 'webhook' ? '$(globe)' : '$(zap)';
        const enabled = j.enabled ? '' : ' (disabled)';
        const item = new vscode.TreeItem(`${typeIcon} ${j.name}${enabled}`, vscode.TreeItemCollapsibleState.None);
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
    } catch {
      return [new vscode.TreeItem('Cannot connect to dispatch daemon')];
    }
  }
}

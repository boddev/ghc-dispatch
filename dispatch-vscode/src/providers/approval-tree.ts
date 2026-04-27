import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export class ApprovalTreeProvider implements vscode.TreeDataProvider<ApprovalItem> {
  private _onDidChange = new vscode.EventEmitter<ApprovalItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: ApprovalItem): vscode.TreeItem { return element; }

  async getChildren(): Promise<ApprovalItem[]> {
    try {
      const approvals: any[] = await this.client.get('/api/approvals');
      if (approvals.length === 0) return [new ApprovalItem('No pending approvals', '', '')];

      return approvals.map(a => {
        const item = new ApprovalItem(
          `$(warning) ${a.description}`,
          a.id,
          a.taskId,
        );
        item.description = `${a.type} · expires: ${new Date(a.expiresAt).toLocaleTimeString()}`;
        item.tooltip = `Approval: ${a.id}\nTask: ${a.taskId}\nType: ${a.type}\n${a.description}`;
        item.contextValue = 'approval-pending';
        return item;
      });
    } catch {
      return [new ApprovalItem('Cannot connect to dispatch daemon', '', '')];
    }
  }
}

export class ApprovalItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly approvalId: string,
    public readonly taskId: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export class AgentTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const agents: any[] = await this.client.get('/api/agents');
      return agents.map(a => {
        const item = new vscode.TreeItem(`$(hubot) ${a.name}`, vscode.TreeItemCollapsibleState.None);
        item.description = a.model;
        item.tooltip = `${a.name}\n${a.description}\nModel: ${a.model}`;
        return item;
      });
    } catch {
      return [new vscode.TreeItem('Cannot connect to dispatch daemon')];
    }
  }
}

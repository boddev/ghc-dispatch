import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export class SkillTreeProvider implements vscode.TreeDataProvider<SkillItem> {
  private _onDidChange = new vscode.EventEmitter<SkillItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: SkillItem): vscode.TreeItem { return element; }

  async getChildren(element?: SkillItem): Promise<SkillItem[]> {
    if (element?.isGroup) {
      return element.children;
    }

    try {
      const data: any = await this.client.get('/api/skills');
      const items: SkillItem[] = [];

      if (data.userInstalled?.length) {
        const children = data.userInstalled.map((s: any) => this.makeSkillItem(s));
        items.push(new SkillItem(`User-Installed (${data.userInstalled.length})`, true, children));
      }

      if (data.systemCreated?.length) {
        const children = data.systemCreated.map((s: any) => this.makeSkillItem(s));
        items.push(new SkillItem(`System-Created (${data.systemCreated.length})`, true, children));
      }

      return items.length ? items : [new SkillItem('No skills installed', false, [])];
    } catch {
      return [new SkillItem('Cannot connect to dispatch daemon', false, [])];
    }
  }

  private makeSkillItem(skill: any): SkillItem {
    const icon = skill.enabled ? '$(extensions)' : '$(extensions-disabled)';
    const item = new SkillItem(`${icon} ${skill.name}`, false, []);
    item.description = skill.origin;
    item.tooltip = `${skill.name}\n${skill.description}\nOrigin: ${skill.origin}\nEnabled: ${skill.enabled}`;
    item.contextValue = skill.enabled ? 'skill-enabled' : 'skill-disabled';
    item.skillId = skill.id;
    return item;
  }
}

export class SkillItem extends vscode.TreeItem {
  skillId?: string;
  children: SkillItem[];
  isGroup: boolean;

  constructor(label: string, isGroup: boolean, children: SkillItem[]) {
    super(label, isGroup ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.isGroup = isGroup;
    this.children = children;
    if (isGroup) this.contextValue = 'skill-group';
  }
}

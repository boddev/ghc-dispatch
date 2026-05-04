import * as vscode from 'vscode';
import { DispatchClient, DispatchHttpError } from '../client';

export class SkillTreeProvider implements vscode.TreeDataProvider<SkillItem> {
  private _onDidChange = new vscode.EventEmitter<SkillItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cachedItems: SkillItem[] = [];

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

      this.cachedItems = items.length ? items : [new SkillItem('No skills installed', false, [])];
      return this.cachedItems;
    } catch (err) {
      if (this.cachedItems.length > 0) return this.cachedItems;
      return [new SkillItem(err instanceof DispatchHttpError && err.statusCode === 429
        ? 'Dispatch daemon rate limited; waiting to retry'
        : 'Cannot connect to dispatch daemon', false, [])];
    }
  }

  private makeSkillItem(skill: any): SkillItem {
    const item = new SkillItem(skill.name, false, []);
    item.iconPath = new vscode.ThemeIcon(skill.enabled ? 'extensions' : 'extensions-disabled');
    item.description = skill.origin;
    item.tooltip = `${skill.name}\n${skill.description}\nOrigin: ${skill.origin}\nEnabled: ${skill.enabled}\n${skill.dirPath ?? ''}`;
    item.contextValue = skill.enabled ? 'skill-enabled' : 'skill-disabled';
    item.skillId = skill.id;
    item.dirPath = skill.dirPath;
    item.command = {
      command: 'dispatch.openSkillConfig',
      title: 'Open Skill Config',
      arguments: [item],
    };
    return item;
  }
}

export class SkillItem extends vscode.TreeItem {
  skillId?: string;
  dirPath?: string;
  children: SkillItem[];
  isGroup: boolean;

  constructor(label: string, isGroup: boolean, children: SkillItem[]) {
    super(label, isGroup ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.isGroup = isGroup;
    this.children = children;
    if (isGroup) this.contextValue = 'skill-group';
  }
}

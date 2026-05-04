import * as vscode from 'vscode';
import { DispatchClient, DispatchHttpError } from '../client';

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentItem> {
  private _onDidChange = new vscode.EventEmitter<AgentItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cachedAgents: AgentItem[] = [];
  private cachedTeams: AgentItem[] = [];

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: AgentItem): vscode.TreeItem { return element; }

  async getChildren(element?: AgentItem): Promise<AgentItem[]> {
    try {
      if (!element) {
        return [
          new AgentItem('Agents', 'group-agents'),
          new AgentItem('Teams', 'group-teams'),
        ];
      }

      if (element.kind === 'group-agents') {
        const agents: any[] = await this.client.get('/api/agents');
        this.cachedAgents = agents.map(a => {
          const item = new AgentItem(a.name, 'agent', a.name, a.filePath);
          item.iconPath = new vscode.ThemeIcon('hubot');
          item.description = a.model;
          item.tooltip = `${a.name}\n${a.description}\nModel: ${a.model}\n${a.filePath ?? ''}`;
          item.command = {
            command: 'dispatch.openAgentConfig',
            title: 'Open Agent Config',
            arguments: [item],
          };
          return item;
        });
        return this.cachedAgents;
      }

      if (element.kind === 'group-teams') {
        const teams: any[] = await this.client.get('/api/teams');
        if (teams.length === 0) return [new AgentItem('No teams configured', 'empty')];
        this.cachedTeams = teams.map(t => {
          const item = new AgentItem(t.name, 'team', undefined, undefined, t.id);
          item.iconPath = new vscode.ThemeIcon('organization');
          item.description = `Lead: ${t.leadAgent} · ${t.memberAgents.length} members`;
          item.tooltip = [
            t.name,
            t.description,
            `Lead: ${t.leadAgent}`,
            `Members: ${t.memberAgents.join(', ')}`,
          ].filter(Boolean).join('\n');
          item.command = {
            command: 'dispatch.openTeamConfig',
            title: 'Open Team Config',
            arguments: [item],
          };
          return item;
        });
        return this.cachedTeams;
      }
    } catch (err) {
      if (element?.kind === 'group-agents' && this.cachedAgents.length > 0) return this.cachedAgents;
      if (element?.kind === 'group-teams' && this.cachedTeams.length > 0) return this.cachedTeams;
      return [new AgentItem(err instanceof DispatchHttpError && err.statusCode === 429
        ? 'Dispatch daemon rate limited; waiting to retry'
        : 'Cannot connect to dispatch daemon', 'empty')];
    }

    return [];
  }
}

export class AgentItem extends vscode.TreeItem {
  constructor(
    label: string,
    public kind: 'group-agents' | 'group-teams' | 'agent' | 'team' | 'empty',
    public agentName?: string,
    public filePath?: string,
    public teamId?: string,
  ) {
    super(
      label,
      kind === 'group-agents' || kind === 'group-teams'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    if (kind === 'agent') this.contextValue = 'agent';
    if (kind === 'team') this.contextValue = 'agent-team';
  }
}

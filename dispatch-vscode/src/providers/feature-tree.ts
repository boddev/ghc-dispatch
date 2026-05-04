import * as vscode from 'vscode';
import { DispatchClient, DispatchHttpError } from '../client';

export interface DispatchFeatureAction {
  id: string;
  label: string;
  description: string;
}

export interface DispatchFeatureEndpoint {
  method: string;
  path: string;
  description: string;
}

export interface DispatchFeature {
  id: string;
  title: string;
  category: string;
  summary: string;
  details: string;
  status: string;
  configuration: string[];
  actions: DispatchFeatureAction[];
  endpoints: DispatchFeatureEndpoint[];
}

interface DispatchFeatureCategory {
  id: string;
  title: string;
  description: string;
}

interface DispatchFeatureCatalog {
  categories: DispatchFeatureCategory[];
  features: DispatchFeature[];
}

export class FeatureTreeProvider implements vscode.TreeDataProvider<FeatureItem> {
  private _onDidChange = new vscode.EventEmitter<FeatureItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cachedCatalog?: DispatchFeatureCatalog;

  constructor(private client: DispatchClient) {}

  refresh(): void { this._onDidChange.fire(undefined); }

  getTreeItem(element: FeatureItem): vscode.TreeItem { return element; }

  async getChildren(element?: FeatureItem): Promise<FeatureItem[]> {
    try {
      const catalog: DispatchFeatureCatalog = await this.client.get('/api/features');
      this.cachedCatalog = catalog;

      if (!element) {
        return catalog.categories.map(category => {
          const count = catalog.features.filter(feature => feature.category === category.id).length;
          const item = new FeatureItem(category.title, 'category', category.id);
          item.description = `${count} feature${count === 1 ? '' : 's'}`;
          item.tooltip = category.description;
          return item;
        });
      }

      if (element.kind === 'category' && element.categoryId) {
        return catalog.features
          .filter(feature => feature.category === element.categoryId)
          .map(feature => {
            const item = new FeatureItem(feature.title, 'feature', undefined, feature.id);
            item.iconPath = new vscode.ThemeIcon('symbol-misc');
            item.description = feature.status;
            item.tooltip = `${feature.title}\n${feature.summary}\n${feature.status}`;
            item.command = {
              command: 'dispatch.openFeatureDetail',
              title: 'Open Feature Detail',
              arguments: [feature.id],
            };
            return item;
          });
      }
    } catch (err) {
      if (this.cachedCatalog) return this.renderFromCatalog(this.cachedCatalog, element);
      return [new FeatureItem(err instanceof DispatchHttpError && err.statusCode === 429
        ? 'Dispatch daemon rate limited; waiting to retry'
        : 'Cannot connect to dispatch daemon', 'empty')];
    }

    return [];
  }

  private renderFromCatalog(catalog: DispatchFeatureCatalog, element?: FeatureItem): FeatureItem[] {
    if (!element) {
      return catalog.categories.map(category => {
        const count = catalog.features.filter(feature => feature.category === category.id).length;
        const item = new FeatureItem(category.title, 'category', category.id);
        item.description = `${count} feature${count === 1 ? '' : 's'}`;
        item.tooltip = category.description;
        return item;
      });
    }
    if (element.kind === 'category' && element.categoryId) {
      return catalog.features
        .filter(feature => feature.category === element.categoryId)
        .map(feature => {
          const item = new FeatureItem(feature.title, 'feature', undefined, feature.id);
          item.iconPath = new vscode.ThemeIcon('symbol-misc');
          item.description = feature.status;
          item.tooltip = `${feature.title}\n${feature.summary}\n${feature.status}`;
          item.command = {
            command: 'dispatch.openFeatureDetail',
            title: 'Open Feature Detail',
            arguments: [feature.id],
          };
          return item;
        });
    }
    return [];
  }
}

export class FeatureItem extends vscode.TreeItem {
  constructor(
    label: string,
    public kind: 'category' | 'feature' | 'empty',
    public categoryId?: string,
    public featureId?: string,
  ) {
    super(
      label,
      kind === 'category' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    if (kind === 'feature') this.contextValue = 'dispatch-feature';
  }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class AutomationTreeProvider {
    client;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    constructor(client) {
        this.client = client;
    }
    refresh() { this._onDidChange.fire(undefined); }
    getTreeItem(element) { return element; }
    async getChildren() {
        try {
            const jobs = await this.client.get('/api/automation');
            if (jobs.length === 0)
                return [new vscode.TreeItem('No automation jobs')];
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
        }
        catch {
            return [new vscode.TreeItem('Cannot connect to dispatch daemon')];
        }
    }
}
exports.AutomationTreeProvider = AutomationTreeProvider;
//# sourceMappingURL=automation-tree.js.map
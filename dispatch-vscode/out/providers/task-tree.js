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
exports.TaskItem = exports.TaskTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const STATUS_ICONS = {
    pending: '$(circle-outline)',
    queued: '$(list-ordered)',
    running: '$(sync~spin)',
    paused: '$(debug-pause)',
    completed: '$(pass-filled)',
    failed: '$(error)',
    cancelled: '$(circle-slash)',
};
class TaskTreeProvider {
    client;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    tasks = [];
    constructor(client) {
        this.client = client;
    }
    refresh() { this._onDidChange.fire(undefined); }
    async fetchTasks() {
        try {
            this.tasks = await this.client.get('/api/tasks?limit=100');
        }
        catch {
            this.tasks = [];
        }
        this.refresh();
    }
    getTreeItem(element) { return element; }
    async getChildren(element) {
        if (element)
            return [];
        if (this.tasks.length === 0)
            await this.fetchTasks();
        const groups = {};
        for (const t of this.tasks) {
            (groups[t.status] ??= []).push(t);
        }
        const items = [];
        const order = ['running', 'queued', 'pending', 'paused', 'failed', 'completed', 'cancelled'];
        for (const status of order) {
            const group = groups[status];
            if (!group?.length)
                continue;
            for (const t of group) {
                const icon = STATUS_ICONS[t.status] ?? '$(question)';
                const item = new TaskItem(`${icon} ${t.title}`, t.id, `${t.agent} · ${t.priority} · ${t.status}`, t.status);
                items.push(item);
            }
        }
        if (items.length === 0) {
            const empty = new TaskItem('No tasks found', '', '', '');
            empty.command = undefined;
            return [empty];
        }
        return items;
    }
}
exports.TaskTreeProvider = TaskTreeProvider;
class TaskItem extends vscode.TreeItem {
    label;
    taskId;
    detail;
    status;
    constructor(label, taskId, detail, status) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.taskId = taskId;
        this.detail = detail;
        this.status = status;
        this.tooltip = `${taskId}\n${detail}`;
        this.description = detail;
        if (taskId) {
            this.command = {
                command: 'dispatch.openTaskDetail',
                title: 'View Task Detail',
                arguments: [taskId],
            };
        }
        if (['pending', 'queued', 'running', 'paused'].includes(status)) {
            this.contextValue = 'task-cancellable';
        }
        else if (status === 'failed') {
            this.contextValue = 'task-retryable';
        }
        else {
            this.contextValue = 'task';
        }
    }
}
exports.TaskItem = TaskItem;
//# sourceMappingURL=task-tree.js.map
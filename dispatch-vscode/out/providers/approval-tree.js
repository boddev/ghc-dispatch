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
exports.ApprovalItem = exports.ApprovalTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class ApprovalTreeProvider {
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
            const approvals = await this.client.get('/api/approvals');
            if (approvals.length === 0)
                return [new ApprovalItem('No pending approvals', '', '')];
            return approvals.map(a => {
                const item = new ApprovalItem(`$(warning) ${a.description}`, a.id, a.taskId);
                item.description = `${a.type} · expires: ${new Date(a.expiresAt).toLocaleTimeString()}`;
                item.tooltip = `Approval: ${a.id}\nTask: ${a.taskId}\nType: ${a.type}\n${a.description}`;
                item.contextValue = 'approval-pending';
                return item;
            });
        }
        catch {
            return [new ApprovalItem('Cannot connect to dispatch daemon', '', '')];
        }
    }
}
exports.ApprovalTreeProvider = ApprovalTreeProvider;
class ApprovalItem extends vscode.TreeItem {
    approvalId;
    taskId;
    constructor(label, approvalId, taskId) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.approvalId = approvalId;
        this.taskId = taskId;
    }
}
exports.ApprovalItem = ApprovalItem;
//# sourceMappingURL=approval-tree.js.map
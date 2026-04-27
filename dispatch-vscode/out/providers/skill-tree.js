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
exports.SkillItem = exports.SkillTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class SkillTreeProvider {
    client;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    constructor(client) {
        this.client = client;
    }
    refresh() { this._onDidChange.fire(undefined); }
    getTreeItem(element) { return element; }
    async getChildren(element) {
        if (element?.isGroup) {
            return element.children;
        }
        try {
            const data = await this.client.get('/api/skills');
            const items = [];
            if (data.userInstalled?.length) {
                const children = data.userInstalled.map((s) => this.makeSkillItem(s));
                items.push(new SkillItem(`User-Installed (${data.userInstalled.length})`, true, children));
            }
            if (data.systemCreated?.length) {
                const children = data.systemCreated.map((s) => this.makeSkillItem(s));
                items.push(new SkillItem(`System-Created (${data.systemCreated.length})`, true, children));
            }
            return items.length ? items : [new SkillItem('No skills installed', false, [])];
        }
        catch {
            return [new SkillItem('Cannot connect to dispatch daemon', false, [])];
        }
    }
    makeSkillItem(skill) {
        const icon = skill.enabled ? '$(extensions)' : '$(extensions-disabled)';
        const item = new SkillItem(`${icon} ${skill.name}`, false, []);
        item.description = skill.origin;
        item.tooltip = `${skill.name}\n${skill.description}\nOrigin: ${skill.origin}\nEnabled: ${skill.enabled}`;
        item.contextValue = skill.enabled ? 'skill-enabled' : 'skill-disabled';
        item.skillId = skill.id;
        return item;
    }
}
exports.SkillTreeProvider = SkillTreeProvider;
class SkillItem extends vscode.TreeItem {
    skillId;
    children;
    isGroup;
    constructor(label, isGroup, children) {
        super(label, isGroup ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.isGroup = isGroup;
        this.children = children;
        if (isGroup)
            this.contextValue = 'skill-group';
    }
}
exports.SkillItem = SkillItem;
//# sourceMappingURL=skill-tree.js.map
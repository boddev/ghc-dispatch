# GHC Dispatch — VS Code Extension

Manage your dispatch orchestration platform directly from VS Code.

## Features

- **Activity Bar**: Dispatch icon in the sidebar with 5 tree views
- **Tasks**: Real-time task list grouped by status, click for detail panel
- **Agents**: View loaded agent definitions with models
- **Skills**: Browse skills grouped by User-Installed vs System-Created, enable/disable from context menu
- **Automation**: View cron jobs, webhooks, and event triggers
- **Approvals**: Pending approvals with Approve/Reject actions + native VS Code notifications
- **Status Bar**: Running/queued task count, always visible
- **Commands**: `Dispatch: Create Task`, `Dispatch: Show Stats`, `Dispatch: Recall Memory`, `Dispatch: Memory Explorer`
- **Task Detail Panel**: Webview with status, events timeline, actions (cancel/retry/enqueue)
- **Real-time Updates**: SSE connection to daemon for live task state changes

## Setup

1. Start the dispatch daemon: `dispatch --start`
2. Install this extension in VS Code
3. The Dispatch icon appears in the activity bar

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dispatch.apiUrl` | `http://localhost:7878` | Dispatch daemon API URL |
| `dispatch.autoRefreshInterval` | `5000` | Auto-refresh interval (ms), 0 to disable |

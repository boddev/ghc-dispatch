# GHC Dispatch — VS Code Extension

Manage your dispatch orchestration platform directly from VS Code.

## Features

- **Activity Bar**: Dispatch icon opens the Dispatch Features landing screen in the main editor with task, agent, skill, feature, automation, and approval views in the sidebar
- **Features**: Discover Dispatch capabilities, see live status, review API endpoints, and launch configuration/use actions
- **Tasks**: Real-time task list grouped by status, click for detail panel
- **Agents**: View loaded agent definitions with models
- **Dispatch Chat**: Chat with Dispatch and change the chat planner model directly from the chat panel or `Switch Model`
- **Skills**: Browse skills grouped by User-Installed vs System-Created, install from skills.sh or GitHub, and enable/disable from the context menu
- **Automation**: View cron jobs, webhooks, and event triggers
- **Approvals**: Pending approvals with Approve/Reject actions + native VS Code notifications
- **Status Bar**: Running/queued task count, always visible
- **Commands**: `Feature Catalog`, `Create Task`, `Show Stats`, `Recall Memory`, `Memory Explorer`
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
| `dispatch.autoStartDaemon` | `true` | If the daemon isn't responding when the extension activates, run `dispatch --start` automatically (requires the `dispatch` CLI on your PATH). |

# GHC Dispatch

A Copilot-native agent orchestration platform. Orchestrate GitHub Copilot — don't replace it.

## Available Tools

When this MCP server is connected, you can use these tools:

- `create_task` — Create a new orchestrated task
- `get_task` — Get task status and details
- `list_tasks` — List tasks with optional status filter
- `cancel_task` — Cancel a running or queued task
- `enqueue_task` — Queue a pending task for execution
- `retry_task` — Retry a failed task
- `get_task_events` — Get event history for a task
- `get_stats` — Get task statistics

## Usage

Ask me to create tasks for specialist agents:
- "Create a task for @coder to fix the auth bug in myapp"
- "List all running tasks"
- "What's the status of task X?"
- "Cancel task X"

Tasks are dispatched to specialist agents (@coder, @designer, @general-purpose)
that run as full Copilot sessions with complete tool access.

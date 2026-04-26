# GHC Orchestrator

**A Copilot-native agent orchestration platform.**

Orchestrate GitHub Copilot — don't replace it. GHC Orchestrator adds OpenClaw-level workflow orchestration, MAX-style background automation, MCP-based extensibility, and VS Code Agents App observability on top of the GitHub Copilot SDK, preserving the full quality of Copilot's internal agent loop.

```
❌  Agent (OpenClaw) → Copilot (model)        ← degrades quality
✅  Orchestrator → Copilot (agent runtime) → tools  ← full Copilot quality
```

---

## Table of Contents

- [Why](#why)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [HTTP API](#http-api)
- [MCP Server](#mcp-server)
- [Agents](#agents)
- [Task Lifecycle](#task-lifecycle)
- [Scheduler & Admission Control](#scheduler--admission-control)
- [Policy Engine](#policy-engine)
- [Approval Workflows](#approval-workflows)
- [DAG Execution](#dag-execution)
- [Multi-Repo Coordination](#multi-repo-coordination)
- [Wiki Memory](#wiki-memory)
- [VS Code Integration](#vs-code-integration)
- [Discord Integration](#discord-integration)
- [Event Store & Observability](#event-store--observability)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development](#development)
- [Comparison](#comparison)

---

## Why

GitHub Copilot produces the best results when it runs as a **full agent system** — context, tools, orchestration, and model tuning all working together. Tools like OpenClaw treat Copilot as a raw model, replacing its best parts and degrading quality.

GHC Orchestrator takes a different approach: **keep Copilot as the execution brain** and add orchestration *around* it. You get the workflow power of an orchestration platform with the code quality of native Copilot.

### Key Differentiators

| Feature | OpenClaw | MAX | GHC Orchestrator |
|---------|----------|-----|------------------|
| Copilot quality preserved | ❌ | ✅ | ✅ |
| Task DAG execution | ❌ | ❌ | ✅ |
| Priority scheduler | ❌ | ❌ | ✅ |
| Policy engine (RBAC) | ❌ | ❌ | ✅ |
| Approval workflows | ❌ | ❌ | ✅ |
| Event-sourced audit trail | ❌ | ❌ | ✅ |
| VS Code Agents App | ❌ | ❌ | ✅ |
| MCP Apps dashboard | ❌ | ❌ | ✅ |
| Multi-repo coordination | ❌ | ❌ | ✅ |
| Multi-surface (CLI/API/Discord/VS Code) | Web | Telegram/TUI | ✅ All |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SURFACE LAYER                                │
│   Discord │ CLI/TUI │ VS Code (MCP + Agents App) │ Web Dashboard   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      CONTROL PLANE                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Scheduler│  │  Policy   │  │ Approval │  │  Event Store     │  │
│  │ & Queue  │  │  Engine   │  │  Manager │  │  (append-only)   │  │
│  └──────────┘  └───────────┘  └──────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Task Manager (state machine)                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     EXECUTION PLANE                                 │
│  ┌─────────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │ Session Runner   │  │  Worktree   │  │  Artifact Collector    │ │
│  │ (Copilot SDK)    │  │  Manager    │  │  (diffs, logs, files)  │ │
│  └─────────────────┘  └─────────────┘  └────────────────────────┘ │
│  ┌─────────────────┐  ┌──────────────────────────────────────────┐│
│  │ DAG Executor     │  │  Multi-Repo Coordinator                 ││
│  └─────────────────┘  └──────────────────────────────────────────┘│
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     CAPABILITY LAYER                                │
│  MCP Servers: GitHub │ Browser │ Docs │ Azure │ Local Machine       │
│  Custom Tools: domain-specific functions registered per session     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js v18+** — `node --version`
- **GitHub Copilot CLI** — active Copilot subscription, installed via `npm i -g @github/copilot`

### Install

```bash
git clone https://github.com/your-org/ghc-orchestrator.git
cd ghc-orchestrator
npm install
```

### Start the Daemon

```bash
# With real Copilot SDK (requires active subscription)
npm start

# With mock Copilot (for testing without subscription)
GHC_MOCK_COPILOT=1 npm start
```

Output:

```
🚀 GHC Orchestrator starting...
   Data dir: ~/.ghc-orchestrator
   API port: 7878
   Max sessions: 4
   Copilot: SDK adapter started
   Agents: @coder, @designer, @general-purpose, @orchestrator

✅ GHC Orchestrator running on http://localhost:7878
   API: http://localhost:7878/api
   SSE: http://localhost:7878/api/events/stream
   Health: http://localhost:7878/api/health
```

### Create Your First Task

```bash
# Via CLI
npm run cli -- create "Fix the auth bug" --agent @coder --priority high

# Via API
curl -X POST http://localhost:7878/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix the auth bug","agent":"@coder","priority":"high"}'
```

---

## CLI Reference

```
npm run cli -- <command> [options]
```

| Command | Description |
|---------|-------------|
| `create <title>` | Create a new task |
| `status <task-id>` | Show task details |
| `list` | List all tasks |
| `enqueue <task-id>` | Queue a pending task for execution |
| `cancel <task-id>` | Cancel a task |
| `retry <task-id>` | Retry a failed task |
| `events <task-id>` | Show event history for a task |
| `stats` | Show task statistics |
| `help` | Show usage information |

### Create Options

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <name>` | Agent to assign | `@general-purpose` |
| `--priority <level>` | `critical` \| `high` \| `normal` \| `low` | `normal` |
| `--repo <path>` | Target repository path | — |
| `--description <text>` | Task description | — |

### Examples

```bash
# Create a high-priority coding task
npm run cli -- create "Refactor auth module" --agent @coder --priority high --repo ~/dev/myapp

# List only running tasks
npm run cli -- list --status running

# View event history
npm run cli -- events 01KQ3ECDV5CJMS9DACYVJGM69K
```

---

## HTTP API

The daemon exposes a REST API on the configured port (default `7878`).

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks` | Create a new task |
| `GET` | `/api/tasks` | List tasks (`?status=running&limit=20`) |
| `GET` | `/api/tasks/:id` | Get task details |
| `POST` | `/api/tasks/:id/enqueue` | Queue a pending task |
| `POST` | `/api/tasks/:id/execute` | Enqueue and immediately dispatch |
| `POST` | `/api/tasks/:id/cancel` | Cancel a task |
| `POST` | `/api/tasks/:id/retry` | Retry a failed task |
| `GET` | `/api/tasks/:id/events` | Get event history |
| `GET` | `/api/tasks/:id/subtasks` | Get child tasks |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/approvals` | List pending approvals |
| `POST` | `/api/approvals/:id/approve` | Approve a request |
| `POST` | `/api/approvals/:id/reject` | Reject a request |

### Agents & Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List loaded agent definitions |
| `GET` | `/api/stats` | Task stats, queue depth, session count |
| `GET` | `/api/health` | Health check (status, version, uptime) |

### SSE Event Stream

```bash
curl http://localhost:7878/api/events/stream
```

Streams real-time events as Server-Sent Events (SSE). Events include task state changes, output, approvals, and session lifecycle events. Useful for building live dashboards.

### Example: Create and Execute

```bash
# Create
TASK_ID=$(curl -s -X POST http://localhost:7878/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Add unit tests for auth","agent":"@coder"}' | jq -r '.id')

# Execute (enqueue + dispatch to Copilot)
curl -X POST http://localhost:7878/api/tasks/$TASK_ID/execute
```

---

## MCP Server

GHC Orchestrator exposes itself as a **Model Context Protocol (MCP) server**, making it accessible from VS Code, Copilot CLI, Claude, and any MCP-compatible client.

### Available Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a new orchestrated task |
| `get_task` | Get task status and details |
| `list_tasks` | List tasks with optional status filter |
| `cancel_task` | Cancel a running or queued task |
| `enqueue_task` | Queue a pending task for execution |
| `retry_task` | Retry a failed task |
| `approve_task` | Approve a pending approval request |
| `reject_task` | Reject a pending approval request |
| `get_task_events` | Get event history for a task |
| `list_agents` | List available agent definitions |
| `get_stats` | Orchestrator health and metrics |
| `get_pending_approvals` | List all pending approval requests |

### Connecting from VS Code

Add to your `.vscode/mcp.json` or VS Code settings:

```json
{
  "servers": {
    "ghc-orchestrator": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/ghc-orchestrator/src/mcp/server.ts"]
    }
  }
}
```

Then in VS Code chat:
> "Create a task for @coder to fix the login bug in myapp"

---

## Agents

Agents are specialist Copilot sessions, each with their own model, system prompt, and capabilities. They are defined as `.agent.md` files with YAML frontmatter.

### Built-in Agents

| Agent | Model | Role |
|-------|-------|------|
| `@orchestrator` | `claude-sonnet-4.6` | Routes tasks, manages workflows, answers simple questions |
| `@coder` | `gpt-5.4` | Software engineering — implementation, debugging, tests |
| `@designer` | `claude-opus-4.6` | UI/UX design — components, styling, accessibility |
| `@general-purpose` | `auto` | Research, docs, data processing, system tasks |

### Agent Definition Format

Create a `.agent.md` file in `~/.ghc-orchestrator/agents/` or the project's `agents/` directory:

```markdown
---
name: DevOps
description: Infrastructure and deployment specialist
model: gpt-5.4
skills:
  - kubernetes
  - terraform
tools:
  - terminal
  - file_read
  - file_write
mcpServers:
  - azure-mcp-server
---
You are DevOps, an infrastructure and deployment specialist.

Focus on infrastructure-as-code, CI/CD pipelines, container orchestration,
and cloud resource management. Always validate changes in staging first.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `description` | Yes | Short description shown in agent roster |
| `model` | Yes | LLM model (`gpt-5.4`, `claude-sonnet-4.6`, `auto`, etc.) |
| `skills` | No | List of skills to load |
| `tools` | No | Tool allowlist (omit to give all tools) |
| `mcpServers` | No | MCP servers to connect |

The agent format is compatible with [MAX](https://github.com/burkeholland/max) and [VS Code Agent Plugins](https://code.visualstudio.com/docs/copilot/customization/agent-plugins).

---

## Task Lifecycle

Every task follows a strict state machine:

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │ enqueue
                    ┌──────▼──────┐
              ┌─────│   queued    │
              │     └──────┬──────┘
              │            │ scheduler dispatches
              │     ┌──────▼──────┐
              │  ┌──│   running   │──┐
              │  │  └──────┬──────┘  │
              │  │         │         │
              │  │  ┌──────▼──────┐  │
              │  │  │   paused    │  │
              │  │  └──────┬──────┘  │
              │  │         │ resume  │
              │  │         └─→ queued│
              │  │                   │
              │  │  ┌────────────┐   │  ┌────────────┐
              │  └──│ completed  │   └──│   failed   │
              │     └────────────┘      └─────┬──────┘
              │                               │ retry
              │     ┌────────────┐            └─→ queued
              └─────│ cancelled  │
                    └────────────┘
```

### Valid Transitions

| From | To |
|------|----|
| `pending` | `queued`, `cancelled` |
| `queued` | `running`, `cancelled` |
| `running` | `completed`, `failed`, `paused`, `cancelled` |
| `paused` | `queued` (resume), `cancelled` |
| `failed` | `queued` (retry) |
| `completed` | *(terminal)* |
| `cancelled` | *(terminal)* |

### Retry Logic

Failed tasks can be retried up to `maxRetries` times (default: 3). Each retry uses exponential backoff:

```
delay = retryBackoffMs × 2^attempt
```

---

## Scheduler & Admission Control

The scheduler manages a **priority queue** with configurable concurrency limits, ensuring the system never overloads.

### Features

- **Priority ordering** — critical > high > normal > low
- **Aging boost** — long-queued tasks gradually increase in effective priority to prevent starvation
- **Global concurrency limit** — maximum simultaneous Copilot sessions (default: 4)
- **Per-repo concurrency** — prevents a single repository from monopolizing all sessions
- **Per-user concurrency** — fair sharing across users
- **Backpressure** — when the pool is full, tasks stay `queued` until a slot opens
- **Cancellation propagation** — cancelling a parent task cancels queued children

### Configuration

```bash
MAX_CONCURRENT_SESSIONS=4   # Global limit
```

---

## Policy Engine

The policy engine evaluates rules against every action before execution. Rules can restrict repositories, tools, or require approvals.

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| `repo_allowlist` | Only allow specified repos | Restrict to `org/app-*` repos |
| `tool_permission` | Block specific tools | Deny `git_push` for interns |
| `approval_required` | Require human approval for actions | Approve all deployments |
| `rate_limit` | Limit actions per time window | Max 10 tasks/hour |
| `budget` | Token/session quotas | 100k tokens/user/day |

### Scoping

Rules can be scoped to specific users, agents, or repositories:

```typescript
policyEngine.addRule({
  id: 'intern-safety',
  type: 'tool_permission',
  scope: {
    users: ['intern-alice'],
    agents: [],   // all agents
    repos: [],    // all repos
  },
  config: {
    deniedTools: ['git_push', 'deploy', 'rm'],
  },
});
```

### Evaluation

Rules are evaluated in order. The first matching deny rule blocks the action. An `approval_required` rule returns `allowed: true` with `requiresApproval: true`, pausing the task until a human approves.

---

## Approval Workflows

Approvals are **first-class workflow objects**, not just UI buttons. They have identity, evidence, expiry, and audit trails.

### Approval Request

```typescript
{
  id: "01KQ3...",
  taskId: "01KQ2...",
  type: "deployment",        // tool_call | task_completion | deployment | custom
  description: "Deploy myapp to production",
  evidence: ["diff.patch"],   // Supporting artifacts
  approvers: ["admin"],       // Allowed approver identities
  status: "pending",          // pending | approved | rejected | expired
  expiresAt: "2026-04-26T...",
}
```

### Approving via API

```bash
# List pending
curl http://localhost:7878/api/approvals

# Approve
curl -X POST http://localhost:7878/api/approvals/01KQ3.../approve \
  -H "Content-Type: application/json" \
  -d '{"decidedBy":"admin"}'
```

### Auto-Expiry

Pending approvals expire after a configurable timeout (default: 1 hour). Expired approvals automatically cancel the blocked task. A periodic GC sweep runs every 60 seconds.

---

## DAG Execution

For complex workflows, tasks can be organized into a **directed acyclic graph (DAG)** with dependency resolution and parallel dispatch.

### Features

- **Cycle detection** — Kahn's algorithm validates the graph before execution
- **Topological ordering** — tasks execute in dependency order
- **Parallel dispatch** — independent tasks run simultaneously (up to `maxParallel`)
- **Deadlock detection** — if a failed dependency blocks remaining tasks, they are automatically marked failed
- **Fan-out / fan-in** — a parent task can spawn subtasks and join on their completion

### Example: Diamond DAG

```
        ┌─── build-frontend ───┐
start ──┤                      ├── deploy
        └─── build-backend  ───┘
```

```typescript
import { TaskDag, executeDag } from './src/execution/task-dag.js';

const dag = new TaskDag();
dag.addNode('start');
dag.addNode('build-frontend', ['start']);
dag.addNode('build-backend', ['start']);
dag.addNode('deploy', ['build-frontend', 'build-backend']);

// Validates, then executes with up to 4 parallel tasks
const { completed, failed } = await executeDag(dag, taskManager, sessionRunner, 4);
```

### Building DAGs from Tasks

Tasks with `dependsOn` fields are automatically structured into a DAG:

```bash
# Create tasks with dependencies
TASK_A=$(npm run cli -- create "Build frontend" | grep -oP '01K\w+')
TASK_B=$(npm run cli -- create "Build backend" | grep -oP '01K\w+')
npm run cli -- create "Deploy" --depends-on $TASK_A,$TASK_B
```

---

## Multi-Repo Coordination

For workflows spanning multiple repositories, the multi-repo coordinator manages cloning, worktree setup, and coordinated changes.

### Usage

```typescript
import { MultiRepoCoordinator } from './src/execution/multi-repo.js';

const coordinator = new MultiRepoCoordinator(baseDir, worktreeManager);

// Set up a workspace with multiple repos
const workspace = await coordinator.setupWorkspace('feature-x', [
  { url: 'https://github.com/org/frontend.git', name: 'frontend', defaultBranch: 'main' },
  { url: 'https://github.com/org/backend.git',  name: 'backend',  defaultBranch: 'main' },
  { url: 'https://github.com/org/shared.git',   name: 'shared',   defaultBranch: 'main' },
]);

// Create isolated worktrees for a task across all repos
const worktrees = await coordinator.createWorktrees('feature-x', 'task-123');
// worktrees = Map { 'frontend' → '/path/to/worktree', 'backend' → '...', 'shared' → '...' }

// Clean up when done
await coordinator.cleanupWorktrees('feature-x', 'task-123');
```

Each repository gets an isolated git worktree per task (`git worktree add`), so tasks never interfere with each other or your working tree.

---

## Wiki Memory

GHC Orchestrator includes a wiki-based memory system inspired by [MAX](https://github.com/burkeholland/max). It stores knowledge as interlinked markdown pages — organized like a personal Obsidian vault.

### Features

- **Entity pages** — one page per person, project, or concept (not a flat dump)
- **YAML frontmatter** — title, tags, created/updated timestamps
- **Cross-links** — `[[wiki links]]` between pages
- **Search** — keyword search with title/tag boosting and recency boost
- **Remember / Forget** — merge new facts into existing pages or surgically remove them
- **Index generation** — ranked table of contents for context injection

### Location

Wiki pages are stored in `~/.ghc-orchestrator/wiki/pages/`.

### API

```typescript
import { WikiManager } from './src/wiki/wiki-manager.js';

const wiki = new WikiManager('~/.ghc-orchestrator/wiki');

// Remember facts about entities
wiki.remember('Burke', 'Prefers TypeScript', ['person']);
wiki.remember('Burke', 'Works on VS Code', ['person']);

// Read a page
const page = wiki.read('burke');
// → { slug: 'burke', frontmatter: { title: 'Burke', tags: ['person'], ... }, body: '...' }

// Search
const results = wiki.search('TypeScript');

// Build a context index
const index = wiki.buildIndex('deployment');
// → "- [[myapp]] — MyApp Project [deployment, production]\n- [[vercel]] — Vercel ..."

// Forget a specific fact
wiki.forget('burke', 'Prefers TypeScript');
```

---

## VS Code Integration

GHC Orchestrator integrates with VS Code through two mechanisms:

### 1. Agent Plugin

The `plugin/` directory is a ready-to-use [VS Code Agent Plugin](https://code.visualstudio.com/docs/copilot/customization/agent-plugins):

```
plugin/
├── plugin.json          # Plugin manifest
├── .mcp.json            # MCP server configuration
├── agents/              # Agent definitions
├── skills/
│   └── orchestrator/
│       └── SKILL.md     # Usage instructions for Copilot
└── hooks/
    └── hooks.json       # Lifecycle hooks
```

Install by pointing VS Code at the plugin directory. Your agents, skills, and the MCP server are automatically available in VS Code chat and the Agents App.

### 2. MCP Apps Dashboard

The `src/mcp/apps/task-board.html` file is an interactive dashboard rendered inside VS Code's chat panel via [MCP Apps](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support):

- **Kanban board** — tasks organized by status (Queued / Running / Completed / Failed)
- **Live statistics** — queue depth, running count, session utilization
- **Approval panel** — approve or reject pending requests inline
- **Auto-refresh** — toggleable 3-second polling

### Agents App Mapping

| Orchestrator Concept | VS Code Agents App |
|---------------------|--------------------|
| Task | Agent Session |
| Subtask | Nested Session |
| Agent (`@coder`) | Agent Worker |
| Task output/diff | Session Changes |
| Approval | Review Request |

---

## Discord Integration

GHC Orchestrator includes a Discord adapter for managing tasks from Discord servers.

### Command Format

```
!task create "Fix the auth bug" --agent @coder --priority high
!task list
!task status <task-id>
!task cancel <task-id>
```

### Integration

The adapter parses `!task` commands and can be connected to the existing Copilot CLI Discord bridge extension. Task results are formatted with status emoji and markdown for readability:

```
🔄 **Fix the auth bug**
ID: `01KQ3ECDV5CJMS9DACYVJGM69K`
Status: running | Agent: @coder | Priority: high
```

---

## Event Store & Observability

Every state change in the system is recorded as an **immutable event** in an append-only event store. This powers audit trails, debugging, UI dashboards, and replay.

### Event Types

| Event | Description |
|-------|-------------|
| `task.created` | New task created |
| `task.queued` | Task entered the queue |
| `task.started` | Copilot session began execution |
| `task.output` | Agent produced output |
| `task.checkpoint` | Session state snapshot saved |
| `task.completed` | Task finished successfully |
| `task.failed` | Task failed with error |
| `task.cancelled` | Task cancelled |
| `task.paused` | Task paused |
| `task.resumed` | Task resumed from pause |
| `task.retrying` | Task retry initiated |
| `approval.requested` | Approval request created |
| `approval.decided` | Approval approved or rejected |
| `session.created` | Copilot session started |
| `session.destroyed` | Copilot session ended |
| `artifact.captured` | Diff, log, or file captured |

### Querying Events

```bash
# Via API
curl http://localhost:7878/api/tasks/01KQ3.../events

# Via SSE stream (real-time)
curl http://localhost:7878/api/events/stream
```

### Retention

Events older than `LOG_RETENTION_DAYS` (default: 30) are automatically pruned by the periodic GC sweep.

---

## Configuration

Configuration is loaded from environment variables with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_MODEL` | `claude-sonnet-4.6` | Default LLM model for the orchestrator |
| `API_PORT` | `7878` | HTTP API port |
| `MAX_CONCURRENT_SESSIONS` | `4` | Maximum simultaneous Copilot sessions |
| `MAX_RETRIES_PER_TASK` | `3` | Default retry limit for failed tasks |
| `RETRY_BACKOFF_MS` | `2000` | Base backoff delay for retries (exponential) |
| `WORKTREE_RETENTION_MINUTES` | `60` | How long to keep completed worktrees |
| `LOG_RETENTION_DAYS` | `30` | How long to keep events in the store |
| `GHC_MOCK_COPILOT` | `0` | Set to `1` to use mock adapter (no subscription needed) |

Create a `.env` file in the project root or set variables in your shell.

### Data Directory

All persistent data lives in `~/.ghc-orchestrator/`:

```
~/.ghc-orchestrator/
├── orchestrator.db     # SQLite database (tasks, events, approvals)
├── agents/             # Custom agent definitions
├── worktrees/          # Task-isolated git worktrees
├── wiki/               # Wiki memory pages
│   └── pages/
└── logs/               # Application logs
```

---

## Project Structure

```
ghc-orchestrator/
├── package.json
├── tsconfig.json
├── vitest.config.ts
│
├── src/
│   ├── index.ts                         # CLI entry point
│   ├── daemon.ts                        # Daemon (HTTP + scheduler + GC)
│   ├── lib.ts                           # Barrel exports
│   ├── config.ts                        # Configuration (Zod-validated)
│   ├── paths.ts                         # Data directory paths
│   │
│   ├── control-plane/
│   │   ├── task-model.ts                # Task schema, state machine, event types
│   │   ├── task-manager.ts              # Task CRUD + transitions + events
│   │   ├── scheduler.ts                 # Priority queue + admission control
│   │   ├── policy-engine.ts             # Permission rules + evaluation
│   │   ├── approval-manager.ts          # Approval request lifecycle
│   │   └── event-bus.ts                 # EventEmitter-based pub/sub
│   │
│   ├── execution/
│   │   ├── copilot-adapter.ts           # Copilot SDK wrapper (real + mock)
│   │   ├── session-pool.ts              # Concurrent session management
│   │   ├── session-runner.ts            # Task execution via Copilot
│   │   ├── agent-loader.ts             # .agent.md parser
│   │   ├── worktree-manager.ts          # Git worktree lifecycle
│   │   ├── artifact-collector.ts        # Diff/log/file capture
│   │   ├── task-dag.ts                  # DAG execution engine
│   │   └── multi-repo.ts               # Cross-repo coordination
│   │
│   ├── mcp/
│   │   ├── server.ts                    # MCP server (12 tools)
│   │   └── apps/
│   │       └── task-board.html          # MCP Apps dashboard
│   │
│   ├── surfaces/
│   │   ├── api.ts                       # Express REST API + SSE
│   │   └── discord.ts                   # Discord command adapter
│   │
│   ├── store/
│   │   ├── db.ts                        # SQLite connection + migrations
│   │   ├── task-repo.ts                 # Task persistence
│   │   └── event-repo.ts               # Event persistence
│   │
│   └── wiki/
│       └── wiki-manager.ts              # Wiki memory system
│
├── agents/                              # Built-in agent definitions
│   ├── orchestrator.agent.md
│   ├── coder.agent.md
│   ├── designer.agent.md
│   └── general-purpose.agent.md
│
├── plugin/                              # VS Code Agent Plugin
│   ├── plugin.json
│   ├── .mcp.json
│   ├── skills/orchestrator/SKILL.md
│   └── hooks/hooks.json
│
└── tests/
    └── unit/                            # 114 tests across 11 suites
        ├── task-model.test.ts
        ├── task-manager.test.ts
        ├── event-store.test.ts
        ├── session-pool.test.ts
        ├── agent-loader.test.ts
        ├── scheduler.test.ts
        ├── policy-engine.test.ts
        ├── approval-manager.test.ts
        ├── wiki-manager.test.ts
        ├── discord.test.ts
        └── task-dag.test.ts
```

---

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the daemon |
| `npm run dev` | Start with auto-reload (watch mode) |
| `npm run cli` | Run CLI commands |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Type-check without emitting |

### Running Tests

```bash
npm test
```

```
 ✓ tests/unit/task-model.test.ts       (20 tests)
 ✓ tests/unit/task-manager.test.ts     (22 tests)
 ✓ tests/unit/event-store.test.ts       (9 tests)
 ✓ tests/unit/session-pool.test.ts      (7 tests)
 ✓ tests/unit/agent-loader.test.ts      (6 tests)
 ✓ tests/unit/scheduler.test.ts         (7 tests)
 ✓ tests/unit/policy-engine.test.ts     (8 tests)
 ✓ tests/unit/approval-manager.test.ts  (7 tests)
 ✓ tests/unit/wiki-manager.test.ts     (10 tests)
 ✓ tests/unit/discord.test.ts           (6 tests)
 ✓ tests/unit/task-dag.test.ts         (12 tests)

 Test Files  11 passed (11)
      Tests  114 passed (114)
```

### Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js 18+ | Copilot SDK is Node-native |
| Language | TypeScript (ESM) | Type safety, matches Copilot ecosystem |
| Copilot SDK | `@github/copilot-sdk` | Core execution engine |
| Database | SQLite (`better-sqlite3`) | Embedded, zero-infra, fast |
| HTTP | Express 5 | Proven, lightweight |
| Validation | Zod | Runtime + static type safety |
| MCP | `@modelcontextprotocol/sdk` | Standard agent-tool protocol |
| Testing | Vitest | Fast, ESM-native |

---

## Comparison

### vs MAX

MAX is the closest project — a personal AI assistant by Burke Holland built on the same Copilot SDK. GHC Orchestrator differs in:

- **Scheduler** — MAX dispatches immediately; GHC has priority queues with admission control
- **Policies** — MAX has no permission model; GHC has a full policy engine with RBAC
- **Approvals** — MAX auto-approves everything; GHC has first-class approval workflows
- **DAG execution** — MAX runs tasks linearly; GHC supports arbitrary dependency graphs
- **Event sourcing** — MAX logs to SQLite; GHC has an append-only event store powering audit trails and replay
- **VS Code** — MAX targets Telegram/TUI; GHC targets VS Code Agents App with MCP Apps dashboards
- **Multi-repo** — MAX works on one repo at a time; GHC coordinates across repositories

### vs OpenClaw

OpenClaw replaces Copilot's internal agent loop with its own, which degrades output quality. GHC Orchestrator preserves Copilot's full agent runtime and orchestrates *around* it.

---

## License

MIT

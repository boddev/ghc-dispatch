# GHC Orchestrator

**A Copilot-native agent orchestration platform.**

Orchestrate GitHub Copilot — don't replace it. GHC Dispatch adds workflow orchestration, background automation, MCP-based extensibility, and VS Code Agents App observability on top of the GitHub Copilot SDK, preserving the full quality of Copilot's internal agent loop.

```
❌  Generic agent → Copilot (model)            ← degrades quality
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
- [Teams](#teams)
- [Task Lifecycle](#task-lifecycle)
- [Scheduler & Admission Control](#scheduler--admission-control)
- [Policy Engine](#policy-engine)
- [Approval Workflows](#approval-workflows)
- [DAG Execution](#dag-execution)
- [Multi-Repo Coordination](#multi-repo-coordination)
- [Wiki Memory](#wiki-memory)
- [Memory System](#memory-system)
- [Skills](#skills)
- [Automation](#automation)
- [Proactive Check-Ins](#proactive-check-ins)
- [GitHub Events](#github-events)
- [Email & Calendar](#email--calendar)
- [Browser Automation](#browser-automation)
- [Model Switching](#model-switching)
- [VS Code Integration](#vs-code-integration)
- [Discord Integration](#discord-integration)
- [Event Store & Observability](#event-store--observability)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development](#development)

---

## Why

GitHub Copilot produces the best results when it runs as a **full agent system** — context, tools, orchestration, and model tuning all working together. Generic agent frameworks that treat Copilot as a raw model replace its best parts and degrade quality.

GHC Dispatch takes a different approach: **keep Copilot as the execution brain** and add orchestration *around* it. You get the workflow power of an orchestration platform with the code quality of native Copilot.

### Key Features

| Feature | GHC Dispatch |
|---------|-------------|
| Copilot quality preserved | ✅ |
| Task DAG execution | ✅ |
| Priority scheduler | ✅ |
| Policy engine (RBAC) | ✅ |
| Approval workflows | ✅ |
| Event-sourced audit trail | ✅ |
| VS Code Agents App | ✅ |
| MCP Apps dashboard | ✅ |
| Multi-repo coordination | ✅ |
| Multi-surface (CLI/API/Discord/VS Code) | ✅ |

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
npm run build
npm link          # Makes 'dispatch' available globally in your terminal
```

### Start the Daemon

```bash
# With real Copilot SDK (requires active subscription)
dispatch --start

# With mock Copilot (for testing without subscription)
GHC_MOCK_COPILOT=1 dispatch --start
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
dispatch --create "Fix the auth bug" --agent @coder --priority high

# Via API
curl -X POST http://localhost:7878/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix the auth bug","agent":"@coder","priority":"high"}'
```

---

## CLI Reference

```
dispatch --<command> [arguments] [options]
```

| Command | Description |
|---------|-------------|
| `--create <title>` | Create a new task |
| `--status <task-id>` | Show task details |
| `--list` | List all tasks |
| `--enqueue <task-id>` | Queue a pending task for execution |
| `--cancel <task-id>` | Cancel a task |
| `--retry <task-id>` | Retry a failed task |
| `--events <task-id>` | Show event history for a task |
| `--stats` | Show task statistics |
| `--model` | Show current model and agent overrides |
| `--model <name>` | Switch the default model |
| `--model <name> --agent <a>` | Switch model for a specific agent |
| `--models` | List all available models |
| `--reload` | Hot-reload agents and skills without restart |
| `--update` | Update dispatch to the latest version |
| `--restart` | Restart the daemon (spawns replacement, exits) |
| `--start` | Start the orchestrator daemon |
| `--version` | Show version |
| `--help` | Show usage information |

### Create Options

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <name>` | Agent to assign | `@general-purpose` |
| `--priority <level>` | `critical` \| `high` \| `normal` \| `low` | `normal` |
| `--model <model>` | Model override for this task | *(agent default)* |
| `--repo <path>` | Target repository path | — |
| `--description <text>` | Task description | — |

### List Options

| Flag | Description | Default |
|------|-------------|---------|
| `--filter-status <status>` | Filter by task status | *(all)* |
| `--limit <n>` | Max results | `20` |

### Examples

```bash
# Create a high-priority coding task
dispatch --create "Refactor auth module" --agent @coder --priority high --repo ~/dev/myapp

# List only running tasks
dispatch --list --filter-status running

# View task details
dispatch --status 01KQ3ECDV5CJMS9DACYVJGM69K

# Cancel a task with a reason
dispatch --cancel 01KQ3ECDV5CJMS9DACYVJGM69K --reason "No longer needed"

# View event history
dispatch --events 01KQ3ECDV5CJMS9DACYVJGM69K

# Start the daemon
dispatch --start
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

### Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List models, current default, and agent overrides |
| `GET` | `/api/models/current` | Get current default model |
| `POST` | `/api/models/switch` | Switch default or per-agent model (`{model, agent?}`) |
| `POST` | `/api/models/reset` | Clear agent model override (`{agent}`) |

### Conversations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/conversations` | Log a message (channel, speaker, content) |
| `GET` | `/api/conversations` | List recent messages (`?channel=cli&limit=50`) |
| `GET` | `/api/conversations/search` | Search messages (`?q=JWT&channel=discord`) |
| `GET` | `/api/conversations/threads` | List conversation threads (`?channel=cli`) |
| `GET` | `/api/conversations/thread/:channel/:threadId` | Get all messages in a thread |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memory/suggest` | Get relevance suggestions for a message |
| `POST` | `/api/memory/context` | Build context string for a conversation |
| `GET` | `/api/memory/facts` | Query extracted facts (`?entity=alice&q=TypeScript`) |
| `GET` | `/api/memory/entities` | List all known entities with fact counts |
| `GET` | `/api/memory/profile/:entity` | Get everything known about an entity |
| `GET` | `/api/memory/episodes` | Query episodic summaries (`?q=auth&date=2026-04-26`) |
| `GET` | `/api/memory/stats` | Memory system statistics |

### Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills` | List all skills (grouped: userInstalled / systemCreated) |
| `GET` | `/api/skills/:id` | Get skill details |
| `GET` | `/api/skills/:id/content` | Read SKILL.md content |
| `POST` | `/api/skills/create` | Create a system skill (name, description, instructions) |
| `POST` | `/api/skills/install/github` | Install from GitHub repo (repoUrl) |
| `POST` | `/api/skills/install/registry` | Install from skills.sh (name) |
| `POST` | `/api/skills/:id/enable` | Enable a skill |
| `POST` | `/api/skills/:id/disable` | Disable a skill |
| `DELETE` | `/api/skills/:id` | Remove a skill |

### Automation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/automation` | List all automation jobs (`?type=cron`) |
| `GET` | `/api/automation/:id` | Get job details |
| `POST` | `/api/automation` | Create a new automation job |
| `POST` | `/api/automation/:id/enable` | Enable a job |
| `POST` | `/api/automation/:id/disable` | Disable a job |
| `POST` | `/api/automation/:id/run` | Manually trigger a job |
| `DELETE` | `/api/automation/:id` | Remove a job |
| `POST` | `/api/webhooks/:path` | Incoming webhook trigger |

### Teams

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams` | List all teams |
| `POST` | `/api/teams` | Create a team (`name`, `description`, `leadAgent`, `memberAgents`, `metadata`) |
| `GET` | `/api/teams/:id` | Get team details |
| `DELETE` | `/api/teams/:id` | Delete a team |
| `POST` | `/api/teams/:id/run` | Dispatch a task to the full team (`title`, `description?`, `repo?`, `preApproved?`) |

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
| `list_teams` | List all configured agent teams |
| `run_team` | Dispatch a task to a full agent team (lead + members) |
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
| `domain` | No | Subject-area label (e.g., `software-engineering`, `ui-ux-design`) — used for routing hints |
| `teamType` | No | Team role category (e.g., `engineering`, `design`, `general`, `orchestration`) |
| `teamRoles` | No | Array of roles this agent can fill on a team (e.g., `["specialist", "implementer"]`) |
| `preferredTasks` | No | List of task types this agent handles well — informs routing |
| `antiTasks` | No | Task types to decline and escalate to another agent |
| `handoffStyle` | No | Description of how this agent summarizes completed work for the team lead |
| `leadershipStyle` | No | How this agent leads when acting as team lead |

The agent format is compatible with [VS Code Agent Plugins](https://code.visualstudio.com/docs/copilot/customization/agent-plugins).

---

## Teams

Agent teams group a **lead agent** and one or more **specialist members** to collaborate on a shared goal. The lead plans and coordinates; members execute their assigned scopes independently and report back.

### How Teams Work

1. The team lead receives the goal, reviews team composition, creates a plan, and delegates subtasks to members.
2. Each member executes its scoped assignment as a full Copilot session and delivers a handoff summary.
3. The lead collects member outputs, validates completeness, and produces a unified result for the user.

### Built-in Team: Software Dev

| Role | Agent | Responsibilities |
|------|-------|-----------------|
| Team Lead | `@orchestrator` | Planning, delegation, synthesis, status reporting |
| Engineering | `@coder` | Code implementation, debugging, testing, CI/CD |
| Design | `@designer` | UI/UX components, styling, accessibility |
| Research / Docs | `@general-purpose` | Research, documentation, data processing |

**Ideal for:** multi-component features (backend + frontend + docs), codebase audits, sprint-scale parallel work.

### Running a Team Task

```bash
# Via HTTP API
curl -X POST http://localhost:7878/api/teams/:id/run \
  -H "Content-Type: application/json" \
  -d '{"title":"Add dark mode support","description":"...","preApproved":true}'

# Via MCP / chat
run_team { "teamId": "<id>", "title": "Add dark mode support" }
```

See [`agents/teams.md`](agents/teams.md) for full team documentation, community teams, and how to create new teams.

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
TASK_A=$(dispatch --create "Build frontend" | grep -oP '01K\w+')
TASK_B=$(dispatch --create "Build backend" | grep -oP '01K\w+')
dispatch --create "Deploy" --depends-on $TASK_A,$TASK_B
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

GHC Orchestrator includes a wiki-based memory system. It stores knowledge as interlinked markdown pages — organized like a personal Obsidian vault.

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

## Memory System

GHC Dispatch has a three-part memory system that learns from every conversation, works across all channels, and proactively surfaces relevant context.

### Conversation Log

Every message across every channel is stored in SQLite with full metadata — channel, thread, speaker identity, speaker type (user/agent/system), and timestamp. This enables cross-channel awareness: if you discuss JWT tokens in Discord, that context is available when you're working on auth in the CLI.

```bash
# Search across all channels
curl "http://localhost:7878/api/conversations/search?q=JWT"

# Search within a specific channel
curl "http://localhost:7878/api/conversations/search?q=JWT&channel=discord"

# List conversation threads
curl "http://localhost:7878/api/conversations/threads?channel=discord"
```

### Episodic Memory

A background writer periodically summarizes idle conversation threads into wiki pages at `conversations/YYYY-MM-DD.md`. Each summary includes:

- **Condensed digest** — speaker-attributed message summary
- **Topics** — automatically extracted (authentication, deployment, testing, etc.)
- **Entities** — speakers, @mentions, and repository references cross-linked as `[[wiki links]]`
- **Decisions** — statements matching decision patterns ("decided to...", "let's...", "agreed to...")

Summaries are searchable — ask "what did we discuss about deployment last week?" and get the relevant episodic summaries.

```bash
# Search episodic summaries
curl "http://localhost:7878/api/memory/episodes?q=deployment"

# Get summaries for a specific date
curl "http://localhost:7878/api/memory/episodes?date=2026-04-26"
```

### Proactive Memory

The system analyzes every message to extract facts about users and agents:

| Category | Example Extraction |
|----------|-------------------|
| Preferences | "I prefer TypeScript" → `prefers TypeScript over JavaScript` |
| Identity | "I work at Microsoft" → `works at Microsoft` |
| Work patterns | "I usually start at 9am" → `schedule: 9am` |
| Tools | "Switched to Vitest" → `mentioned switching to/from Vitest` |
| Projects | "myapp deploys to Vercel" → `deploys to Vercel` |

Facts are extracted for **both users and agents**. The more `@coder` runs, the better dispatch understands its patterns and can service it. Facts are stored in the `memory_facts` database table and simultaneously filed into wiki entity pages.

```bash
# See everything known about a user
curl "http://localhost:7878/api/memory/profile/alice"

# List all known entities
curl "http://localhost:7878/api/memory/entities"

# Search facts
curl "http://localhost:7878/api/memory/facts?q=TypeScript"
```

### Cross-Channel Relevance

When you send a message, dispatch can suggest related context from past conversations in **any** channel, extracted facts, episodic summaries, and wiki pages:

```bash
# Get suggestions for a current message
curl -X POST http://localhost:7878/api/memory/suggest \
  -H "Content-Type: application/json" \
  -d '{"message":"Fix the JWT token expiry","channel":"cli"}'

# Response includes:
# - Past messages from Discord about JWT (cross-channel)
# - Extracted fact: "alice prefers refresh token rotation"
# - Episodic summary: "2026-04-25 discussion about auth token lifecycle"
# - Wiki page: [[authentication]] — project auth documentation
```

The `buildContextForConversation` endpoint assembles a full context string with participant profiles and relevant history, ready to inject into an agent prompt:

```bash
curl -X POST http://localhost:7878/api/memory/context \
  -H "Content-Type: application/json" \
  -d '{"message":"Set up the project","speakers":["alice"],"channel":"vscode"}'
```

---

## Skills

GHC Dispatch has a full skill management system. Skills are SKILL.md instruction files that teach agents how to use external tools.

### Skill Categories

| Category | Description | Example |
|----------|-------------|---------|
| **User-installed** | Manually installed by the user from registries or repos | `kubectl`, `terraform` |
| **System-created** | Autonomously created by dispatch when it learns a new tool | `docker-compose`, `azure-cli` |
| **Registry** | Installed from skills.sh community library | Official skill packages |
| **GitHub** | Installed from any public GitHub repository | Custom org skills |

### Installing Skills

```bash
# From skills.sh registry
curl -X POST http://localhost:7878/api/skills/install/registry \
  -H "Content-Type: application/json" \
  -d '{"name":"kubernetes"}'

# From any GitHub repo
curl -X POST http://localhost:7878/api/skills/install/github \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/org/my-skill"}'
```

### Self-Learning

When dispatch encounters a task that requires unknown tools, it can research the CLI tools available on the machine and create a SKILL.md automatically:

```bash
# System creates skill autonomously
curl -X POST http://localhost:7878/api/skills/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Docker Compose",
    "description": "Manages multi-container Docker applications",
    "instructions": "Use docker compose commands to manage containers..."
  }'
```

System-created skills are tracked separately from user-installed skills, so you always know what was installed manually vs what the system taught itself.

### Managing Skills

```bash
# List all skills (grouped by origin)
curl http://localhost:7878/api/skills

# Read a skill's SKILL.md content
curl http://localhost:7878/api/skills/kubernetes/content

# Disable a skill without removing it
curl -X POST http://localhost:7878/api/skills/kubernetes/disable

# Remove a skill entirely
curl -X DELETE http://localhost:7878/api/skills/kubernetes
```

---

## Automation

GHC Dispatch supports three types of automation triggers for scheduling and reactive execution.

### Trigger Types

| Type | Description | Example |
|------|-------------|---------|
| **Cron** | Periodic execution on a schedule | "Run tests every hour" |
| **Webhook** | HTTP endpoint that triggers on incoming requests | "Deploy when CI passes" |
| **Event** | React to internal system events | "Create review task when any task completes" |

### Cron Jobs

```bash
# Run nightly test suite
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nightly tests",
    "type": "cron",
    "schedule": "daily",
    "action": "create_task",
    "actionConfig": {
      "title": "Run nightly test suite",
      "agent": "@coder",
      "priority": "high"
    }
  }'

# Supported schedules: "every 5 minutes", "every 2 hours", "hourly", "daily"
```

### Webhooks

```bash
# Create a webhook for CI notifications
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI complete",
    "type": "webhook",
    "webhookPath": "ci-notify",
    "action": "create_task",
    "actionConfig": {
      "title": "CI passed — run integration tests",
      "agent": "@coder"
    }
  }'

# Trigger it from your CI pipeline
curl -X POST http://localhost:7878/api/webhooks/ci-notify \
  -H "Content-Type: application/json" \
  -d '{"commit":"abc123","branch":"main"}'
```

### Event-Driven Triggers

```bash
# Auto-create a review task whenever any task completes
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Auto-review",
    "type": "event",
    "eventType": "task.completed",
    "action": "create_task",
    "actionConfig": {
      "title": "Review completed work",
      "agent": "@coder"
    }
  }'
```

Supported event types: `task.created`, `task.queued`, `task.started`, `task.completed`, `task.failed`, `task.cancelled`, `approval.requested`, `approval.decided`

### Action Types

| Action | Description |
|--------|-------------|
| `create_task` | Create a new orchestrator task with configurable title, agent, priority |
| `run_command` | Execute a shell command |
| `http_request` | Make an HTTP request to an external URL |
| `log` | Log a message (useful for testing triggers) |

---

## Proactive Check-Ins

Dispatch periodically evaluates system state and reaches out with relevant information — like a coworker who notices things and taps your shoulder.

### What Gets Checked

| Check | Trigger |
|-------|---------|
| Failed tasks | Tasks that failed but haven't been retried |
| Expiring approvals | Approvals expiring within 15 minutes |
| Stuck tasks | Tasks running for over 30 minutes |
| Stale queue | Tasks waiting in queue for 10+ minutes |
| Recurring failures | Same agent failing 3+ times |
| Daily summary | Conversation activity across channels |

### Configuration

Check-ins run every 30 minutes by default. They push notifications to any registered handler (Discord, VS Code, console).

```bash
# Trigger a check-in on demand
curl http://localhost:7878/api/checkin
```

---

## GitHub Events

Point your GitHub repo webhook settings at dispatch to automatically react to repository events.

### Setup

1. Go to your GitHub repo → Settings → Webhooks → Add webhook
2. Set Payload URL to: `http://your-dispatch-host:7878/api/webhooks/github`
3. Set Content type to: `application/json`
4. Select events: Push, Pull requests, Issues, Check runs, Workflow runs

### Supported Events

| Event | Action | What Dispatch Does |
|-------|--------|-------------------|
| `pull_request.opened` | PR opened | Creates a review task |
| `issues.opened` | Issue created | Creates an investigation task (bug label → high priority) |
| `check_run.completed` (failure) | CI failed | Creates a high-priority fix task |
| `workflow_run.completed` (failure) | GitHub Actions failed | Creates a high-priority fix task |
| `push` | Code pushed | Logged to memory |
| `issue_comment` | Comment added | Logged to memory |
| `release.published` | New release | Logged to memory |

All events are logged to the conversation memory system (channel: `github`) for cross-channel awareness.

---

## Email & Calendar

Dispatch includes skills for both Google Workspace and Microsoft 365. Copilot agent sessions can use these skills to read email, send messages, manage calendar events, and access files.

### Google Workspace (via gogcli)

**Prerequisites:** Install `gogcli` — `brew install steipete/tap/gogcli`

```bash
# Gmail: search unread emails
gog gmail search 'is:unread newer_than:1d' --max 10 --json

# Calendar: today's events
gog calendar events --time-min "$(date -I)" --json

# Drive: search files
gog drive search "quarterly report" --json
```

### Microsoft 365 (via Graph API)

**Prerequisites:** `mgc` CLI or Azure AD token via `az account get-access-token`

```bash
# Outlook: unread emails
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$filter=isRead eq false&\$top=10"

# Calendar: today's events
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=$(date -u +%Y-%m-%dT00:00:00Z)&endDateTime=$(date -u +%Y-%m-%dT23:59:59Z)"

# OneDrive: search files
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root/search(q='report')"
```

Both skills are SKILL.md files in `skills/` — Copilot agents learn to use them automatically when loaded into a session.

### Browser Automation

Dispatch includes a full Playwright-powered browser engine that supports natural language commands. In addition to the AI-driven browsing available through Copilot agent sessions, dispatch provides deterministic, scriptable browser automation.

#### Natural Language Commands

```bash
# Navigate with natural language
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"go to github.com"}'

# Click by visible text
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"click Sign in"}'

# Fill a form field
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"fill \"alice@example.com\" in email"}'

# Search Google
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"search for playwright testing framework"}'

# Read page content
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"read the page"}'

# Screenshot
curl -X POST http://localhost:7878/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{"command":"take a screenshot"}'
```

#### Supported Natural Language Patterns

| Pattern | Example |
|---------|---------|
| `go to <url>` | "go to github.com", "open docs.microsoft.com" |
| `click <text>` | "click Sign in", "click the Submit button" |
| `fill <value> in <field>` | "fill 'alice' in username" |
| `set <field> to <value>` | "set email to alice@example.com" |
| `scroll down/up` | "scroll down" |
| `go back` | "go back" |
| `search for <query>` | "search for playwright docs" |
| `read the page` | "read page content" |
| `screenshot` | "take a screenshot" |
| `press <key>` | "press Enter" |

#### Direct API

For precise control, use the direct browser endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/browser/command` | Execute natural language browser command |
| `POST` | `/api/browser/navigate` | Navigate to URL |
| `POST` | `/api/browser/click` | Click by text or CSS selector |
| `POST` | `/api/browser/fill` | Fill input by label, placeholder, or selector |
| `POST` | `/api/browser/press` | Press keyboard key |
| `POST` | `/api/browser/scroll` | Scroll up or down |
| `GET` | `/api/browser/page` | Get page info (title, links, inputs, buttons) |
| `GET` | `/api/browser/screenshot` | Capture screenshot (base64 PNG) |
| `GET` | `/api/browser/text` | Extract page text (optional selector) |
| `GET` | `/api/browser/status` | Browser state and navigation history |

---

## Model Switching

Switch models at runtime without editing config files or restarting the daemon.

### Resolution Chain (highest priority first)

| Level | How to set | Scope |
|-------|-----------|-------|
| 1. Per-task | `--model gpt-5.5` on create | Single task only |
| 2. Agent override | `dispatch --model gpt-5.4 --agent @coder` | All tasks for that agent until cleared |
| 3. Agent definition | `model:` field in `.agent.md` | All tasks for that agent (default) |
| 4. Global default | `dispatch --model claude-opus-4.7` | Everything else |

### CLI

```bash
# Show current model and any agent overrides
dispatch --model

# Switch the global default (persisted across restarts)
dispatch --model claude-opus-4.7

# Switch model for a specific agent (persisted, doesn't edit .agent.md)
dispatch --model gpt-5.4 --agent @coder

# List all 16 available models
dispatch --models

# Create a task with a one-time model override
dispatch --create "Complex analysis" --agent @coder --model gpt-5.5
```

### API

```bash
# List models with current default and overrides
curl http://localhost:7878/api/models

# Switch default
curl -X POST http://localhost:7878/api/models/switch \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4.7"}'

# Switch per-agent
curl -X POST http://localhost:7878/api/models/switch \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","agent":"@coder"}'

# Clear an agent override (falls back to .agent.md definition)
curl -X POST http://localhost:7878/api/models/reset \
  -H "Content-Type: application/json" \
  -d '{"agent":"@coder"}'
```

### Discord

```
!dispatch model                          # show current
!dispatch model claude-opus-4.7          # switch default
!dispatch model gpt-5.4 --agent @coder  # switch per-agent
```

### Available Models

| ID | Provider | Tier |
|----|----------|------|
| `claude-sonnet-4.6` | Anthropic | standard |
| `claude-opus-4.7` | Anthropic | premium |
| `gpt-5.5` | OpenAI | premium |
| `gpt-5.4` | OpenAI | standard |
| `gpt-5.4-mini` | OpenAI | free |
| `gemini-2.5-pro` | Google | standard |
| *...and 10 more* | | |

Run `dispatch --models` for the full list.

---

## VS Code Integration

GHC Dispatch integrates with VS Code through three mechanisms: a dedicated **VS Code Extension**, an **Agent Plugin**, and **Agents App** session visibility.

### 1. VS Code Extension (`dispatch-vscode/`)

A full extension that adds a "Dispatch" icon to the activity bar with 5 sidebar panels:

| Panel | Contents |
|-------|----------|
| **Tasks** | Real-time task list grouped by status (running → queued → pending → ...). Click any task to open a detail webview with events, actions, and result. |
| **Agents** | Loaded agent definitions with model info |
| **Skills** | Skills grouped by User-Installed vs System-Created. Right-click to enable/disable. |
| **Automation** | Cron jobs, webhooks, and event triggers with run counts |
| **Approvals** | Pending approval requests with Approve/Reject context actions |

**Commands** (Command Palette):
- `Dispatch: Create Task` — input wizard for title, agent, priority
- `Dispatch: Show Stats` — task counts, queue, sessions, memory stats
- `Dispatch: Recall Memory` — cross-channel memory search with results picker
- `Dispatch: Memory Explorer` — browse facts, entities, episodes, conversations

**Status Bar**: Always-visible badge showing running/queued task count.

**Real-time**: SSE connection to the daemon pushes live task state changes. VS Code notifications fire for task completion/failure and approval requests (with Approve/Reject buttons).

**Setup**: Start the daemon (`dispatch --start`), install the extension, the Dispatch icon appears in the activity bar.

### 2. Agent Plugin

The `plugin/` directory is a [VS Code Agent Plugin](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) that adds MCP tools, agents, and skills to VS Code chat:

```
plugin/
├── plugin.json          # Plugin manifest
├── .mcp.json            # MCP server configuration
├── agents/              # Agent definitions
├── skills/orchestrator/ # Usage instructions for Copilot
└── hooks/hooks.json     # Lifecycle hooks
```

### 3. Agents App Session Visibility

When dispatch creates real Copilot SDK sessions (not mock), those sessions appear automatically in the VS Code Agents App sidebar. The Agents App provides:
- Session list with progress tracking
- Inline diff review and PR creation
- Agent Debug Log panel
- Worktree isolation per session (v1.117+)

Note: The Agents App does not expose a public API for third-party session registration — dispatch sessions appear because they are native Copilot SDK sessions.

---

## Discord Integration

GHC Dispatch includes a full Discord bot built on [discord.js](https://discord.js.org/). It connects to your Discord server, listens in configured channels, handles commands and natural language, and pushes event notifications.

### Setup

1. Create a bot at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable the **Message Content Intent** under Bot settings
3. Invite the bot to your server with `Send Messages`, `Read Message History`, and `Embed Links` permissions
4. Configure environment variables:

```bash
DISCORD_BOT_TOKEN=your-bot-token-here
DISCORD_ALLOWED_CHANNELS=channel-id-1,channel-id-2   # empty = all channels
DISCORD_COMMAND_PREFIX=!dispatch                       # default
```

5. Start dispatch: `dispatch --start`

### Commands

| Command | Description |
|---------|-------------|
| `!dispatch create "title" [--agent @coder] [--priority high]` | Create a task |
| `!dispatch list [--status running]` | List tasks |
| `!dispatch status <task-id>` | Show task details |
| `!dispatch cancel <task-id>` | Cancel a task |
| `!dispatch retry <task-id>` | Retry a failed task |
| `!dispatch enqueue <task-id>` | Queue a pending task |
| `!dispatch approve <approval-id>` | Approve a request |
| `!dispatch reject <approval-id>` | Reject a request |
| `!dispatch agents` | List available agents |
| `!dispatch skills` | List installed skills (user vs system) |
| `!dispatch stats` | System statistics |
| `!dispatch recall <topic>` | Search memory across all channels |
| `!dispatch help` | Full command reference |

### Natural Language

Mention the bot (`@dispatch`) or send a DM. Action-oriented messages automatically create tasks:

> **You:** @dispatch fix the login bug in the auth module
> **Dispatch:** 📋 Created task: `01KQ5...` — fix the login bug in the auth module
> 💡 **Related context:**
> > [alice]: The JWT token expires after 15 minutes *(from cli)*

### Event Notifications

The bot pushes notifications back to Discord when:
- ✅ A task created from Discord completes
- ❌ A task created from Discord fails
- ⚠️ An approval is requested (with approve/reject instructions)

### Cross-Channel Awareness

All Discord messages are logged to the conversation memory system. Context from CLI, VS Code, or API conversations is surfaced in Discord replies. Use `!dispatch recall <topic>` to explicitly search across all channels.

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
│   │   ├── model-manager.ts            # Runtime model switching + persistence
│   │   ├── hot-reloader.ts             # fs.watch auto-reload for agents/skills
│   │   └── self-manage.ts              # Self-update + self-restart
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
│   │   ├── discord.ts                   # Discord command parser utilities
│   │   └── discord-bot.ts              # Full Discord bot (discord.js)
│   │
│   ├── store/
│   │   ├── db.ts                        # SQLite connection + migrations
│   │   ├── task-repo.ts                 # Task persistence
│   │   ├── event-repo.ts               # Event persistence
│   │   └── conversation-repo.ts         # Cross-channel conversation log
│   │
│   ├── memory/
│   │   ├── memory-manager.ts            # Orchestrates all memory subsystems
│   │   ├── episodic-writer.ts           # Conversation → wiki summaries
│   │   └── proactive-extractor.ts       # Fact extraction from messages
│   │
│   ├── skills/
│   │   └── skill-manager.ts             # Skill install/create/manage/search
│   │
│   ├── automation/
│   │   ├── automation-scheduler.ts      # Cron, webhooks, event triggers
│   │   ├── proactive-checkin.ts         # Periodic system health check-ins
│   │   └── github-events.ts            # GitHub webhook event handler
│   │
│   ├── browser/
│   │   └── browser-engine.ts            # Playwright browser automation
│   │
│   └── wiki/
│       └── wiki-manager.ts              # Wiki knowledge base
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
├── dispatch-vscode/                     # VS Code Extension
│   ├── ...
│
├── skills/                              # Bundled skills
│   ├── google-workspace/SKILL.md        # Gmail, Calendar, Drive via gogcli
│   └── microsoft-365/SKILL.md           # Outlook, Calendar, OneDrive via Graph API
│
└── tests/
    └── unit/                            # 217 tests across 19 suites
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
        ├── task-dag.test.ts
        ├── conversation-repo.test.ts
        ├── memory-manager.test.ts
        ├── skill-manager.test.ts
        ├── automation-scheduler.test.ts
        └── model-manager.test.ts
```

---

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the daemon |
| `npm run dev` | Start with auto-reload (watch mode) |
| `npm run cli` | Run CLI commands (alternative to `dispatch`) |
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
 ✓ tests/unit/conversation-repo.test.ts (11 tests)
 ✓ tests/unit/memory-manager.test.ts   (13 tests)
 ✓ tests/unit/skill-manager.test.ts    (10 tests)
 ✓ tests/unit/automation-scheduler.test.ts (16 tests)
 ✓ tests/unit/model-manager.test.ts    (19 tests)
 ✓ tests/unit/proactive-checkin.test.ts (5 tests)
 ✓ tests/unit/github-events.test.ts    (9 tests)
 ✓ tests/unit/browser-engine.test.ts   (19 tests)

 Test Files  19 passed (19)
      Tests  217 passed (217)
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

## License

MIT

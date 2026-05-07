# GHC Dispatch

**A Copilot-native agent orchestration platform.**

GHC Dispatch orchestrates GitHub Copilot instead of replacing it. It keeps Copilot as the execution brain and adds a durable control plane for tasks, agents, teams, scheduling, approvals, memory, automation, MCP, Discord, and VS Code.

```text
Generic agent framework -> model API -> custom agent loop
GHC Dispatch            -> Copilot SDK -> native Copilot agent runtime
```

## Documentation

| Document | Purpose |
|---|---|
| [Product Manual](./docs/MANUAL.md) | Complete product reference: commands, APIs, features, concepts, examples, configuration, operations, and troubleshooting |
| [Product Manual PDF](./docs/MANUAL.pdf) | PDF version of the product manual |
| [HOWTO](./docs/HOWTO.md) | Practical setup and workflow recipes |
| [VS Code Extension Walkthrough](./docs/VSCODE-EXTENSION-WALKTHROUGH.md) | Screen-by-screen guide to the VS Code extension |
| [Agent Teams](./agents/teams.md) | Team operating model and examples |

## Highlights

- **Copilot-native execution** - tasks run as GitHub Copilot SDK sessions.
- **Durable task orchestration** - pending, queued, running, paused, completed, failed, and cancelled states.
- **Priority scheduler** - critical/high/normal/low priorities with concurrency limits and starvation prevention.
- **Specialist agents** - built-in `@orchestrator`, `@coder`, `@designer`, and `@general-purpose` agents plus custom `.agent.md` files.
- **Agent teams** - lead/member workflows for multi-domain work.
- **Multiple surfaces** - CLI, TUI, HTTP API, MCP server, VS Code extension, and Discord bot.
- **Policy and approvals** - human gates and rule-based action control.
- **Memory and wiki** - cross-channel conversation log, facts, episodic summaries, and Markdown wiki pages.
- **Automation** - cron jobs, webhooks, internal event triggers, GitHub event handling, and proactive check-ins.
- **Runtime extensibility** - skills, MCP tools, model switching, browser automation, and hot reload.

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Git
- GitHub Copilot access for real Copilot execution

### Install

```bash
git clone https://github.com/boddev/ghc-dispatch.git
cd ghc-dispatch
npm install
npm run build
npm link
```

### Start the daemon

```bash
dispatch --start
```

For local testing without real Copilot execution:

```bash
GHC_MOCK_COPILOT=1 dispatch --start
```

PowerShell:

```powershell
$env:GHC_MOCK_COPILOT = "1"
dispatch --start
```

### Create a task

```bash
dispatch --create "Summarize this repository" --agent @general-purpose --priority normal
dispatch --list
dispatch --enqueue <task-id>
dispatch --events <task-id>
```

Running `dispatch` with no arguments opens the interactive TUI.

## Main Commands

| Command | Purpose |
|---|---|
| `dispatch --create <title>` | Create a task |
| `dispatch --list` | List tasks |
| `dispatch --status <task-id>` | Show task details |
| `dispatch --enqueue <task-id>` | Queue a task |
| `dispatch --cancel <task-id>` | Cancel a task |
| `dispatch --retry <task-id>` | Retry a failed task |
| `dispatch --events <task-id>` | Show event history |
| `dispatch --stats` | Show system stats |
| `dispatch --model [model]` | Show or switch model |
| `dispatch --models` | List models |
| `dispatch --reload` | Hot-reload agents and skills |
| `dispatch --restart` | Restart daemon |
| `dispatch --update` | Update Dispatch |

See the [Product Manual](./docs/MANUAL.md#5-command-line-reference) for the full command reference.

## Architecture

```text
Surface Layer
  CLI / TUI / HTTP API / SSE / MCP / VS Code / Discord

Control Plane
  Task Manager / Scheduler / Policy Engine / Approval Manager / Event Bus

Execution Plane
  Copilot Adapter / Session Pool / Session Runner / Worktree Manager / Artifact Collector

Capability Layer
  Agents / Teams / Skills / MCP Servers / Browser Automation / Memory / Automation

Persistence
  SQLite / event store / scheduler queue / wiki pages / runtime settings
```

## Project Structure

| Path | Purpose |
|---|---|
| `src/` | Daemon, CLI, control plane, execution plane, API, MCP, memory, automation |
| `agents/` | Built-in agent definitions and team docs |
| `skills/` | Bundled skills |
| `plugin/` | VS Code Agent Plugin assets |
| `dispatch-vscode/` | VS Code extension |
| `docs/` | Product manual, HOWTO, and walkthrough docs |
| `tests/` | Vitest unit tests |

## Development

```bash
npm run typecheck
npm run build
npm run test -- --maxWorkers=1
```

For the VS Code extension:

```bash
cd dispatch-vscode
npm run compile
```

## License

MIT

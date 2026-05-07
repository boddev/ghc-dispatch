# GHC Dispatch — How-To Guide

Practical, copy-pasteable recipes for getting GHC Dispatch up and running. For
conceptual overviews and the full feature surface, see [`README.md`](./README.md).

> **Platform note.** All shell snippets are shown in `bash` style. On Windows
> PowerShell, replace `export FOO=bar` with `$env:FOO = "bar"`, and use
> backslashes in paths (`~\.ghc-dispatch`).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [How to build Dispatch from source](#2-how-to-build-dispatch-from-source)
3. [How to install Dispatch globally](#3-how-to-install-dispatch-globally)
4. [How to run the daemon (real Copilot or mock)](#4-how-to-run-the-daemon-real-copilot-or-mock)
5. [How to create and run your first task](#5-how-to-create-and-run-your-first-task)
6. [How to install the VS Code extension from source](#6-how-to-install-the-vs-code-extension-from-source)
7. [How to run the test suite](#7-how-to-run-the-test-suite)
8. [How to update or restart Dispatch](#8-how-to-update-or-restart-dispatch)
9. [How to use the interactive TUI](#9-how-to-use-the-interactive-tui)
10. [How to define a custom agent](#10-how-to-define-a-custom-agent)
11. [How to install and use skills](#11-how-to-install-and-use-skills)
12. [How to schedule automation jobs](#12-how-to-schedule-automation-jobs)
13. [How to set up the Discord bot](#13-how-to-set-up-the-discord-bot)
14. [How to recover paused tasks](#14-how-to-recover-paused-tasks)
15. [How to use Dispatch as an MCP server](#15-how-to-use-dispatch-as-an-mcp-server)
16. [How to switch models at runtime](#16-how-to-switch-models-at-runtime)
17. [How to uninstall](#17-how-to-uninstall)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | `>= 18` | `node --version` |
| npm | bundled with Node | `npm --version` |
| Git | any recent | `git --version` |
| GitHub Copilot CLI | latest | `npm i -g @github/copilot` (active Copilot subscription required) |
| VS Code | `>= 1.115.0` | only needed for the VS Code extension |

If you don't have a Copilot subscription handy, you can still try Dispatch using
the bundled mock adapter — see [§4](#4-how-to-run-the-daemon-real-copilot-or-mock).

---

## 2. How to build Dispatch from source

```bash
git clone https://github.com/boddev/ghc-dispatch.git
cd ghc-dispatch
npm install
npm run build
```

What this does:

- `npm install` — installs runtime + dev dependencies into `node_modules/`.
- `npm run build` — runs `tsc`, emitting compiled JS into `dist/`. The CLI entry
  point is `dist/index.js` (declared in `package.json` → `"bin": { "dispatch": "dist/index.js" }`).

To re-compile on every change while developing:

```bash
npm run dev      # tsx --watch on src/daemon.ts
```

---

## 3. How to install Dispatch globally

After a successful build, link the package so the `dispatch` command is on your
`PATH`:

```bash
npm link
```

Verify:

```bash
dispatch --version
dispatch --help
```

If `npm link` fails with EACCES on macOS/Linux, either run it under your Node
version manager (nvm/asdf/volta) or prefix with `sudo`. On Windows, run the
terminal as Administrator the first time.

To unlink later:

```bash
npm unlink -g ghc-dispatch
```

---

## 4. How to run the daemon (real Copilot or mock)

### With a real GitHub Copilot subscription

```bash
dispatch --start
```

You should see something like:

```
🚀 GHC Dispatch starting...
   Data dir: ~/.ghc-dispatch
   API port: 7878
   Max sessions: 4
   Copilot: SDK adapter started

✅ GHC Dispatch running on http://localhost:7878
```

Health-check it from another terminal:

```bash
curl http://localhost:7878/api/health
```

### Without a subscription (mock adapter)

```bash
GHC_MOCK_COPILOT=1 dispatch --start
```

PowerShell:

```powershell
$env:GHC_MOCK_COPILOT = "1"
dispatch --start
```

### Common environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PORT` | `7878` | HTTP API port |
| `MAX_CONCURRENT_SESSIONS` | `4` | Concurrency cap |
| `COPILOT_MODEL` | `claude-sonnet-4.6` | Default model |
| `COPILOT_DEFAULT_REMOTE` | `1` | When `1`/`true` (default), every Copilot CLI session is steered into remote mode by prepending `/remote` to its first prompt. Set `0` to keep sessions local. |
| `GHC_MOCK_COPILOT` | `0` | `1` = use mock adapter |

Persistent data lives in `~/.ghc-dispatch/` (SQLite db, worktrees, agents, logs).

---

## 5. How to create and run your first task

In a second terminal (the daemon must be running):

```bash
# Create a pending task
dispatch --create "Summarize the README" --agent @general-purpose

# Preview what the task would look like (resolved agent/model/workdir) without persisting
dispatch --create "Summarize the README" --agent @general-purpose --dry-run

# List tasks (note the ULID of the new one)
dispatch --list

# Queue it for execution
dispatch --enqueue <task-id>

# Watch its event history
dispatch --events <task-id>

# Cancel a task with a reason (visible in the VS Code Task Detail panel)
dispatch --cancel <task-id> --reason "No longer needed"
```

Equivalent via the HTTP API:

```bash
curl -X POST http://localhost:7878/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Summarize the README","agent":"@general-purpose"}'

curl -X POST http://localhost:7878/api/tasks/<task-id>/execute
```

For all CLI flags and API endpoints, see the
[CLI Reference](./README.md#cli-reference) and [HTTP API](./README.md#http-api)
sections of the README.

---

## 6. How to install the VS Code extension from source

The extension lives in [`dispatch-vscode/`](./dispatch-vscode). It's not yet
published to the Marketplace, so install it from a locally packaged `.vsix`.

### One-time setup

```bash
cd dispatch-vscode
npm install
npm install -g @vscode/vsce       # only the first time, for `vsce package`
```

### Build and package

```bash
# from dispatch-vscode/
npm run compile                   # tsc -> out/
npm run package                   # produces dispatch-vscode-0.1.0.vsix
```

### Install the .vsix into VS Code

Pick one of:

```bash
# CLI (preferred, scriptable)
code --install-extension dispatch-vscode-0.1.0.vsix
```

Or, in the VS Code UI:

1. Open the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Click the `…` menu → **Install from VSIX…**
3. Pick `dispatch-vscode-0.1.0.vsix`.

### Verify and configure

1. Reload VS Code. The **Dispatch** icon appears in the activity bar.
2. Click the icon. If the daemon isn't already running, the extension runs `dispatch --start` for you (a "Starting Dispatch daemon…" progress notification appears while it polls `/api/health` for up to 30 seconds). This requires the `dispatch` CLI to be on your PATH — see [§3](#3-how-to-install-dispatch-globally).
3. Open **Settings** → search for `Dispatch` to adjust:
   - `dispatch.apiUrl` (default `http://localhost:7878`)
   - `dispatch.autoRefreshInterval` (default `5000` ms; `0` to disable)
   - `dispatch.autoStartDaemon` (default `true` — set to `false` to disable auto-start and start the daemon yourself)
   - `dispatch.maxConcurrentSessions` (synced to the daemon)
   - `dispatch.taskSessionIdleTimeoutMinutes` (synced to the daemon)

### What's in the extension

A few details worth knowing:

- **Create Task** — the webview has a **Dry run (preview only)** checkbox right next to **Pre-approved**. Tick it before clicking Create to see the resolved agent handle, model, priority, repo, and working directory in a panel above the form, *without* creating the task. Untick and click Create to actually create it.
- **Task Detail (cancelled tasks)** — a **Cancellation reason** input appears below the action buttons, pre-filled from `metadata.cancellationReason` or the latest `task.cancelled` event reason. Edit the text and click **Save reason** to update the task. (Reasons set via `dispatch --cancel <id> --reason "…"` show up here automatically.)

### Iterating on the extension

While editing extension code, run a watching compiler:

```bash
cd dispatch-vscode
npm run watch
```

Then press **F5** in VS Code (with the `dispatch-vscode/` folder open) to launch
an **Extension Development Host** with your changes loaded.

---

## 7. How to run the test suite

From the repo root:

```bash
npm run typecheck                 # tsc --noEmit
npm run build                     # full compile, catches emit errors
npm run test -- --maxWorkers=1    # vitest, single-worker for stable SQLite/IO tests
```

Optional coverage on the critical paths:

```bash
npm run test:coverage
```

For the VS Code extension:

```bash
cd dispatch-vscode
npm run compile                   # type-checks + emits to out/
```

---

## 8. How to update or restart Dispatch

If you installed via `npm link` from a working tree, just pull and rebuild:

```bash
cd ghc-dispatch
git pull
npm install
npm run build
```

You can also use the built-in commands while the daemon is running:

```bash
dispatch --reload                 # hot-reload agents and skills (no restart)
dispatch --restart                # spawn a replacement daemon and exit the old one
dispatch --update                 # pull updates and restart
```

---

## 9. How to use the interactive TUI

Run `dispatch` with **no arguments** to launch the readline TUI. If the daemon isn't already running, the TUI prompts you to start one.

```bash
dispatch
```

```text
⚡ Dispatch TUI
  Connected to http://localhost:7878
  Type /help for commands, or type naturally to create tasks.

> /list
> /create "Refactor auth"  @coder  !high
> Refactor the auth module to drop session cookies   ← natural language → task
> /events 01KQ3...
> /quit
```

Common commands:

| Command | Purpose |
|---------|---------|
| `/help` | Show all slash commands |
| `/list [status]` | List tasks |
| `/create "title" [@agent] [!priority]` | Create a task |
| `/status <id>` / `/events <id>` | Inspect one task |
| `/cancel <id>` / `/retry <id>` / `/enqueue <id>` / `/execute <id>` | Task actions |
| `/agents` / `/teams` / `/skills` | Inspect what's loaded |
| `/stats` / `/checkin` / `/automation` | Daemon snapshots |
| `/recall <topic>` | Cross-channel memory search |
| `/approve <id>` / `/reject <id>` | Decide pending approvals |
| `/model <name>` / `/models` | Switch / list models |
| `/reload` / `/restart` / `/update` | Daemon control |

Anything that doesn't start with `/` becomes a task assigned to `@general-purpose` with that text as the title.

---

## 10. How to define a custom agent

Agent definitions are Markdown files in `agents/` (bundled) or `~/.ghc-dispatch/agents/` (user). The frontmatter declares metadata; the body is the system prompt.

Example — `~/.ghc-dispatch/agents/security-auditor.agent.md`:

```markdown
---
name: security-auditor
description: Reviews code for security issues and suggests mitigations.
model: claude-opus-4.7
tools: ["read_file", "grep", "list_dir"]
skills: []
mcpServers: []
---

You are a senior security auditor. For every change you review:
1. Identify potential vulnerabilities (injection, auth bypass, etc.)
2. Cite the line numbers and explain the risk
3. Propose a fix and trade-offs
Never make code changes — review-only.
```

Then either restart the daemon or hot-reload:

```bash
dispatch --reload
dispatch --create "Audit the auth module" --agent @security-auditor --repo ~/dev/myapp
```

You can also generate an agent from a role description:

```bash
curl -X POST http://localhost:7878/api/agents/generate \
  -H "Content-Type: application/json" \
  -d '{"description":"Senior accessibility reviewer for React apps"}'
```

The VS Code extension exposes the same flow via **Create Agent** in the Agents view.

---

## 11. How to install and use skills

Skills are SKILL.md files Copilot agents discover automatically when assigned to a session. You can install them three ways:

```bash
# 1. From the public skills.sh registry
curl -X POST http://localhost:7878/api/skills/install/registry \
  -H "Content-Type: application/json" \
  -d '{"name":"kubernetes"}'

# 2. From a GitHub repo
curl -X POST http://localhost:7878/api/skills/install/github \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/owner/skill-repo"}'

# 3. Author one locally
curl -X POST http://localhost:7878/api/skills/create \
  -H "Content-Type: application/json" \
  -d '{"name":"my-skill","description":"...","instructions":"..."}'
```

Enable / disable / inspect:

```bash
curl http://localhost:7878/api/skills
curl http://localhost:7878/api/skills/kubernetes/content
curl -X POST http://localhost:7878/api/skills/kubernetes/disable
curl -X POST http://localhost:7878/api/skills/kubernetes/enable
curl -X DELETE http://localhost:7878/api/skills/kubernetes
```

The VS Code extension's **Skills** view groups them by user-installed vs system-created with right-click enable / disable / install actions.

---

## 12. How to schedule automation jobs

Three trigger types are supported: `cron`, `webhook`, and `event`. Each job creates a task when it fires.

```bash
# Cron job — every weekday at 09:00
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name":"morning-standup-summary",
    "type":"cron",
    "schedule":"0 9 * * 1-5",
    "task":{"title":"Summarize overnight activity","agent":"@general-purpose"}
  }'

# Webhook — POST /api/webhooks/ci-notify will create a task
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name":"ci-notify",
    "type":"webhook",
    "webhookPath":"ci-notify",
    "task":{"title":"Investigate CI failure","agent":"@coder","priority":"high"}
  }'

# Event — react to a Dispatch event type
curl -X POST http://localhost:7878/api/automation \
  -H "Content-Type: application/json" \
  -d '{
    "name":"on-task-failed",
    "type":"event",
    "eventType":"task.failed",
    "task":{"title":"Triage the failed task","agent":"@general-purpose"}
  }'
```

Manage them with:

```bash
curl http://localhost:7878/api/automation
curl -X POST http://localhost:7878/api/automation/<id>/run        # fire now
curl -X POST http://localhost:7878/api/automation/<id>/disable
curl -X DELETE http://localhost:7878/api/automation/<id>
```

The VS Code extension's **Automation** view lists all jobs with run counts.

---

## 13. How to set up the Discord bot

```bash
# 1. Create a bot in https://discord.com/developers/applications
# 2. Copy the bot token and grab the channel IDs you want it to listen in
# 3. Set environment variables before starting the daemon:

export DISCORD_BOT_TOKEN="..."
export DISCORD_ALLOWED_CHANNELS="123456789012345678,234567890123456789"
export DISCORD_ADMIN_USERS="alice,bob"            # GitHub usernames or Discord IDs
export DISCORD_COMMAND_PREFIX="!dispatch"         # default

dispatch --start
```

In Discord:

```text
!dispatch help
!dispatch create "Investigate the staging outage"  --agent @coder  --priority high
!dispatch list --status running
!dispatch status 01KQ3...
!dispatch recall deployment
```

All Discord traffic is logged to the conversation memory system (channel `discord`) so context flows back into other surfaces.

---

## 14. How to recover paused tasks

If the daemon is killed or restarted while tasks are running, those tasks come back as **paused** with a recovery payload describing the prior session and worktree.

```bash
# See what got paused
dispatch --list --filter-status paused

# Inspect the recovery hints for one task
curl http://localhost:7878/api/tasks/<task-id>/recovery

# Re-run on the existing worktree (keeps partial work)
curl -X POST http://localhost:7878/api/tasks/<task-id>/recovery \
  -H "Content-Type: application/json" \
  -d '{"action":"resume"}'

# Or restart from a clean worktree
curl -X POST http://localhost:7878/api/tasks/<task-id>/recovery \
  -d '{"action":"restart"}'

# Or abandon
curl -X POST http://localhost:7878/api/tasks/<task-id>/recovery \
  -d '{"action":"abandon","reason":"No longer relevant"}'
```

In the VS Code extension, paused tasks show in the **Tasks** view; opening one gives you Resume / Restart / Cancel buttons in the detail panel.

---

## 15. How to use Dispatch as an MCP server

Dispatch ships an MCP server at `src/mcp/server.ts` that exposes tasks, agents, teams, skills, models, conversations, and recovery as MCP tools. Wire it into any MCP-compatible client (VS Code chat, Copilot CLI, Claude Desktop, etc.).

Example `.mcp.json` snippet:

```json
{
  "mcpServers": {
    "dispatch": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ghc-dispatch/src/mcp/server.ts"],
      "env": {
        "DISPATCH_API_URL": "http://localhost:7878"
      }
    }
  }
}
```

The daemon must be running (the MCP server proxies calls to its HTTP API). Try the tools from your client — `dispatch_list_tasks`, `dispatch_create_task`, `dispatch_recall_memory`, etc.

---

## 16. How to switch models at runtime

Models can be switched per-default, per-agent, or per-task without restarting:

```bash
dispatch --models                                  # list available models
dispatch --model claude-opus-4.7                   # change global default
dispatch --model gpt-5.4 --agent @coder            # per-agent override
dispatch --model gpt-5.5 --create "Quick refactor" # per-task override
```

VS Code extension: command palette → **Switch Model** (default, Dispatch Chat, or per-agent).

The resolution chain (highest priority first): per-task override → per-agent override → agent definition `model:` → global default.

---

## 17. How to uninstall

```bash
# Stop the daemon (Ctrl+C in its terminal), then:
npm unlink -g ghc-dispatch        # remove the global `dispatch` command

# (Optional) remove persistent data — this deletes tasks, events, worktrees, wiki:
rm -rf ~/.ghc-dispatch            # PowerShell: Remove-Item -Recurse -Force $HOME\.ghc-dispatch
```

For the VS Code extension:

```bash
code --uninstall-extension bodonnell.dispatch-vscode
```

---

## 18. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `dispatch: command not found` | `npm link` didn't run, or your shell's `PATH` isn't picking up the global npm bin. Run `npm bin -g` and ensure that directory is on `PATH`. |
| `EADDRINUSE :::7878` on `--start` | Another daemon is already running, or port 7878 is in use. Stop the other process or set `API_PORT=8000 dispatch --start`. |
| Daemon starts but Copilot calls fail | You don't have an active Copilot CLI session. Run `copilot` once interactively to log in, or set `GHC_MOCK_COPILOT=1` to use the mock adapter. |
| VS Code extension shows "disconnected" | The daemon isn't running, or `dispatch.apiUrl` doesn't match. With `dispatch.autoStartDaemon` enabled (default), the extension tries `dispatch --start` automatically — make sure the `dispatch` CLI is on your PATH. Otherwise run `curl http://localhost:7878/api/health` and adjust the setting. |
| `vsce package` fails on "missing repository field" | Add a `repository` field to `dispatch-vscode/package.json` or run `vsce package --no-git-tag-version --allow-missing-repository`. |
| Tests fail with SQLite "database is locked" | Pass `--maxWorkers=1` to vitest (already in the recommended command above). |
| Stale compiled output in `dispatch-vscode/out/` | Delete `dispatch-vscode/out/` and re-run `npm run compile`. The folder is gitignored. |

If you hit something not covered here, open an issue with the output of:

```bash
dispatch --version
node --version
npm --version
```

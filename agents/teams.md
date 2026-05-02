# Agent Teams

Agent teams group a lead agent and one or more specialist members to collaborate on a shared goal. The lead plans and coordinates; members execute their assigned scopes and report back.

---

## How Teams Work

When a task is dispatched to a team:

1. **Lead task** — the lead agent receives the goal, reviews team composition, creates a plan, and delegates subtasks to members.
2. **Member tasks** — each member agent receives a scoped assignment from the lead, executes independently, and delivers results with a handoff summary.
3. **Synthesis** — the lead collects member outputs, validates completeness, and produces a unified result for the user.

Teams are created via the API or CLI and stored in the GHC database. Members are referenced by their agent handles (e.g., `@coder`).

### API

```bash
# Create a task for the whole team
POST /api/teams/:id/run
{ "title": "Add dark mode support", "description": "...", "preApproved": true }

# List all teams
GET /api/teams

# Get team details
GET /api/teams/:id
```

### MCP / Chat

```
run_team { teamId: "<id>", title: "Add dark mode support" }
```

---

## Built-in Teams

### Software Dev

**ID:** configured at runtime  
**Lead:** `@orchestrator`  
**Members:** `@coder`, `@designer`, `@general-purpose`  
**Domain:** Software development (cloud-oriented)

#### Description

The Software Dev team handles end-to-end software development work. The Orchestrator leads by routing tasks to the right specialists, synthesizing results, and reporting back to the user. Tasks spanning multiple domains — e.g., a feature that requires UI changes, backend logic, and documentation — are well-suited for this team.

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@orchestrator` | Planning, delegation, synthesis, status reporting |
| Engineering | `@coder` | Code implementation, debugging, testing, CI/CD |
| Design | `@designer` | UI/UX components, styling, accessibility |
| Research / Docs | `@general-purpose` | Research, documentation, data processing |

#### Strengths

- **Full-stack coverage** — code, design, and research/docs handled in parallel
- **Domain-aware routing** — the Orchestrator routes based on task type, not generic round-robin
- **Copilot-quality execution** — each member runs as a full Copilot session with complete tool access
- **Traceable handoffs** — each member summarizes decisions and blockers for the lead

#### Ideal Use Cases

- Multi-component feature development (backend + frontend + docs)
- Bug investigations that cross code, UI, and documentation
- Codebase audits requiring research, code analysis, and design review
- Sprint-scale goals requiring parallel independent work streams

#### Anti-patterns

- Tasks that clearly belong to a single specialist (use `create_task` directly instead of a team run)
- Tasks requiring real-time collaboration between members (the model is async delegation, not pair programming)

---

## Community Teams

Teams beyond the built-in set are created by operators via the API. Two example teams are pre-configured in this instance:

### Academic Professor Support Team

**Lead:** `@education-team-lead`  
**Domain:** Academic education support

A multidisciplinary team supporting professors with course design, lecture materials, grading, student communication, research assistance, and academic integrity review. Specialists cover curriculum design, assessment, accessibility, and content creation.

### Blog & Podcast Studio

**Lead:** `@content-media-team-lead`  
**Domain:** Content production and publishing

A full-service content team for planning, producing, publishing, and promoting blog articles and podcast episodes. Includes specialists for writing/editing, podcast production, SEO, social media, and visual content creation.

---

## Creating a New Team

### With generated agents (recommended for new domains)

```json
POST /api/chat
{
  "message": "create_team_with_generated_agents",
  "args": {
    "name": "DevOps",
    "description": "Infrastructure and deployment automation",
    "domain": "devops",
    "function": "CI/CD, cloud infra, container orchestration, monitoring",
    "operatingModel": "lead plans infra changes; specialists handle terraform, kubernetes, and observability",
    "leadDescription": "DevOps lead: plans infrastructure changes, coordinates terraform/k8s/observability specialists",
    "memberAgents": [
      { "role": "terraform-specialist", "description": "Terraform IaC, state management, module authoring" },
      { "role": "kubernetes-specialist", "description": "Helm charts, deployments, RBAC, service meshes" },
      { "role": "observability-specialist", "description": "Prometheus, Grafana, alerting, log aggregation" }
    ]
  }
}
```

### With existing agents

```bash
POST /api/teams
{
  "name": "DevOps",
  "description": "Infrastructure and deployment automation",
  "leadAgent": "@orchestrator",
  "memberAgents": ["@coder", "@general-purpose"],
  "metadata": {
    "domain": "devops",
    "function": "CI/CD and cloud infrastructure"
  }
}
```

---

## Team Metadata Fields

| Field | Description |
|---|---|
| `domain` | The subject area of the team (e.g., `software-engineering`, `content`, `education`) |
| `function` | A description of what the team does (used in lead/member prompts) |
| `operatingModel` | How the team divides and coordinates work (injected into the lead's context) |

These fields are injected into the lead and member agent prompts at runtime, giving each agent context about the team's purpose and expected collaboration style.

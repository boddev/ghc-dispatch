# Agent Teams

Agent teams group a lead agent and one or more specialist members to collaborate on a shared goal. The lead plans and coordinates; members execute their assigned scopes and report back. Teams enable parallel, domain-specific work that a single agent cannot efficiently handle alone.

---

## How Teams Work

When a task is dispatched to a team:

1. **Lead task**  the lead agent receives the goal, reviews team composition, creates a plan, and delegates scoped subtasks to member agents.
2. **Member tasks**  each member agent receives a bounded assignment, executes independently using its full tool set, and delivers results with a handoff summary.
3. **Synthesis**  the lead collects member outputs, validates completeness, resolves conflicts, and produces a unified result for the user.

**Key properties of the model:**
- **Async delegation**  members work independently; this is not pair programming or real-time collaboration
- **Scoped assignments**  each member receives a clear, bounded task description so it can execute without follow-up questions
- **Traceable handoffs**  each member summarizes decisions, files changed, and blockers in its output
- **Lead validates before synthesizing**  the lead confirms member outputs address their assigned scope before assembling the final deliverable

Teams are created via the API or CLI and stored in the GHC database. Members are referenced by their agent handles (e.g., `@coder`).

### API

```bash
# Run a task for the whole team
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
**Domain:** Software development

#### Description

The Software Dev team handles end-to-end software development work spanning implementation, UI/UX, and documentation. The Orchestrator leads by decomposing the goal into domain-specific assignments, routing each to the appropriate specialist, monitoring progress, and synthesizing outputs into a coherent deliverable.

This team is best suited for tasks that cross domain boundaries — a feature that requires backend logic, UI component changes, and documentation updates, for example. The Orchestrator routes based on capability match, not round-robin assignment, so each member only receives work that aligns with its specialization.

#### Agent Capabilities at a Glance

| Agent | Specialization | Key Strengths |
|---|---|---|
| `@orchestrator` | Coordination & routing | Planning, delegation, DAG orchestration, synthesis, escalation |
| `@coder` | Software engineering | TypeScript/JS/Python/Go/Rust/C#, Node.js, React, testing, CI/CD, Git |
| `@designer` | UI/UX design | React/Vue/Svelte components, Tailwind/CSS Modules, WCAG 2.1 AA accessibility, design systems |
| `@general-purpose` | Research & documentation | Technical writing, data analysis, planning specs, system scripting, communications |

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@orchestrator` | Planning, delegation, dependency sequencing, synthesis, status reporting, escalation |
| Engineering | `@coder` | Code implementation, bug fixes, refactoring, tests, CI/CD, Git commits |
| Design | `@designer` | UI/UX components, CSS/styling, responsive layouts, accessibility audits, design tokens |
| Research / Docs | `@general-purpose` | Research, documentation, data analysis, implementation specs, configuration, communications |

The Orchestrator creates parallel member tasks when work streams are independent. For example, `@coder` can implement a new API endpoint while `@designer` builds the corresponding UI component and `@general-purpose` writes the documentation — all simultaneously. Only genuinely dependent tasks are serialized.

**Handoff protocol:** each member summarizes in its output — decisions made, files changed, assumptions, and any blockers. The Orchestrator validates this summary before synthesizing the final result.

**Failure handling:** if a member task fails or goes out of scope, the Orchestrator surfaces the failure immediately rather than silently retrying. Blocked work streams are reported to the user with context so they can decide how to proceed.

#### Strengths

- **Full-stack coverage** — implementation, design, and research/documentation handled by domain specialists
- **Domain-aware routing** — the Orchestrator assigns work based on capability match, not sequential availability
- **Parallel execution** — independent work streams run simultaneously, reducing total time-to-completion
- **Copilot-quality execution** — each member runs as a full Copilot agent session with complete tool access
- **Traceable handoffs** — each member's output includes decisions, trade-offs, and blockers, giving the Orchestrator enough context to synthesize accurately

#### Ideal Use Cases

- **Multi-component feature development**: backend API (`@coder`) + frontend UI (`@designer`) + documentation (`@general-purpose`)
- **Cross-layer bug investigations**: root cause in code (`@coder`), regression in UI (`@designer`), runbook update needed (`@general-purpose`)
- **Codebase audits**: code analysis and fixes (`@coder`) + UI/accessibility review (`@designer`) + findings report (`@general-purpose`)
- **Sprint-scale goals**: parallel, independently executable work streams across all three domains
- **Onboarding new contributors**: codebase research + documentation authoring (`@general-purpose`) + example code (`@coder`)
- **Documentation-driven development**: spec first (`@general-purpose`) → implementation (`@coder`) → component (`@designer`)

#### Anti-patterns

- **Single-domain tasks**: if a task clearly belongs to one specialist, use `create_task` directly. Team overhead is not justified for pure coding, pure design, or pure research tasks.
- **Real-time collaboration**: the model is async delegation, not pair programming. Tasks requiring tight back-and-forth between specialists should be broken into sequential phases, not run as a single parallel team task.
- **Underspecified goals**: the team requires a clear goal to decompose effectively. Vague requests should be clarified before running the team — unclear input produces misaligned parallel work that wastes all three members' time.
- **Over-parallelizing dependent work**: don't dispatch `@designer` to build a component before `@coder` has finalized the data contract. Identify true dependencies and sequence them explicitly.

---

## Community Teams

Teams beyond the built-in set are created by operators via the API. Two example teams are pre-configured in this instance:

### Academic Professor Support Team

**ID:** configured at runtime
**Lead:** `@education-team-lead-8bc3e942`
**Members:** `@education-lecture-notes-and-course-content-specialist-76feadfc`, `@education-assignment-grading-and-feedback-specialist-fa8ba778`, `@education-curriculum-and-syllabus-designer-1e919b44`, `@education-assessment-and-rubric-designer-cc79da9e`, `@education-academic-research-assistant-626ebf36`, `@education-student-communication-and-advising-assistant-b02cce56`, `@education-accessibility-and-learning-support-specialist-a1dfc584`, `@education-academic-integrity-and-quality-reviewer-76537e8b`
**Domain:** Academic education support

#### Description

The Academic Professor Support Team provides end-to-end support for university and college professors across the full lifecycle of teaching and course management. The team lead receives a professor's request, identifies which combination of specialists is needed, coordinates parallel or sequential work, and delivers a unified result that is pedagogically sound, accessible, and aligned with academic standards.

This team is best suited for requests that cross domain boundaries — for example, launching a new course requires curriculum design, lecture content, assessments, and a student-facing syllabus all at once. The lead routes based on domain fit, not availability, so each specialist only receives work within its expertise.

#### Agent Capabilities at a Glance

| Agent | Specialization | Key Strengths |
|---|---|---|
| `@education-team-lead-8bc3e942` | Coordination & academic routing | Planning, delegation, synthesis, pedagogical quality assurance, escalation |
| `@education-lecture-notes-and-course-content-specialist-76feadfc` | Course content creation | Lecture notes, slide outlines, reading summaries, examples, discussion prompts, study guides |
| `@education-curriculum-and-syllabus-designer-1e919b44` | Curriculum & syllabus design | Module sequences, learning objective mapping, syllabus documents, course structure |
| `@education-assessment-and-rubric-designer-cc79da9e` | Assessments & rubrics | Quizzes, exams, project briefs, analytic and holistic rubrics, alignment to objectives |
| `@education-assignment-grading-and-feedback-specialist-fa8ba778` | Grading & feedback | Rubric-based grading, written feedback, batch grading summaries, grade norming |
| `@education-academic-research-assistant-626ebf36` | Academic research support | Literature searches, reading summaries, annotated bibliographies, research synthesis |
| `@education-student-communication-and-advising-assistant-b02cce56` | Student communication | Course announcements, policy emails, advising scripts, FAQ documents, feedback letters |
| `@education-accessibility-and-learning-support-specialist-a1dfc584` | Accessibility & inclusion | UDL adaptations, accommodation planning, plain language revision, alt text, WCAG compliance |
| `@education-academic-integrity-and-quality-reviewer-76537e8b` | Academic integrity & QA | Integrity policy review, originality guidance, content quality checks, citation audits |

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@education-team-lead-8bc3e942` | Decomposes professor goals into scoped assignments, delegates to specialists, validates outputs against pedagogical standards, synthesizes final deliverables |
| Content Creation | `@education-lecture-notes-and-course-content-specialist-76feadfc` | Produces lecture notes, slide outlines, examples, discussion prompts, and study guides for any topic and course level |
| Curriculum Design | `@education-curriculum-and-syllabus-designer-1e919b44` | Structures modules, sequences learning objectives, and produces complete syllabus documents |
| Assessment Design | `@education-assessment-and-rubric-designer-cc79da9e` | Creates formative and summative assessments and rubrics aligned to learning objectives |
| Grading & Feedback | `@education-assignment-grading-and-feedback-specialist-fa8ba778` | Applies rubrics to student submissions, writes substantive feedback, and produces grade summaries |
| Research Support | `@education-academic-research-assistant-626ebf36` | Sources literature, synthesizes readings, and produces research summaries that feed into content and curriculum work |
| Student Communication | `@education-student-communication-and-advising-assistant-b02cce56` | Drafts all student-facing communications — announcements, email replies, advising notes, and FAQs |
| Accessibility | `@education-accessibility-and-learning-support-specialist-a1dfc584` | Reviews and revises all materials for accessibility and inclusion; advises on accommodation implementation |
| Integrity & Quality | `@education-academic-integrity-and-quality-reviewer-76537e8b` | Audits content for academic integrity risks and quality standards; reviews citations; flags policy concerns |

The team lead creates parallel member tasks when work streams are independent. For example, `@education-lecture-notes-and-course-content-specialist-76feadfc` can draft lecture materials while `@education-assessment-and-rubric-designer-cc79da9e` builds aligned assessments and `@education-accessibility-and-learning-support-specialist-a1dfc584` reviews both for accessibility — simultaneously. Only genuinely dependent tasks are serialized (e.g., curriculum design must precede lecture content when a new course is being built from scratch).

**Handoff protocol:** each specialist summarizes in its output — decisions made, materials produced, assumptions, and any blockers. The team lead validates this summary before synthesizing the final deliverable for the professor.

**Failure handling:** if a specialist task fails or goes out of scope, the team lead surfaces the failure immediately rather than silently retrying. Blocked work is reported with context so the professor can decide how to proceed.

#### Strengths

- **Full academic lifecycle coverage** — from curriculum design and content creation through assessment, grading, student communication, and integrity review
- **Domain-aware routing** — the team lead routes based on pedagogical fit, not sequential availability
- **Parallel execution** — independent work streams (e.g., lecture notes + rubric design + accessibility review) run simultaneously
- **Discipline-agnostic** — specialists adapt to any academic field: STEM, humanities, social sciences, professional programs
- **Level-adaptive content** — outputs are calibrated to introductory, intermediate, advanced, or graduate audiences
- **Traceable handoffs** — each specialist's output includes decisions, trade-offs, and assumptions, giving the team lead enough context to synthesize accurately

#### Ideal Use Cases

- **New course launch**: curriculum structure (`@education-curriculum-and-syllabus-designer-1e919b44`) + lecture content (`@education-lecture-notes-and-course-content-specialist-76feadfc`) + assessments (`@education-assessment-and-rubric-designer-cc79da9e`) + syllabus communications (`@education-student-communication-and-advising-assistant-b02cce56`) — all in parallel
- **Lecture preparation**: research on topic (`@education-academic-research-assistant-626ebf36`) → lecture notes and slides (`@education-lecture-notes-and-course-content-specialist-76feadfc`) → accessibility review (`@education-accessibility-and-learning-support-specialist-a1dfc584`)
- **Assignment grading cycle**: rubric design (`@education-assessment-and-rubric-designer-cc79da9e`) → batch grading and feedback (`@education-assignment-grading-and-feedback-specialist-fa8ba778`) → grade announcement to class (`@education-student-communication-and-advising-assistant-b02cce56`)
- **Course revision**: integrity and quality audit (`@education-academic-integrity-and-quality-reviewer-76537e8b`) + accessibility review (`@education-accessibility-and-learning-support-specialist-a1dfc584`) + updated lecture content (`@education-lecture-notes-and-course-content-specialist-76feadfc`) — running in parallel
- **Research integration**: literature synthesis (`@education-academic-research-assistant-626ebf36`) → updated lecture material incorporating new findings (`@education-lecture-notes-and-course-content-specialist-76feadfc`)
- **Student support situations**: advising email or policy communication (`@education-student-communication-and-advising-assistant-b02cce56`) + accommodation plan (`@education-accessibility-and-learning-support-specialist-a1dfc584`)

#### Anti-patterns

- **Single-domain requests**: if a task clearly belongs to one specialist (e.g., "write a quiz"), use `create_task` directly for that agent. Team overhead is not justified for single-specialist work.
- **Real-time back-and-forth**: the model is async delegation. Tasks requiring rapid iteration between professor and specialist (e.g., live lecture editing) should be handled as direct single-agent tasks.
- **Underspecified goals**: the team requires a clear goal to decompose effectively. A request like "help with my course" without specifying the course, level, or desired output will produce misaligned parallel work. Clarify scope before running the team.
- **Over-parallelizing dependent work**: don't dispatch `@education-lecture-notes-and-course-content-specialist-76feadfc` to draft lectures before `@education-curriculum-and-syllabus-designer-1e919b44` has defined the module structure for a brand-new course. Identify true dependencies and sequence them.

### Blog & Podcast Studio

**Lead:** `@content-media-team-lead`
**Domain:** Content production and publishing

A full-service content team for planning, producing, publishing, and promoting blog articles and podcast episodes. Includes specialists for writing/editing, podcast production, SEO, social media, and visual content creation.

---

## Creating a New Team

### With generated agents (recommended for new domains)

Use this approach when you need a team with purpose-built agents that don't yet exist in the system.

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

Use this approach when existing agents (like `@coder` or `@general-purpose`) cover the required capabilities.

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
| `function` | A description of what the team does  used in lead and member prompts at runtime |
| `operatingModel` | How the team divides and coordinates work  injected into the lead's context to guide delegation |

These fields are injected into the lead and member agent prompts at runtime. Setting them accurately improves the lead's ability to decompose goals and the members' ability to understand their role within the team.

---

## When to Use a Team vs. a Single Agent

| Scenario | Recommendation |
|---|---|
| Task clearly belongs to one domain (e.g., pure coding) | Use `create_task` for that specialist directly |
| Task spans two or more domains (e.g., code + docs) | Use `run_team` |
| You need parallel work streams with domain expertise | Use `run_team` |
| You need a quick answer or status check | Ask `@orchestrator` directly |
| You want a domain-specific team that doesn't exist yet | Create a new team with generated agents |

Team runs introduce coordination overhead. Reserve them for tasks where domain parallelism or the breadth of work justifies the overhead.

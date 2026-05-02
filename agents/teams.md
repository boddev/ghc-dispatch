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
**Members:** `@education-curriculum-and-syllabus-designer-1e919b44`, `@education-lecture-notes-and-course-content-specialist-76feadfc`, `@education-assignment-grading-and-feedback-specialist-fa8ba778`, `@education-assessment-and-rubric-designer-cc79da9e`, `@education-academic-research-assistant-626ebf36`, `@education-student-communication-and-advising-assistant-b02cce56`, `@education-accessibility-and-learning-support-specialist-a1dfc584`, `@education-academic-integrity-and-quality-reviewer-76537e8b`
**Domain:** Education
**Function:** Academic teaching and research support

#### Description

The Academic Professor Support Team provides end-to-end support for university and college professors across the full lifecycle of teaching and course management. The team lead receives a professor's request, identifies which combination of specialists is needed, coordinates parallel or sequential work, and delivers a unified result that is pedagogically sound, accessible, and aligned with academic standards.

This team is best suited for requests that cross domain boundaries — for example, launching a new course requires curriculum design, lecture content, assessments, and a student-facing syllabus all at once. The lead routes based on domain fit, not availability, so each specialist only receives work within its expertise.

#### Agent Capabilities at a Glance

| Agent | Specialization | Key Strengths |
|---|---|---|
| `@education-team-lead-8bc3e942` | Coordination & academic routing | Planning, delegation, synthesis, pedagogical quality assurance, escalation |
| `@education-lecture-notes-and-course-content-specialist-76feadfc` | Course content creation | Lecture notes, slide outlines, in-class activities, discussion prompts, reading summaries, study guides, video/multimedia scripts, time-blocked lecture plans |
| `@education-curriculum-and-syllabus-designer-1e919b44` | Curriculum & syllabus design | Module sequences, Bloom's-aligned objectives, syllabus documents, lesson plans, prerequisite maps, alignment matrices |
| `@education-assessment-and-rubric-designer-cc79da9e` | Assessments & rubrics | Quizzes, exams, essay prompts, project briefs, analytic/holistic/single-point rubrics, answer keys, Bloom's alignment maps |
| `@education-assignment-grading-and-feedback-specialist-fa8ba778` | Grading & feedback | Rubric-based grading, individualized written feedback, batch grade sheets, common-error analysis, grade norming, feedback comment banks |
| `@education-academic-research-assistant-626ebf36` | Academic research support | Literature searches, annotated bibliographies, research synthesis, reading list curation, research question development, citation formatting |
| `@education-student-communication-and-advising-assistant-b02cce56` | Student communication | Course announcements, policy emails, extension responses, welfare check-ins, advising scripts, FAQ documents, class-wide feedback summaries, response template libraries |
| `@education-accessibility-and-learning-support-specialist-a1dfc584` | Accessibility & inclusion | UDL reviews, WCAG 2.1 AA audits, accommodation implementation plans, plain language revision, alt text, caption review, inclusive assessment design, LMS platform-specific accessibility guidance (Canvas, Blackboard, Moodle, D2L) |
| `@education-academic-integrity-and-quality-reviewer-76537e8b` | Academic integrity & QA | Assignment integrity risk assessments, AI use policy development, citation audits, pre-deployment quality checklists, syllabus standards compliance, incident documentation |

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@education-team-lead-8bc3e942` | Decomposes professor goals into scoped assignments, delegates to specialists, validates outputs against pedagogical standards, synthesizes final deliverables, escalates blockers |
| Content Creation | `@education-lecture-notes-and-course-content-specialist-76feadfc` | Produces lecture notes, slide outlines, in-class activities, discussion prompts, reading summaries, and study guides for any topic, course level, and delivery modality |
| Curriculum Design | `@education-curriculum-and-syllabus-designer-1e919b44` | Designs module/unit structure, maps Bloom's-aligned learning objectives, produces complete syllabus documents with schedule, lesson plans, prerequisite maps, and alignment matrices |
| Assessment Design | `@education-assessment-and-rubric-designer-cc79da9e` | Creates formative and summative assessments, rubrics (analytic/holistic/single-point), answer keys, Bloom's alignment maps, and grading guidance |
| Grading & Feedback | `@education-assignment-grading-and-feedback-specialist-fa8ba778` | Applies rubrics to student submissions, writes individualized written feedback, produces batch grade sheets and common-error analyses, supports grade norming across graders |
| Research Support | `@education-academic-research-assistant-626ebf36` | Conducts literature searches, produces annotated bibliographies and research syntheses, curates course reading lists, assists with research question development, formats citations |
| Student Communication | `@education-student-communication-and-advising-assistant-b02cce56` | Drafts all student-facing communications — announcements, grade feedback, extension responses, welfare check-ins, advising scripts, FAQ documents, and reusable response templates; escalates safety and legal concerns to team lead |
| Accessibility | `@education-accessibility-and-learning-support-specialist-a1dfc584` | Conducts UDL reviews and WCAG 2.1 AA audits, produces accommodation implementation plans, revises materials for plain language and accessible formatting, advises on inclusive assessment design |
| Integrity & Quality | `@education-academic-integrity-and-quality-reviewer-76537e8b` | Audits assessments for integrity risks, develops AI use policies, reviews citations, runs pre-deployment quality checklists, documents integrity incidents, maps content to accreditation standards |

The team lead creates parallel member tasks when work streams are independent. For example, `@education-lecture-notes-and-course-content-specialist-76feadfc` can draft lecture materials while `@education-assessment-and-rubric-designer-cc79da9e` builds aligned assessments and `@education-accessibility-and-learning-support-specialist-a1dfc584` reviews both for accessibility — simultaneously. Only genuinely dependent tasks are serialized (e.g., curriculum design must precede lecture content when a new course is being built from scratch).

**Handoff protocol:** each specialist summarizes in its output — decisions made, materials produced, assumptions, and any blockers. The team lead validates this summary before synthesizing the final deliverable for the professor.

**Failure handling:** if a specialist task fails or goes out of scope, the team lead surfaces the failure immediately rather than silently retrying. Blocked work is reported with context so the professor can decide how to proceed.

**Escalation protocol:** certain situations must bypass the normal async workflow and be escalated to the professor immediately — before completing or delivering any other work:
- Student welfare or safety concerns (mental health crisis, absence suggesting danger)
- Communications that may carry legal or FERPA implications
- Academic integrity incidents involving patterns or potential litigation
- Any situation where a drafted communication could commit the institution to a policy position the professor has not verified

`@education-student-communication-and-advising-assistant-b02cce56` and `@education-academic-integrity-and-quality-reviewer-76537e8b` are the primary escalation triggers for these situations; they flag to the team lead, who escalates to the professor.

#### Strengths

- **Full academic lifecycle coverage** — from curriculum design and content creation through assessment, grading, student communication, and integrity review
- **Domain-aware routing** — the team lead routes based on pedagogical fit, not sequential availability
- **Parallel execution** — independent work streams (e.g., lecture notes + rubric design + accessibility review) run simultaneously
- **Discipline-agnostic** — specialists adapt to any academic field: STEM, humanities, social sciences, professional programs
- **Level-adaptive content** — outputs are calibrated to introductory, intermediate, advanced, or graduate audiences
- **LMS-aware accessibility** — the accessibility specialist provides platform-specific guidance for Canvas, Blackboard, Moodle, and D2L, not just generic WCAG recommendations
- **Modality-flexible curriculum design** — the curriculum designer produces differentiated guidance for in-person, online, hybrid, and HyFlex delivery
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

**ID:** configured at runtime
**Lead:** `@content-media-team-lead-d370fcb1`
**Members:** `@content-media-blog-writer-editor-d3115369`, `@content-media-podcast-producer-eca4c308`, `@content-media-seo-discoverability-specialist-4bf7a7d9`, `@content-media-social-media-community-manager-e06af256`, `@content-media-visual-content-creator-044f361e`
**Domain:** Content & Media
**Function:** Content Production and Distribution

#### Description

The Blog & Podcast Studio is a full-service content production team that takes a topic or goal from brief through publication — covering writing, podcast production, search optimization, visual assets, and social distribution. The team lead sets the editorial strategy and content calendar, routes work to specialists based on content type and phase, and synthesizes outputs into cohesive, publication-ready packages.

This team is best suited for content goals that span multiple disciplines — a new blog series requires keyword research, article writing, featured images, and a social launch campaign, for example. The lead routes based on content phase and specialist fit, so each member only receives work within its domain. Writers write; SEO specialists optimize; visual creators design; the social manager distributes.

#### Agent Capabilities at a Glance

| Agent | Specialization | Key Strengths |
|---|---|---|
| `@content-media-team-lead-d370fcb1` | Editorial coordination & strategy | Content calendar planning, delegation, workflow sequencing, synthesis, brand voice oversight |
| `@content-media-blog-writer-editor-d3115369` | Writing & editing | Long-form and short-form blog articles, editing, CMS-ready formatting, brand voice calibration |
| `@content-media-podcast-producer-eca4c308` | Podcast production | Episode scripting (full/semi-scripted/outline), show notes, guest briefing documents, clean transcripts, chapter markers, RSS-ready episode metadata packages |
| `@content-media-seo-discoverability-specialist-4bf7a7d9` | SEO & discoverability | Keyword research, on-page optimization, schema markup, content gap analysis, podcast SEO |
| `@content-media-social-media-community-manager-e06af256` | Social media & community | Platform-specific social copy, distribution calendars, community engagement, content repurposing |
| `@content-media-visual-content-creator-044f361e` | Visual content creation | Featured images, infographics, social graphics, podcast cover art, alt text, brand consistency |

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@content-media-team-lead-d370fcb1` | Sets editorial calendar, decomposes content goals into scoped assignments, validates outputs, synthesizes publication packages, escalates blockers |
| Writing & Editing | `@content-media-blog-writer-editor-d3115369` | Researches topics, drafts long-form and short-form articles, edits for clarity and brand voice, packages content for CMS |
| Podcast Production | `@content-media-podcast-producer-eca4c308` | Plans episode structure (all formats: solo, interview, panel, narrative), writes full scripts or semi-scripted guides, prepares guest briefing documents with ranked questions, drafts show notes to required standards (summary, takeaways, timestamps, bio, links, CTA), produces episode metadata packages (3 title options, short ≤200 char and long descriptions, chapter markers in HH:MM:SS format), cleans transcripts with speaker labels |
| SEO & Discoverability | `@content-media-seo-discoverability-specialist-4bf7a7d9` | Delivers keyword briefs before writing begins, reviews drafts for on-page signals, adds schema markup, audits published content performance |
| Social & Community | `@content-media-social-media-community-manager-e06af256` | Repurposes published content into platform-native social posts, plans distribution calendars, drafts community engagement prompts |
| Visual Content | `@content-media-visual-content-creator-044f361e` | Produces featured images, infographics, social graphics, podcast artwork, and alt text for all visual assets |

The team lead creates parallel member tasks when work streams are independent. For example, `@content-media-blog-writer-editor-d3115369` can draft an article while `@content-media-seo-discoverability-specialist-4bf7a7d9` prepares the keyword brief simultaneously — the writer incorporates keyword targets, not the other way around. Visual assets and social copy are produced after the article is approved; only genuinely dependent phases are serialized.

**Standard blog workflow:** Team Lead briefs → SEO keyword brief (parallel with writer brief) → Writer drafts → SEO on-page review → Visual Creator produces images → Social Manager creates distribution copy → Team Lead validates and publishes.

**Standard podcast workflow:** Team Lead briefs → Podcast Producer scripts + show notes → SEO optimizes episode metadata → Visual Creator produces episode artwork → Social Manager plans launch promotion → Team Lead validates and publishes.

**Handoff protocol:** each specialist summarizes in its output — decisions made, assets produced, assumptions, and any blockers. The team lead validates this summary before synthesizing the final deliverable.

**Failure handling:** if a specialist task fails or goes out of scope, the team lead surfaces the failure immediately rather than silently retrying. Blocked work is reported with context so the operator can decide how to proceed.

#### Strengths

- **Full content lifecycle coverage** — from keyword research and briefs through writing, optimization, visual production, and social distribution
- **Domain-aware routing** — the team lead routes based on content type and phase, not availability
- **Parallel execution** — independent work streams (keyword research + drafting, visual production + social planning) run simultaneously, reducing time to publication
- **Multi-format output** — produces blog articles, podcast episodes, social posts, and visual assets from a single content goal
- **Traceable handoffs** — each specialist's output includes decisions, assets, and assumptions, giving the team lead enough context to synthesize accurately

#### Ideal Use Cases

- **New blog series launch**: keyword strategy (`@content-media-seo-discoverability-specialist-4bf7a7d9`) + article drafts (`@content-media-blog-writer-editor-d3115369`) + featured images (`@content-media-visual-content-creator-044f361e`) + social launch campaign (`@content-media-social-media-community-manager-e06af256`) — all coordinated by the team lead
- **Podcast episode production**: scripting + show notes (`@content-media-podcast-producer-eca4c308`) → episode SEO (`@content-media-seo-discoverability-specialist-4bf7a7d9`) → episode artwork (`@content-media-visual-content-creator-044f361e`) → social promotion (`@content-media-social-media-community-manager-e06af256`)
- **Content repurposing**: transcript from podcast episode → blog post (`@content-media-blog-writer-editor-d3115369`) → SEO optimization → social distribution
- **Monthly content calendar execution**: team lead sequences a full month of blog and podcast content across all specialists in parallel
- **SEO content refresh**: gap analysis and audit (`@content-media-seo-discoverability-specialist-4bf7a7d9`) → updated drafts (`@content-media-blog-writer-editor-d3115369`) → updated visuals if needed

#### Anti-patterns

- **Single-domain requests**: if a task clearly belongs to one specialist (e.g., "edit this draft"), use `create_task` directly for that agent. Team overhead is not justified for single-specialist work.
- **Publishing without SEO review**: every piece should pass through SEO optimization before publication — skipping this step reduces discoverability.
- **Underbriefed content goals**: the team requires a clear topic, audience, and goal to decompose effectively. "Write something about AI" without audience or purpose produces misaligned parallel work.
- **Over-parallelizing dependent phases**: do not dispatch the visual creator to produce a featured image before the article title is finalized; image copy depends on the approved headline.

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

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

Teams beyond the built-in set are created by operators via the API. One example team is pre-configured in this instance:

### Blog & Podcast Studio

**ID:** configured at runtime
**Lead:** `@content-media-team-lead-d370fcb1`
**Members:** `@content-media-blog-writer-editor-d3115369`, `@content-media-podcast-producer-eca4c308`, `@content-media-seo-discoverability-specialist-4bf7a7d9`, `@content-media-social-media-community-manager-e06af256`, `@content-media-visual-content-creator-044f361e`
**Domain:** Content & Media
**Function:** Content Production and Distribution

#### Description

The Blog & Podcast Studio is a full-service content production team that takes a topic or goal from brief through publication  covering writing, podcast production, search optimization, visual assets, and social distribution. The team lead sets the editorial strategy and content calendar, routes work to specialists based on content type and phase, and synthesizes outputs into cohesive, publication-ready packages.

This team is best suited for content goals that span multiple disciplines  a new blog series requires keyword research, article writing, featured images, and a social launch campaign, for example. The lead routes based on content phase and specialist fit, so each member only receives work within its domain. Writers write; SEO specialists optimize; visual creators design; the social manager distributes.

#### Agent Capabilities at a Glance

| Agent | Specialization | Key Strengths |
|---|---|---|
| `@content-media-team-lead-d370fcb1` | Editorial coordination & strategy | Content calendar management, audience persona definition, delegation routing, parallel workflow coordination, synthesis and brand voice quality gate, performance metrics tracking (blog + podcast + social) |
| `@content-media-blog-writer-editor-d3115369` | Writing & editing | Long-form and short-form blog articles (11 formats: how-to, explainer, listicle, thought leadership, case study, comparison, interview-to-article, news, pillar page, podcast companion post, newsletter feature), newsletter feature writing guide with email-native structure and sponsored content handling, ghostwriting byline content in an expert's voice, bidirectional blog-to-podcast repurposing, self-edit checklist quality pass, CMS-ready packaging |
| `@content-media-podcast-producer-eca4c308` | Podcast production | Episode scripting for all formats (solo, interview, panel, narrative, Q&A, repurposed), solo episode writing guide, guest briefing documents with 10–15 ranked questions and follow-up probes, show notes to required standard (summary, 5–8 takeaways, timestamps, bio, links, CTA), complete metadata packages, sponsor read copy (pre-roll/mid-roll templates), RSS platform distribution notes (Apple, Spotify, YouTube), social clip identification, show trailer and teaser production, season arc planning template |
| `@content-media-seo-discoverability-specialist-4bf7a7d9` | SEO & discoverability | Intent-classified keyword research with tooling guidance, competitor content analysis framework, on-page optimization, content cluster strategy (pillar + clusters), schema markup, Core Web Vitals image flagging, post-publication indexation verification, 30/60/90-day content refresh cadence, podcast platform discovery algorithm notes (Apple Podcasts, Spotify, YouTube) |
| `@content-media-social-media-community-manager-e06af256` | Social media & community | Platform-native copy (Twitter/X, LinkedIn, Instagram, Threads, TikTok, Facebook), posting time best-practice table with account-adaptive guidance, LinkedIn native newsletter strategy, distribution calendars with evergreen reshare, newsletter cross-promotion copy, guest and subject share kits for cross-promotion, UTM-tagged link management, community engagement standards, crisis communication protocol |
| `@content-media-visual-content-creator-044f361e` | Visual content creation | 5-phase visual production workflow, tool selection decision matrix (Canva vs Figma vs Adobe Express), featured images, infographics, carousel design workflow (slide structure, slide count, export), social quote cards, podcast cover art, audiogram stills, video thumbnails (YouTube, TikTok/Reels), email newsletter header design standards (with dark mode variant guidance), dark mode asset considerations; brand refresh checklist; asset ownership boundary table; consolidated platform dimensions reference (20+ use cases); alt text for every asset; compressed SEO-named file delivery |

#### Operating Model

| Role | Agent | Responsibilities |
|---|---|---|
| Team Lead | `@content-media-team-lead-d370fcb1` | Sets editorial calendar using the Editorial Calendar Template, defines audience personas, runs weekly editorial standup, decomposes content goals into scoped assignments, manages content approval stages (Briefed → In Production → Ready for Review → Approved → Scheduled/Publishable), owns sponsored/branded content canonical approval and disclosure policy, validates outputs against brief and brand voice definition, synthesizes publication packages, tracks performance metrics (blog + podcast + social), escalates blockers |
| Writing & Editing | `@content-media-blog-writer-editor-d3115369` | Matches article format to goal using Article Type Reference (11 types), researches topics, drafts articles with self-editing checklist pass, writes newsletter features using email-native structure guide, handles sponsored/branded content with required disclosure language, writes in an expert's voice for ghostwritten byline content, executes bidirectional repurposing (blog→podcast and podcast→blog), packages for CMS with all metadata fields and image markers |
| Podcast Production | `@content-media-podcast-producer-eca4c308` | Plans episode structure for any format, writes full scripts or semi-scripted solo guides, prepares guest briefing documents with ranked questions and follow-up probes, drafts show notes to required standard (summary, 5–8 takeaways, timestamps, bio, links, CTA), writes sponsor read copy (pre-roll/mid-roll), produces show trailers and episode teaser clips for new launches, plans season arcs using season arc planning template, produces complete RSS-ready metadata packages, cleans transcripts, flags repurposing opportunities |
| SEO & Discoverability | `@content-media-seo-discoverability-specialist-4bf7a7d9` | Delivers keyword briefs before writing begins (primary + secondary keywords, intent classification, cluster position), runs competitor content analysis framework before new pieces are written, reviews drafts for on-page signals, flags Core Web Vitals image concerns, adds schema markup, defines UTM parameters, applies platform-specific podcast discovery optimization (Apple Podcasts, Spotify, YouTube), runs post-publication indexation verification, monitors performance at 30/60/90-day intervals, conducts quarterly content gap audits |
| Social & Community | `@content-media-social-media-community-manager-e06af256` | Repurposes published content using the content repurposing decision matrix, plans distribution calendars with evergreen reshare schedules, manages LinkedIn native newsletter as a distinct distribution channel, produces newsletter cross-promotion copy, creates guest share kits for co-promotion, drafts community engagement prompts, applies posting-time best practices per platform (Threads included), reviews analytics on a defined cadence, applies crisis escalation protocol when needed |
| Visual Content | `@content-media-visual-content-creator-044f361e` | Produces all visual assets through a 5-phase workflow using tool selection decision matrix (Canva vs Figma vs Adobe Express), designs carousels using defined slide structure and export standards, produces email newsletter headers with dark mode variant, applies brand refresh checklist when visual identity changes, covers blog featured images, infographics, podcast artwork, audiogram stills, video thumbnails; maintains brand template set; delivers files with SEO-friendly naming, alt text document, placement instructions, and license confirmations |

The team lead creates parallel member tasks when work streams are independent. For example, `@content-media-blog-writer-editor-d3115369` can draft an article while `@content-media-seo-discoverability-specialist-4bf7a7d9` prepares the keyword brief simultaneously  the writer incorporates keyword targets on receipt. Visual assets and social copy are produced after the article is approved; only genuinely dependent phases are serialized.

**Standard blog workflow:**
```
Team Lead (brief + audience + goal)
     parallel
     SEO Specialist: keyword brief (primary keyword, secondary keywords, cluster position, competitor notes)
     Blog Writer: draft (incorporates keyword brief on receipt)
     sequential
     SEO Specialist: on-page review + schema markup + UTM parameters
     Visual Creator: featured image + infographic + alt text (5-phase workflow)
     Social Manager: distribution copy + calendar + quote card briefs (repurposing matrix)
     Team Lead: validates full package  Publish
```

**Standard podcast workflow:**
```
Team Lead (episode brief + guest details + publication date)
    
     Podcast Producer: outline + script/host guide + show notes + metadata package + repurposing flags
     SEO Specialist: show notes keyword optimization + episode description + schema
     parallel
     Visual Creator: episode artwork + guest card + audiogram still
     Social Manager: launch promotion package (platform posts + distribution calendar)
    
     Team Lead: validates full package → Publish
```

**Handoff protocol:** each specialist summarizes in its output  decisions made, assets produced, assumptions, and any blockers. The team lead validates this summary before synthesizing the final deliverable.

**Failure handling:** if a specialist task fails or goes out of scope, the team lead surfaces the failure immediately rather than silently retrying. Blocked work is reported with context so the operator can decide how to proceed.

**Escalation protocol:** certain situations must bypass the normal async workflow and be escalated to the team lead or human operator immediately  before completing or delivering any other work:
- Legal or copyright concerns in draft content (unauthorized quotes, licensed images, plagiarism risk)
- Brand reputation risks: content that could be interpreted as offensive, misleading, or factually incorrect on a sensitive topic
- Guest or subject matter disputes: if a guest requests editorial approval beyond courtesy review of their own quotes, escalate before proceeding
- Sensitive topics with legal exposure: health claims, financial advice, political content, or content referencing named private individuals
- Content calendar conflicts with live news events or organizational crises: timing-sensitive content should be held until the team lead or human approves publication
- Social media crisis: a post generating unexpected negative viral engagement, legal allegations, or safety concerns triggers crisis protocol before any public response

`@content-media-podcast-producer-eca4c308` and `@content-media-blog-writer-editor-d3115369` are the primary escalation triggers for content-level concerns; `@content-media-seo-discoverability-specialist-4bf7a7d9` escalates technical SEO issues requiring CMS or platform access; `@content-media-social-media-community-manager-e06af256` triggers crisis protocol for social situations.

#### Strengths

- **Full content lifecycle coverage** — from keyword research and briefs through writing, optimization, visual production, and social distribution, for both blog and podcast formats
- **Content multiplication** — a single topic brief generates a complete cross-format package: podcast episode + show notes + companion blog post + featured image + episode cover art + social thread + quote card + short-form clip brief; the team lead defines which multiplications are in scope
- **Domain-aware routing** — the team lead routes based on content type and phase, not availability
- **Parallel execution** — independent work streams (keyword research + drafting, visual production + social planning) run simultaneously, reducing time to publication
- **Structured approval stages** — team lead applies named content approval stages (Briefed → In Production → Ready for Review → Approved → Scheduled/Publishable) across all workflows, preventing confusion about where a piece stands
- **Structured quality standards** — each specialist has explicit definition-of-done checklists, self-editing protocols, and edge-case escalation tables
- **Repurposing-first mindset** — podcast producer flags repurposing opportunities, produces trailers and teasers for new launches, and plans season arcs; social manager applies the content repurposing matrix; a single episode or article seeds multiple assets
- **Attribution-ready distribution** — UTM parameters flow from SEO specialist through social manager so every distributed link is correctly traffic-tracked from day one
- **Competitor-aware content strategy** — SEO specialist runs competitor content analysis before new pieces are written, identifying differentiation angles so content is built to outrank, not just match, existing coverage
- **Multi-platform podcast discovery** — SEO specialist applies platform-specific optimization for Apple Podcasts, Spotify, and YouTube in addition to web search; show discovery compounds across platforms
- **Multi-channel social** — social manager covers all major platforms including Threads, manages LinkedIn native newsletter as a distinct channel, and applies per-platform posting time guidance
- **Content cluster architecture** — SEO specialist builds topical authority across related articles (pillar + clusters), monitors at 30/60/90 days, and recommends refreshes before rankings stall
- **Guest amplification** — social manager produces guest share kits; podcast producer coordinates notification timing; guest audiences compound organic reach without paid distribution
- **Performance-informed editorial** — the team lead receives performance reports from SEO and social, translating data into calendar adjustments: more of what works, less of what doesn't
- **Sponsored content governance** — team lead owns the canonical approval and disclosure workflow; specialists apply role-specific handling without duplicating approval decisions
- **Traceable handoffs** — each specialist's output includes decisions, assets, and assumptions, giving the team lead enough context to synthesize accurately

#### Ideal Use Cases

- **New blog series launch**: audience persona + keyword strategy + competitor analysis + content cluster map (`@content-media-seo-discoverability-specialist-4bf7a7d9`) + article drafts for each article type needed (`@content-media-blog-writer-editor-d3115369`) + featured images, infographics, and carousel assets (`@content-media-visual-content-creator-044f361e`) + social launch campaign with UTM links, newsletter teaser copy, and LinkedIn native newsletter issue (`@content-media-social-media-community-manager-e06af256`) — all coordinated by the team lead
- **Podcast episode production (full package)**: scripting + show notes + metadata + repurposing flags (`@content-media-podcast-producer-eca4c308`) → SEO optimization + platform-specific podcast discovery optimization + UTM parameters (`@content-media-seo-discoverability-specialist-4bf7a7d9`) → episode artwork + audiogram still + dark mode email header (`@content-media-visual-content-creator-044f361e`) → social launch promotion + guest share kit + Threads post (`@content-media-social-media-community-manager-e06af256`)
- **New show or season launch**: trailer script + episode arc plan + first 3 episode packages (`@content-media-podcast-producer-eca4c308`) + series cover art + episode artwork template + show trailer audiogram still (`@content-media-visual-content-creator-044f361e`) + social series launch campaign with guest share kits (`@content-media-social-media-community-manager-e06af256`)
- **Content repurposing**: podcast transcript → companion blog post (`@content-media-blog-writer-editor-d3115369`) → SEO optimization → social clips, quote cards, and audiogram stills; or pillar blog post → infographic → carousel → drip social campaign
- **Ghostwritten byline content**: expert voice inputs + voice samples → blog post in expert's voice (`@content-media-blog-writer-editor-d3115369`) → SEO optimization → visual assets → social promotion attributed to the named expert
- **Monthly content calendar execution**: team lead sequences a full month of blog and podcast content across all specialists in parallel; SEO briefs out first, then writing and production in parallel, then visual and social in parallel after approval; weekly editorial standup keeps all specialists aligned
- **SEO content refresh**: competitor analysis + gap analysis + audit + refresh recommendations (`@content-media-seo-discoverability-specialist-4bf7a7d9`) → updated article drafts (`@content-media-blog-writer-editor-d3115369`) → updated visual assets if headline or imagery changed (`@content-media-visual-content-creator-044f361e`)
- **Content cluster buildout**: pillar page + 3–5 cluster articles with bidirectional internal links established before any piece publishes, all assets produced and social distribution planned before the series launches
- **Brand refresh**: team lead triggers brand refresh protocol → visual creator updates all templates using brand refresh checklist → social manager and blog writer update any active briefs referencing old brand elements

#### Anti-patterns

- **Single-domain requests**: if a task clearly belongs to one specialist (e.g., "edit this draft", "optimize this post's SEO"), use `create_task` directly for that agent. Team overhead is not justified for single-specialist work.
- **Publishing without SEO review**: every piece should pass through SEO optimization before publication — skipping this step reduces discoverability, misses schema markup, and means UTM parameters are never defined.
- **Distributing links without UTM parameters**: social posts without UTM tags make organic traffic attribution impossible — always complete the SEO → UTM → social handoff in sequence.
- **Underbriefed content goals**: the team requires a clear topic, audience, and goal to decompose effectively. "Write something about AI" without audience or purpose produces misaligned parallel work.
- **Over-parallelizing dependent phases**: do not dispatch the visual creator to produce a featured image before the article headline is finalized; do not dispatch the social manager before the publication URL exists.
- **Skipping crisis protocol**: social crisis situations must be escalated before any public engagement — unilateral replies to high-stakes comments can amplify risk.
- **Proceeding on sponsored content without team lead approval**: any paid placement, sponsor read, or affiliate arrangement requires explicit team lead confirmation before specialists begin drafting — this is not optional.

---
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

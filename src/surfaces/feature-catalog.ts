import type { ApiDeps } from './api.js';

export interface DispatchFeatureAction {
  id: string;
  label: string;
  description: string;
}

export interface DispatchFeatureEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
}

export interface DispatchFeature {
  id: string;
  title: string;
  category: string;
  summary: string;
  details: string;
  status: string;
  configuration: string[];
  actions: DispatchFeatureAction[];
  endpoints: DispatchFeatureEndpoint[];
}

export interface DispatchFeatureCategory {
  id: string;
  title: string;
  description: string;
}

export interface DispatchFeatureCatalog {
  generatedAt: string;
  categories: DispatchFeatureCategory[];
  features: DispatchFeature[];
}

const categories: DispatchFeatureCategory[] = [
  { id: 'orchestration', title: 'Orchestration', description: 'Create, run, inspect, and recover work across Dispatch tasks and agents.' },
  { id: 'configuration', title: 'Configuration', description: 'Configure agents, teams, models, skills, and system behavior.' },
  { id: 'automation', title: 'Automation', description: 'Run Dispatch from schedules, events, webhooks, and browser commands.' },
  { id: 'knowledge', title: 'Knowledge', description: 'Use memory, conversations, chat, and proactive check-ins.' },
  { id: 'operations', title: 'Operations', description: 'Monitor, reload, restart, and maintain the daemon.' },
];

export function createFeatureCatalog(deps: ApiDeps): DispatchFeatureCatalog {
  const taskStats = deps.taskManager.getStats();
  const agents = deps.agentLoader.list();
  const teams = deps.teamRepo.listAll();
  const skills = deps.skillManager.listAll();
  const enabledSkills = skills.filter(skill => skill.enabled);
  const jobs = deps.automationScheduler.listAll();
  const enabledJobs = jobs.filter(job => job.enabled);
  const models = deps.modelManager.listModels();
  const chatModel = deps.modelManager.getChatModel();
  const memoryStats = deps.memoryManager.getStats() as Record<string, unknown>;
  const pendingApprovals = deps.approvalManager.getPending();
  const executionSettings = deps.executionSettings.get();
  const taskRuntime = deps.taskRuntimeConfig.get();
  const workIqEnabled =
    (taskRuntime.mcpServers.workiq !== undefined || taskRuntime.enableConfigDiscovery)
    && !taskRuntime.disabledMcpServers.some(name => name.toLowerCase() === 'workiq');

  const feature = (input: DispatchFeature): DispatchFeature => input;

  return {
    generatedAt: new Date().toISOString(),
    categories,
    features: [
      feature({
        id: 'tasks',
        title: 'Tasks',
        category: 'orchestration',
        summary: 'Create Dispatch work items, route them to agents, and inspect their outputs.',
        details: 'Tasks are the core unit of work. They can be created from VS Code, chat, automation, teams, or the REST API, then queued, cancelled, retried, recovered, and inspected with events, artifacts, approvals, and checkpoints.',
        status: `Queue ${deps.scheduler.queueLength}, running ${deps.scheduler.runningCount}, max sessions ${executionSettings.maxConcurrentSessions}, task idle timeout ${Math.round(executionSettings.taskSessionIdleTimeoutMs / 60_000)} min, totals ${JSON.stringify(taskStats)}`,
        configuration: [
          'Task title, description, priority, agent, repository path, and pre-approved execution metadata.',
          'Execution requires approval unless the task is explicitly marked pre-approved.',
          'Task sessions default to Copilot CLI autopilot runtime capabilities with configurable skill, MCP, and tool exclusions.',
        ],
        actions: [
          { id: 'tasks.create', label: 'Create task', description: 'Open the VS Code task creation flow.' },
          { id: 'tasks.refresh', label: 'Refresh tasks', description: 'Reload the Tasks view.' },
          { id: 'tasks.configureExecution', label: 'Configure execution', description: 'Edit max concurrent task sessions and task idle timeout.' },
          { id: 'taskRuntime.configure', label: 'Configure runtime', description: 'Configure task skills, MCP servers, and tool exclusions.' },
        ],
        endpoints: [
          { method: 'POST', path: '/api/tasks', description: 'Create a task.' },
          { method: 'GET', path: '/api/tasks', description: 'List tasks.' },
          { method: 'PUT', path: '/api/tasks/:id', description: 'Edit a non-running task.' },
          { method: 'GET', path: '/api/execution/settings', description: 'Read execution settings.' },
          { method: 'POST', path: '/api/execution/settings', description: 'Update execution settings such as max concurrent sessions and task idle timeout.' },
          { method: 'GET', path: '/api/task-runtime/config', description: 'Read task runtime capability configuration.' },
          { method: 'POST', path: '/api/task-runtime/config', description: 'Update task runtime capability configuration.' },
          { method: 'POST', path: '/api/tasks/enqueue-pending', description: 'Queue pending tasks by priority while respecting approvals.' },
          { method: 'GET', path: '/api/tasks/:id/details', description: 'Inspect task events, artifacts, approvals, and locations.' },
          { method: 'POST', path: '/api/tasks/:id/enqueue', description: 'Request or start execution.' },
          { method: 'DELETE', path: '/api/tasks/:id', description: 'Delete a non-running task; use recursive=true for subtasks.' },
        ],
      }),
      feature({
        id: 'workiq',
        title: 'WorkIQ Integration',
        category: 'knowledge',
        summary: 'Optionally expose Microsoft 365 workplace intelligence to Dispatch task sessions.',
        details: 'WorkIQ can be added to the task runtime as an MCP server so agents can use workplace context when the local environment has the WorkIQ MCP package/auth configured.',
        status: workIqEnabled ? 'Configured in task runtime' : 'Not configured',
        configuration: [
          'Enable or disable WorkIQ from VS Code through Configure WorkIQ.',
          'Requires the WorkIQ MCP package and authentication available to the daemon process.',
        ],
        actions: [
          { id: 'workiq.configure', label: 'Configure WorkIQ', description: 'Enable or disable WorkIQ for Dispatch task sessions.' },
        ],
        endpoints: [
          { method: 'POST', path: '/api/integrations/workiq', description: 'Enable or disable WorkIQ task runtime integration.' },
        ],
      }),
      feature({
        id: 'agents',
        title: 'Agents',
        category: 'configuration',
        summary: 'Define specialized Copilot-backed workers with reusable instructions and model settings.',
        details: 'Agents are loaded from .agent.md files. Dispatch can also generate new agent definitions from a natural-language description through Copilot, save them, and reload the agent registry.',
        status: `${agents.length} loaded agent(s)`,
        configuration: [
          'Agent markdown files define name, description, model, skills, tools, MCP servers, and system prompt.',
          'Agent definitions can be opened and edited directly from VS Code.',
        ],
        actions: [
          { id: 'agents.create', label: 'Create agent', description: 'Describe an agent and let Copilot generate the definition.' },
          { id: 'agents.openConfig', label: 'Open agent config', description: 'Open an agent markdown definition.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/agents', description: 'List loaded agents.' },
          { method: 'POST', path: '/api/agents/generate', description: 'Generate and install an agent definition.' },
          { method: 'GET', path: '/api/agents/:name/content', description: 'Read an agent definition.' },
        ],
      }),
      feature({
        id: 'teams',
        title: 'Agent Teams',
        category: 'orchestration',
        summary: 'Group agents behind a team lead that plans work and coordinates member agents.',
        details: 'A team run creates a lead planning task and dependent member implementation tasks. Member execution can be pre-approved or routed through the approval workflow.',
        status: `${teams.length} configured team(s)`,
        configuration: [
          'Team name, description, lead agent, member agents, and run-level approval mode.',
          'Member tasks depend on the lead task and include team metadata for traceability.',
        ],
        actions: [
          { id: 'teams.create', label: 'Create team', description: 'Select a lead and member agents.' },
          { id: 'teams.run', label: 'Run team', description: 'Create a lead plan and member tasks for a goal.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/teams', description: 'List teams.' },
          { method: 'POST', path: '/api/teams', description: 'Create a team.' },
          { method: 'POST', path: '/api/teams/:id/run', description: 'Start a team run.' },
        ],
      }),
      feature({
        id: 'skills',
        title: 'Skills',
        category: 'configuration',
        summary: 'Install, create, enable, disable, and inspect SKILL.md knowledge packs.',
        details: 'Skills teach agents how to use tools, platforms, APIs, or workflows. Dispatch tracks bundled, user-created, registry, and GitHub-installed skills and exposes their configuration in VS Code.',
        status: `${skills.length} installed skill(s), ${enabledSkills.length} enabled`,
        configuration: [
          'Each skill is a directory with SKILL.md content and persisted enablement state.',
          'Skills can be created locally, installed from GitHub, or installed directly from skills.sh URLs/specs.',
        ],
        actions: [
          { id: 'skills.create', label: 'Create skill', description: 'Create a local skill.' },
          { id: 'skills.installRegistry', label: 'Install from skills.sh', description: 'Install from a skills.sh URL, install command, or owner/repo/skill spec.' },
          { id: 'skills.installGitHub', label: 'Install from GitHub', description: 'Install from a GitHub repository URL.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/skills', description: 'List or search skills.' },
          { method: 'POST', path: '/api/skills/create', description: 'Create a skill.' },
          { method: 'POST', path: '/api/skills/install/github', description: 'Install a GitHub skill.' },
          { method: 'POST', path: '/api/skills/install/skills-sh', description: 'Install a skills.sh skill.' },
          { method: 'POST', path: '/api/skills/:id/enable', description: 'Enable a skill.' },
        ],
      }),
      feature({
        id: 'automation',
        title: 'Automation Jobs',
        category: 'automation',
        summary: 'Trigger Dispatch work from schedules, webhooks, or internal events.',
        details: 'Automation jobs support cron-like schedules, webhook ingress, and event subscriptions. Actions can create tasks, log messages, call HTTP endpoints, or run daemon-host commands.',
        status: `${jobs.length} job(s), ${enabledJobs.length} enabled`,
        configuration: [
          'Trigger types: cron, webhook, event.',
          'Action types: create_task, log, http_request, run_command.',
        ],
        actions: [
          { id: 'automation.create', label: 'Create automation job', description: 'Configure a new trigger and action.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/automation', description: 'List automation jobs.' },
          { method: 'POST', path: '/api/automation', description: 'Create an automation job.' },
          { method: 'POST', path: '/api/webhooks/:path', description: 'Trigger webhook-backed automation.' },
        ],
      }),
      feature({
        id: 'approvals',
        title: 'Approvals',
        category: 'orchestration',
        summary: 'Review and approve execution or other gated actions before Dispatch proceeds.',
        details: 'Approval requests are created when non-pre-approved work is queued for execution. VS Code can approve or reject pending requests and receives notifications for new approval events.',
        status: `${pendingApprovals.length} pending approval(s)`,
        configuration: [
          'Tasks and team runs can be pre-approved or approval-gated.',
          'Approval decisions are recorded with the deciding user/source.',
        ],
        actions: [
          { id: 'approvals.refresh', label: 'Refresh approvals', description: 'Reload the Approvals view.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/approvals', description: 'List pending approvals.' },
          { method: 'POST', path: '/api/approvals/:id/approve', description: 'Approve a request.' },
          { method: 'POST', path: '/api/approvals/:id/reject', description: 'Reject a request.' },
        ],
      }),
      feature({
        id: 'models',
        title: 'Models',
        category: 'configuration',
        summary: 'Choose the default Copilot model, Dispatch Chat model, and per-agent overrides.',
        details: 'Dispatch exposes the model registry, the current default model, the Dispatch Chat planner model, and agent-level overrides so users can tune cost, quality, and speed by workflow.',
        status: `Default ${deps.modelManager.getDefault()}, Dispatch Chat ${chatModel}, ${models.length} available model(s)`,
        configuration: [
          'Default model applies when an agent does not specify or override a model.',
          'Dispatch Chat can use its own model, or follow the global default model.',
          'Per-agent overrides can be reset back to the agent definition default.',
        ],
        actions: [
          { id: 'models.switch', label: 'Switch model', description: 'Change default or per-agent model.' },
          { id: 'models.reset', label: 'Reset agent override', description: 'Clear an agent-specific model override.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/models', description: 'List models and overrides.' },
          { method: 'POST', path: '/api/models/switch', description: 'Set default or agent model.' },
          { method: 'GET', path: '/api/chat/model', description: 'Get the Dispatch Chat model.' },
          { method: 'POST', path: '/api/chat/model', description: 'Set the Dispatch Chat model.' },
          { method: 'POST', path: '/api/models/reset', description: 'Reset an agent override.' },
        ],
      }),
      feature({
        id: 'chat',
        title: 'Dispatch Chat',
        category: 'knowledge',
        summary: 'Talk to Dispatch from VS Code for status, lists, memory lookup, and lightweight commands.',
        details: 'Chat records conversations into memory and uses a configurable Copilot model to plan allowlisted Dispatch actions such as listing resources, creating tasks, generating agents, creating teams, installing skills, model switching, and reload.',
        status: `Available through VS Code and /api/chat using ${chatModel}`,
        configuration: [
          'Chat channel and speaker metadata are recorded for future memory relevance.',
          'The chat model can be changed from the Dispatch Chat panel.',
          'Use the Dispatch activity bar for richer workflows when chat returns guidance.',
        ],
        actions: [
          { id: 'chat.open', label: 'Open chat', description: 'Open the Dispatch chat panel.' },
        ],
        endpoints: [
          { method: 'POST', path: '/api/chat', description: 'Send a chat command or message.' },
          { method: 'GET', path: '/api/chat/model', description: 'Get the active chat model.' },
          { method: 'POST', path: '/api/chat/model', description: 'Change the active chat model.' },
        ],
      }),
      feature({
        id: 'memory',
        title: 'Memory',
        category: 'knowledge',
        summary: 'Store and retrieve conversations, facts, entities, relevance suggestions, and episodic summaries.',
        details: 'Memory helps Dispatch recall prior conversations and project context. It powers chat suggestions, entity profiles, fact search, conversation search, and proactive context building.',
        status: Object.entries(memoryStats).map(([key, value]) => `${key}: ${value}`).join(', '),
        configuration: [
          'Memory APIs support channel filters, text search, entity profiles, and relevance suggestions.',
          'VS Code exposes a Memory Explorer command for facts, entities, episodes, and conversations.',
        ],
        actions: [
          { id: 'memory.open', label: 'Open memory explorer', description: 'Browse facts, entities, episodes, and conversations.' },
        ],
        endpoints: [
          { method: 'POST', path: '/api/memory/suggest', description: 'Find relevant memory for a message.' },
          { method: 'GET', path: '/api/memory/facts', description: 'Search facts.' },
          { method: 'GET', path: '/api/conversations/search', description: 'Search conversations.' },
        ],
      }),
      feature({
        id: 'browser',
        title: 'Browser Automation',
        category: 'automation',
        summary: 'Drive a Playwright browser with natural language or direct browser actions.',
        details: 'The browser engine can navigate, click, fill, press keys, scroll, inspect page content, capture screenshots, and execute natural-language browser commands through the daemon.',
        status: deps.browserEngine.isRunning() ? 'Browser running' : 'Browser idle',
        configuration: [
          'Browser settings are configured in the daemon BrowserEngine setup.',
          'Screenshots and page inspection are available through browser endpoints.',
        ],
        actions: [
          { id: 'browser.runCommand', label: 'Run browser command', description: 'Send a natural-language browser command.' },
        ],
        endpoints: [
          { method: 'POST', path: '/api/browser/command', description: 'Run a natural-language browser command.' },
          { method: 'POST', path: '/api/browser/navigate', description: 'Navigate to a URL.' },
          { method: 'GET', path: '/api/browser/status', description: 'Inspect browser state.' },
        ],
      }),
      feature({
        id: 'checkin',
        title: 'Proactive Check-In',
        category: 'knowledge',
        summary: 'Ask Dispatch for warnings, suggestions, and status insights.',
        details: 'The proactive check-in evaluates current daemon state and returns user-facing messages when Dispatch sees something that deserves attention.',
        status: 'Available on demand',
        configuration: [
          'Check-ins are computed from current task, approval, and system state.',
        ],
        actions: [
          { id: 'checkin.show', label: 'Show check-in', description: 'Evaluate and display current check-in messages.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/checkin', description: 'Evaluate proactive check-in messages.' },
        ],
      }),
      feature({
        id: 'system',
        title: 'System Operations',
        category: 'operations',
        summary: 'Inspect health, stream events, reload configs, restart, and update Dispatch.',
        details: 'Operational controls keep the daemon visible and manageable from VS Code. The event stream powers live task and approval updates.',
        status: `Uptime ${Math.round(process.uptime())}s`,
        configuration: [
          'VS Code settings include dispatch.apiUrl and dispatch.autoRefreshInterval.',
          'DISPATCH_API_KEY can enable bearer-token API authentication for the daemon.',
        ],
        actions: [
          { id: 'system.openSettings', label: 'Open VS Code settings', description: 'Configure the Dispatch extension.' },
          { id: 'system.reload', label: 'Reload agents and skills', description: 'Reload daemon configuration.' },
          { id: 'system.restart', label: 'Restart daemon', description: 'Request daemon restart.' },
          { id: 'system.update', label: 'Update Dispatch', description: 'Run the daemon self-update flow.' },
        ],
        endpoints: [
          { method: 'GET', path: '/api/health', description: 'Daemon health and uptime.' },
          { method: 'GET', path: '/api/stats', description: 'Runtime stats.' },
          { method: 'GET', path: '/api/events/stream', description: 'Server-sent event stream.' },
          { method: 'POST', path: '/api/reload', description: 'Reload agents and skills.' },
        ],
      }),
    ],
  };
}

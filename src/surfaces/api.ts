import express from 'express';
import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { Scheduler } from '../control-plane/scheduler.js';
import type { SessionPool } from '../execution/session-pool.js';
import type { AgentLoader } from '../execution/agent-loader.js';
import type { SessionRunner } from '../execution/session-runner.js';
import type { EventBus } from '../control-plane/event-bus.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { AutomationScheduler } from '../automation/automation-scheduler.js';
import type { ModelManager } from '../execution/model-manager.js';

export interface ApiDeps {
  taskManager: TaskManager;
  approvalManager: ApprovalManager;
  scheduler: Scheduler;
  sessionPool: SessionPool;
  agentLoader: AgentLoader;
  sessionRunner: SessionRunner;
  eventBus: EventBus;
  memoryManager: MemoryManager;
  skillManager: SkillManager;
  automationScheduler: AutomationScheduler;
  modelManager: ModelManager;
}

export function createApi(deps: ApiDeps): express.Express {
  const app = express();
  app.use(express.json());

  // --- Tasks ---
  app.post('/api/tasks', (req, res) => {
    try {
      const task = deps.taskManager.createTask({ ...req.body, createdBy: req.body.createdBy ?? 'api' });
      res.status(201).json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tasks', (req, res) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const tasks = deps.taskManager.listTasks(status as any, limit);
    res.json(tasks);
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = deps.taskManager.getTask(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  });

  app.post('/api/tasks/:id/enqueue', (req, res) => {
    try {
      const task = deps.taskManager.enqueueTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/cancel', (req, res) => {
    try {
      const task = deps.taskManager.cancelTask(req.params.id, req.body.reason ?? 'Cancelled via API');
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/retry', (req, res) => {
    try {
      const task = deps.taskManager.retryTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/execute', async (req, res) => {
    try {
      const task = deps.taskManager.getTask(req.params.id);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      deps.taskManager.enqueueTask(req.params.id);
      // Fire-and-forget execution
      deps.sessionRunner.executeTask(req.params.id).catch(() => {});
      res.json({ message: `Task ${task.id} dispatched for execution` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tasks/:id/events', (req, res) => {
    const events = deps.taskManager.getTaskEvents(req.params.id);
    res.json(events);
  });

  app.get('/api/tasks/:id/subtasks', (req, res) => {
    const subtasks = deps.taskManager.getSubtasks(req.params.id);
    res.json(subtasks);
  });

  // --- Approvals ---
  app.get('/api/approvals', (req, res) => {
    const approvals = deps.approvalManager.getPending();
    res.json(approvals);
  });

  app.post('/api/approvals/:id/approve', (req, res) => {
    const approval = deps.approvalManager.approve(req.params.id, req.body.decidedBy ?? 'api-user');
    if (!approval) { res.status(404).json({ error: 'Approval not found or already decided' }); return; }
    res.json(approval);
  });

  app.post('/api/approvals/:id/reject', (req, res) => {
    const approval = deps.approvalManager.reject(req.params.id, req.body.decidedBy ?? 'api-user');
    if (!approval) { res.status(404).json({ error: 'Approval not found or already decided' }); return; }
    res.json(approval);
  });

  // --- Agents ---
  app.get('/api/agents', (req, res) => {
    const agents = deps.agentLoader.list().map(a => ({
      name: `@${a.name.toLowerCase().replace(/\s+/g, '-')}`,
      description: a.description,
      model: a.model,
      skills: a.skills,
    }));
    res.json(agents);
  });

  // --- Stats / Health ---
  app.get('/api/stats', (req, res) => {
    res.json({
      tasks: deps.taskManager.getStats(),
      queue: deps.scheduler.queueLength,
      running: deps.scheduler.runningCount,
      sessions: {
        active: deps.sessionPool.size,
        available: deps.sessionPool.available,
      },
      pendingApprovals: deps.approvalManager.getPending().length,
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // --- Models ---
  app.get('/api/models', (req, res) => {
    res.json({
      current: deps.modelManager.getDefault(),
      agentOverrides: deps.modelManager.getAgentOverrides(),
      available: deps.modelManager.listModels(),
    });
  });

  app.get('/api/models/current', (req, res) => {
    res.json({ model: deps.modelManager.getDefault() });
  });

  app.post('/api/models/switch', (req, res) => {
    const { model, agent } = req.body;
    if (!model) { res.status(400).json({ error: '"model" required' }); return; }

    const found = deps.modelManager.findModel(model);
    if (!found) { res.status(400).json({ error: `Unknown model: ${model}. Use GET /api/models for available models.` }); return; }

    if (agent) {
      deps.modelManager.setAgentModel(agent, found.id);
      res.json({ message: `Agent ${agent} switched to ${found.id}`, agent, model: found.id });
    } else {
      deps.modelManager.setDefault(found.id);
      res.json({ message: `Default model switched to ${found.id}`, model: found.id });
    }
  });

  app.post('/api/models/reset', (req, res) => {
    const { agent } = req.body;
    if (agent) {
      deps.modelManager.clearAgentModel(agent);
      res.json({ message: `Agent ${agent} model reset to definition default`, agent });
    } else {
      res.status(400).json({ error: 'Specify "agent" to reset, or use /api/models/switch to set default' });
    }
  });

  // --- SSE Event Stream ---
  app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const handler = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    deps.eventBus.onAny(handler);
    req.on('close', () => { deps.eventBus.off('*', handler); });
  });

  // --- Memory: Conversations ---
  app.post('/api/conversations', (req, res) => {
    try {
      const msg = deps.memoryManager.recordMessage({
        channel: req.body.channel ?? 'api',
        threadId: req.body.threadId,
        speaker: req.body.speaker ?? 'anonymous',
        speakerType: req.body.speakerType ?? 'user',
        role: req.body.role ?? 'user',
        content: req.body.content,
        metadata: req.body.metadata,
      });
      res.status(201).json(msg);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/conversations', (req, res) => {
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = channel
      ? deps.memoryManager.conversations.getRecentByChannel(channel, limit)
      : deps.memoryManager.conversations.getRecent(limit);
    res.json(messages);
  });

  app.get('/api/conversations/search', (req, res) => {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'Query parameter "q" required' }); return; }
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const messages = channel
      ? deps.memoryManager.conversations.searchInChannel(channel, q, limit)
      : deps.memoryManager.conversations.search(q, limit);
    res.json(messages);
  });

  app.get('/api/conversations/threads', (req, res) => {
    const channel = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const threads = channel
      ? deps.memoryManager.conversations.getThreadsByChannel(channel, limit)
      : deps.memoryManager.conversations.getThreads(limit);
    res.json(threads);
  });

  app.get('/api/conversations/thread/:channel/:threadId', (req, res) => {
    const messages = deps.memoryManager.conversations.getByThread(
      req.params.channel, req.params.threadId, 200,
    );
    res.json(messages);
  });

  // --- Memory: Relevance Suggestions ---
  app.post('/api/memory/suggest', (req, res) => {
    const { message, channel, limit } = req.body;
    if (!message) { res.status(400).json({ error: '"message" required' }); return; }
    const suggestions = deps.memoryManager.getRelevanceSuggestions(
      message, channel ?? 'api', limit ?? 10,
    );
    res.json(suggestions);
  });

  app.post('/api/memory/context', (req, res) => {
    const { message, speakers, channel } = req.body;
    if (!message) { res.status(400).json({ error: '"message" required' }); return; }
    const context = deps.memoryManager.buildContextForConversation(
      message, speakers ?? [], channel ?? 'api',
    );
    res.json({ context });
  });

  // --- Memory: Facts ---
  app.get('/api/memory/facts', (req, res) => {
    const entity = req.query.entity as string | undefined;
    const type = req.query.type as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;

    if (entity) {
      res.json(deps.memoryManager.proactive.getFactsByEntity(entity));
    } else if (q) {
      res.json(deps.memoryManager.proactive.searchFacts(q, limit));
    } else if (type) {
      res.json(deps.memoryManager.proactive.getFactsByType(type, limit));
    } else {
      res.json(deps.memoryManager.proactive.getRecentFacts(limit));
    }
  });

  app.get('/api/memory/entities', (req, res) => {
    res.json(deps.memoryManager.proactive.getAllEntities());
  });

  app.get('/api/memory/profile/:entity', (req, res) => {
    const profile = deps.memoryManager.proactive.getEntityProfile(req.params.entity);
    res.json({ entity: req.params.entity, profile });
  });

  // --- Memory: Episodic Summaries ---
  app.get('/api/memory/episodes', (req, res) => {
    const date = req.query.date as string | undefined;
    const channel = req.query.channel as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    if (q) {
      res.json(deps.memoryManager.episodic.searchSummaries(q, limit));
    } else if (date) {
      res.json(deps.memoryManager.episodic.getSummariesByDate(date));
    } else if (channel) {
      res.json(deps.memoryManager.episodic.getSummariesByChannel(channel, limit));
    } else {
      res.json(deps.memoryManager.episodic.getRecentSummaries(limit));
    }
  });

  // --- Memory: Stats ---
  app.get('/api/memory/stats', (req, res) => {
    res.json(deps.memoryManager.getStats());
  });

  // --- Skills ---
  app.get('/api/skills', (req, res) => {
    const origin = req.query.origin as string | undefined;
    const q = req.query.q as string | undefined;
    if (q) {
      res.json(deps.skillManager.search(q));
    } else if (origin) {
      res.json(deps.skillManager.listByOrigin(origin as any));
    } else {
      res.json({
        userInstalled: deps.skillManager.listUserInstalled(),
        systemCreated: deps.skillManager.listSystemCreated(),
      });
    }
  });

  app.get('/api/skills/:id', (req, res) => {
    const skill = deps.skillManager.get(req.params.id);
    if (!skill) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json(skill);
  });

  app.get('/api/skills/:id/content', (req, res) => {
    const content = deps.skillManager.readSkillContent(req.params.id);
    if (content === null) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, content });
  });

  app.post('/api/skills/create', (req, res) => {
    try {
      const { name, description, instructions } = req.body;
      if (!name || !instructions) { res.status(400).json({ error: '"name" and "instructions" required' }); return; }
      const skill = deps.skillManager.createSkill(name, description ?? '', instructions);
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/install/github', async (req, res) => {
    try {
      const { repoUrl, name } = req.body;
      if (!repoUrl) { res.status(400).json({ error: '"repoUrl" required' }); return; }
      const skill = await deps.skillManager.installFromGitHub(repoUrl, name);
      if (!skill) { res.status(400).json({ error: 'Failed to install skill' }); return; }
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/install/registry', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) { res.status(400).json({ error: '"name" required' }); return; }
      const skill = await deps.skillManager.installFromRegistry(name);
      if (!skill) { res.status(400).json({ error: 'Failed to install skill from registry' }); return; }
      res.status(201).json(skill);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/skills/:id/enable', (req, res) => {
    const ok = deps.skillManager.setEnabled(req.params.id, true);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, enabled: true });
  });

  app.post('/api/skills/:id/disable', (req, res) => {
    const ok = deps.skillManager.setEnabled(req.params.id, false);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, enabled: false });
  });

  app.delete('/api/skills/:id', (req, res) => {
    const ok = deps.skillManager.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json({ id: req.params.id, removed: true });
  });

  // --- Automation ---
  app.get('/api/automation', (req, res) => {
    const type = req.query.type as string | undefined;
    if (type) {
      res.json(deps.automationScheduler.listByType(type as any));
    } else {
      res.json(deps.automationScheduler.listAll());
    }
  });

  app.get('/api/automation/:id', (req, res) => {
    const job = deps.automationScheduler.getById(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json(job);
  });

  app.post('/api/automation', (req, res) => {
    try {
      const job = deps.automationScheduler.create(req.body);
      res.status(201).json(job);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/automation/:id/enable', (req, res) => {
    const ok = deps.automationScheduler.setEnabled(req.params.id, true);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, enabled: true });
  });

  app.post('/api/automation/:id/disable', (req, res) => {
    const ok = deps.automationScheduler.setEnabled(req.params.id, false);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, enabled: false });
  });

  app.post('/api/automation/:id/run', async (req, res) => {
    const job = deps.automationScheduler.getById(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    const result = await deps.automationScheduler.executeJob(job, req.body);
    res.json(result);
  });

  app.delete('/api/automation/:id', (req, res) => {
    const ok = deps.automationScheduler.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json({ id: req.params.id, removed: true });
  });

  // --- Webhook ingress ---
  app.post('/api/webhooks/:path', async (req, res) => {
    const result = await deps.automationScheduler.handleWebhook(req.params.path, req.body ?? {});
    if (!result) { res.status(404).json({ error: 'No webhook handler for this path' }); return; }
    res.json(result);
  });

  return app;
}

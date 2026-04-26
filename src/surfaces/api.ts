import express from 'express';
import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { Scheduler } from '../control-plane/scheduler.js';
import type { SessionPool } from '../execution/session-pool.js';
import type { AgentLoader } from '../execution/agent-loader.js';
import type { SessionRunner } from '../execution/session-runner.js';
import type { EventBus } from '../control-plane/event-bus.js';

export interface ApiDeps {
  taskManager: TaskManager;
  approvalManager: ApprovalManager;
  scheduler: Scheduler;
  sessionPool: SessionPool;
  agentLoader: AgentLoader;
  sessionRunner: SessionRunner;
  eventBus: EventBus;
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

  return app;
}

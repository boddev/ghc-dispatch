import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { TaskManager } from '../control-plane/task-manager.js';
import type { ApprovalManager } from '../control-plane/approval-manager.js';
import type { Scheduler } from '../control-plane/scheduler.js';
import type { SessionPool } from '../execution/session-pool.js';
import type { AgentLoader } from '../execution/agent-loader.js';
import { agentHandle } from '../execution/agent-loader.js';

export interface McpDeps {
  taskManager: TaskManager;
  approvalManager: ApprovalManager;
  scheduler: Scheduler;
  sessionPool: SessionPool;
  agentLoader: AgentLoader;
}

export function createMcpServer(deps: McpDeps): Server {
  const server = new Server(
    { name: 'ghc-dispatch', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'create_task',
        description: 'Create a new orchestrated task',
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Task description' },
            agent: { type: 'string', description: 'Agent to assign (e.g. @coder, @designer)', default: '@general-purpose' },
            priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
            repo: { type: 'string', description: 'Target repository path' },
          },
          required: ['title'],
        },
      },
      {
        name: 'get_task',
        description: 'Get task status and details',
        inputSchema: {
          type: 'object' as const,
          properties: { taskId: { type: 'string', description: 'Task ID' } },
          required: ['taskId'],
        },
      },
      {
        name: 'list_tasks',
        description: 'List tasks with optional status filter',
        inputSchema: {
          type: 'object' as const,
          properties: {
            status: { type: 'string', enum: ['pending', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] },
            limit: { type: 'number', default: 20 },
          },
        },
      },
      {
        name: 'cancel_task',
        description: 'Cancel a running or queued task',
        inputSchema: {
          type: 'object' as const,
          properties: {
            taskId: { type: 'string' },
            reason: { type: 'string', default: 'Cancelled via MCP' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'enqueue_task',
        description: 'Queue a pending task for execution',
        inputSchema: {
          type: 'object' as const,
          properties: { taskId: { type: 'string' } },
          required: ['taskId'],
        },
      },
      {
        name: 'retry_task',
        description: 'Retry a failed task',
        inputSchema: {
          type: 'object' as const,
          properties: { taskId: { type: 'string' } },
          required: ['taskId'],
        },
      },
      {
        name: 'approve_task',
        description: 'Approve a pending approval request',
        inputSchema: {
          type: 'object' as const,
          properties: {
            approvalId: { type: 'string' },
            decidedBy: { type: 'string', default: 'mcp-user' },
          },
          required: ['approvalId'],
        },
      },
      {
        name: 'reject_task',
        description: 'Reject a pending approval request',
        inputSchema: {
          type: 'object' as const,
          properties: {
            approvalId: { type: 'string' },
            decidedBy: { type: 'string', default: 'mcp-user' },
          },
          required: ['approvalId'],
        },
      },
      {
        name: 'get_task_events',
        description: 'Get event history for a task',
        inputSchema: {
          type: 'object' as const,
          properties: {
            taskId: { type: 'string' },
            limit: { type: 'number', default: 50 },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'list_agents',
        description: 'List available agent definitions',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'get_stats',
        description: 'Get orchestrator health and task statistics',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'get_pending_approvals',
        description: 'List all pending approval requests',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'create_task': {
          const task = deps.taskManager.createTask({
            title: (args as any).title,
            description: (args as any).description ?? '',
            agent: (args as any).agent ?? '@general-purpose',
            priority: (args as any).priority ?? 'normal',
            repo: (args as any).repo,
            createdBy: 'mcp',
          });
          return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
        }

        case 'get_task': {
          const task = deps.taskManager.getTask((args as any).taskId);
          if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
          return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
        }

        case 'list_tasks': {
          const tasks = deps.taskManager.listTasks((args as any).status, (args as any).limit ?? 20);
          const summary = tasks.map(t => `${t.id} [${t.status}] ${t.priority} ${t.agent} — ${t.title}`).join('\n');
          return { content: [{ type: 'text', text: summary || 'No tasks found' }] };
        }

        case 'cancel_task': {
          const task = deps.taskManager.cancelTask((args as any).taskId, (args as any).reason ?? 'Cancelled via MCP');
          return { content: [{ type: 'text', text: `Task ${task.id} cancelled` }] };
        }

        case 'enqueue_task': {
          const task = deps.taskManager.enqueueTask((args as any).taskId);
          return { content: [{ type: 'text', text: `Task ${task.id} queued for execution` }] };
        }

        case 'retry_task': {
          const task = deps.taskManager.retryTask((args as any).taskId);
          return { content: [{ type: 'text', text: `Task ${task.id} re-queued (retry ${task.retryCount})` }] };
        }

        case 'approve_task': {
          const approval = deps.approvalManager.approve((args as any).approvalId, (args as any).decidedBy ?? 'mcp-user');
          if (!approval) return { content: [{ type: 'text', text: 'Approval not found or already decided' }], isError: true };
          return { content: [{ type: 'text', text: `Approval ${approval.id} approved` }] };
        }

        case 'reject_task': {
          const approval = deps.approvalManager.reject((args as any).approvalId, (args as any).decidedBy ?? 'mcp-user');
          if (!approval) return { content: [{ type: 'text', text: 'Approval not found or already decided' }], isError: true };
          return { content: [{ type: 'text', text: `Approval ${approval.id} rejected` }] };
        }

        case 'get_task_events': {
          const events = deps.taskManager.getTaskEvents((args as any).taskId);
          const lines = events.slice(0, (args as any).limit ?? 50).map(e => `[${e.timestamp}] ${e.payload.type}`);
          return { content: [{ type: 'text', text: lines.join('\n') || 'No events' }] };
        }

        case 'list_agents': {
          const agents = deps.agentLoader.list();
          const lines = agents.map(a => `${agentHandle(a.name)} — ${a.description} (model: ${a.model})`);
          return { content: [{ type: 'text', text: lines.join('\n') || 'No agents loaded' }] };
        }

        case 'get_stats': {
          const stats = deps.taskManager.getStats();
          const queue = deps.scheduler.queueLength;
          const running = deps.scheduler.runningCount;
          const sessions = deps.sessionPool.size;
          const pending = deps.approvalManager.getPending().length;
          const text = [
            'GHC Dispatch Status',
            `  Queue: ${queue} task(s) waiting`,
            `  Running: ${running} task(s)`,
            `  Sessions: ${sessions}/${deps.sessionPool.available + sessions}`,
            `  Pending approvals: ${pending}`,
            '',
            'Task breakdown:',
            ...Object.entries(stats).map(([s, c]) => `  ${s}: ${c}`),
          ].join('\n');
          return { content: [{ type: 'text', text }] };
        }

        case 'get_pending_approvals': {
          const approvals = deps.approvalManager.getPending();
          const lines = approvals.map(a => `${a.id} [${a.type}] task:${a.taskId} — ${a.description} (expires: ${a.expiresAt})`);
          return { content: [{ type: 'text', text: lines.join('\n') || 'No pending approvals' }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return server;
}

export async function startMcpServer(deps: McpDeps): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

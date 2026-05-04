/**
 * Thin adapter layer around @github/copilot-sdk.
 * Isolates the rest of the codebase from SDK API changes.
 */

// NOTE: The Copilot SDK is currently in public preview.
// This adapter provides a stable interface that the rest of the
// orchestrator depends on. If the SDK API changes, only this file
// needs to be updated.

export interface SessionOptions {
  model?: string;
  workingDirectory?: string;
  enableConfigDiscovery?: boolean;
  mcpServers?: Record<string, unknown>;
  customAgents?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    tools?: string[] | null;
    prompt: string;
    mcpServers?: Record<string, unknown>;
  }>;
  agent?: string;
  skillDirectories?: string[];
  disabledSkills?: string[];
  availableTools?: string[];
  excludedTools?: string[];
  infiniteSessions?: {
    enabled?: boolean;
    backgroundCompactionThreshold?: number;
    bufferExhaustionThreshold?: number;
  };
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    handler: (args: unknown) => Promise<unknown> | unknown;
    skipPermission?: boolean;
  }>;
  onPermissionRequest?: (request: PermissionRequest) => Promise<boolean>;
  onEvent?: (event: SessionEvent) => void;
}

export interface PermissionRequest {
  type: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface SessionEvent {
  type: 'assistant.message' | 'assistant.message_delta' | 'tool_call' | 'tool_result' | 'session.idle' | 'error';
  data: {
    content?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    error?: string;
  };
}

export interface CopilotSession {
  id: string;
  model: string;
  send(prompt: string): Promise<void>;
  disconnect(): Promise<void>;
  isActive(): boolean;
}

export interface CopilotAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  createSession(options: SessionOptions): Promise<CopilotSession>;
  isRunning(): boolean;
}

export type CopilotRuntimePermissionResponse =
  | { kind: 'approve-once' }
  | { kind: 'reject'; feedback: string };

export function toCopilotRuntimePermissionResponse(approved: boolean): CopilotRuntimePermissionResponse {
  return approved
    ? { kind: 'approve-once' }
    : { kind: 'reject', feedback: 'Denied by Dispatch runtime configuration.' };
}

/**
 * Real Copilot SDK adapter.
 * Uses @github/copilot-sdk when available.
 */
export class CopilotSdkAdapter implements CopilotAdapter {
  private client: any = null;
  private running = false;

  async start(): Promise<void> {
    try {
      const { CopilotClient } = await import('@github/copilot-sdk');
      this.client = new CopilotClient();
      await this.client.start();
      this.running = true;
    } catch (err) {
      throw new Error(
        `Failed to start Copilot SDK client. Ensure @github/copilot-sdk is installed and ` +
        `you have an active Copilot subscription. Error: ${err}`
      );
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.running = false;
    }
  }

  async createSession(options: SessionOptions): Promise<CopilotSession> {
    if (!this.client) throw new Error('Copilot client not started');

    const session = await this.client.createSession({
      model: options.model,
      workingDirectory: options.workingDirectory,
      enableConfigDiscovery: options.enableConfigDiscovery,
      mcpServers: options.mcpServers,
      customAgents: options.customAgents,
      agent: options.agent,
      skillDirectories: options.skillDirectories,
      disabledSkills: options.disabledSkills,
      availableTools: options.availableTools,
      excludedTools: options.excludedTools,
      infiniteSessions: options.infiniteSessions,
      tools: options.tools,
      onPermissionRequest: options.onPermissionRequest
        ? async (req: any) => {
            const approved = await options.onPermissionRequest!({
              type: req.kind ?? req.type ?? 'unknown',
              description: req.description ?? req.toolName ?? req.fullCommandText ?? '',
              details: req,
            });
            return toCopilotRuntimePermissionResponse(approved);
          }
        : async () => toCopilotRuntimePermissionResponse(true),
    });

    const sessionId = `session-${Date.now()}`;

    if (options.onEvent) {
      const handler = options.onEvent;
      session.on('assistant.message', (evt: any) =>
        handler({ type: 'assistant.message', data: { content: evt.data?.content ?? '' } })
      );
      session.on('session.idle', () =>
        handler({ type: 'session.idle', data: {} })
      );
    }

    return {
      id: sessionId,
      model: options.model ?? 'default',
      async send(prompt: string) {
        await session.send({ prompt });
      },
      async disconnect() {
        await session.disconnect();
      },
      isActive: () => true,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Mock adapter for testing without a real Copilot subscription.
 */
export class MockCopilotAdapter implements CopilotAdapter {
  private running = false;
  private sessionCounter = 0;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async createSession(options: SessionOptions): Promise<CopilotSession> {
    const id = `mock-session-${++this.sessionCounter}`;
    let active = true;

    return {
      id,
      model: options.model ?? 'mock',
      async send(prompt: string) {
        if (options.onEvent) {
          options.onEvent({
            type: 'assistant.message',
            data: { content: `[Mock] Received: ${prompt}` },
          });
          options.onEvent({ type: 'session.idle', data: {} });
        }
      },
      async disconnect() {
        active = false;
      },
      isActive: () => active,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}

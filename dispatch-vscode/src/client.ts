/**
 * HTTP client for the dispatch daemon REST API.
 * Shared by all TreeView providers and webview panels.
 */

import * as http from 'http';

export class DispatchHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export class DispatchClient {
  constructor(private baseUrl: string) {}

  async get<T = any>(path: string, options?: { timeoutMs?: number }): Promise<T> {
    return this.request('GET', path, undefined, options);
  }

  async post<T = any>(path: string, body?: any, options?: { timeoutMs?: number }): Promise<T> {
    return this.request('POST', path, body, options);
  }

  async put<T = any>(path: string, body?: any, options?: { timeoutMs?: number }): Promise<T> {
    return this.request('PUT', path, body, options);
  }

  async del<T = any>(path: string, options?: { timeoutMs?: number }): Promise<T> {
    return this.request('DELETE', path, undefined, options);
  }

  createSseStream(path: string, onData: (event: any) => void, onError?: (err: Error) => void): () => void {
    const url = new URL(path, this.baseUrl);
    let aborted = false;
    let retryMs = 2_000;
    let activeReq: http.ClientRequest | undefined;
    let activeRes: http.IncomingMessage | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;

    const closeActiveConnection = () => {
      activeRes?.removeAllListeners();
      activeReq?.removeAllListeners();
      activeRes?.destroy();
      activeReq?.destroy();
      activeRes = undefined;
      activeReq = undefined;
    };

    const scheduleReconnect = (err?: Error) => {
      if (err) onError?.(err);
      if (aborted || reconnectTimer) return;

      const delay = retryMs + Math.floor(Math.random() * 1000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        closeActiveConnection();
        connect();
      }, delay);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    const connect = () => {
      if (aborted) return;
      closeActiveConnection();
      activeReq = http.get(url.toString(), (res) => {
        activeRes = res;
        retryMs = 2_000;
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';
          for (const block of lines) {
            const dataLine = block.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              try { onData(JSON.parse(dataLine.slice(6))); } catch {}
            }
          }
        });
        res.once('end', () => scheduleReconnect());
        res.once('close', () => scheduleReconnect());
        res.once('error', scheduleReconnect);
      }).once('error', scheduleReconnect);

      activeReq.once('close', () => {
        if (!activeRes) scheduleReconnect();
      });
    };

    connect();
    return () => {
      aborted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      closeActiveConnection();
    };
  }

  private request<T>(method: string, path: string, body?: any, requestOptions?: { timeoutMs?: number }): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: requestOptions?.timeoutMs ?? 10_000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : undefined;
            if (res.statusCode && res.statusCode >= 400) {
              const message = typeof parsed?.error === 'string' && parsed.error.trim().length > 0
                ? parsed.error
                : `HTTP ${res.statusCode}`;
              reject(new DispatchHttpError(message, res.statusCode, parsed?.requestId));
              return;
            }
            resolve(parsed as T);
          } catch {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new DispatchHttpError(data || `HTTP ${res.statusCode}`, res.statusCode));
              return;
            }
            resolve(data as any);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

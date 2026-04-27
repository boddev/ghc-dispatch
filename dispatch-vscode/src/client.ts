/**
 * HTTP client for the dispatch daemon REST API.
 * Shared by all TreeView providers and webview panels.
 */

import * as http from 'http';

export class DispatchClient {
  constructor(private baseUrl: string) {}

  async get<T = any>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  async post<T = any>(path: string, body?: any): Promise<T> {
    return this.request('POST', path, body);
  }

  async del<T = any>(path: string): Promise<T> {
    return this.request('DELETE', path);
  }

  createSseStream(path: string, onData: (event: any) => void, onError?: (err: Error) => void): () => void {
    const url = new URL(path, this.baseUrl);
    let aborted = false;

    const connect = () => {
      if (aborted) return;
      http.get(url.toString(), (res) => {
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
        res.on('end', () => { if (!aborted) setTimeout(connect, 2000); });
        res.on('error', (err) => { onError?.(err); if (!aborted) setTimeout(connect, 5000); });
      }).on('error', (err) => { onError?.(err); if (!aborted) setTimeout(connect, 5000); });
    };

    connect();
    return () => { aborted = true; };
  }

  private request<T>(method: string, path: string, body?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
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

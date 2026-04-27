"use strict";
/**
 * HTTP client for the dispatch daemon REST API.
 * Shared by all TreeView providers and webview panels.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchClient = void 0;
const http = __importStar(require("http"));
class DispatchClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async get(path) {
        return this.request('GET', path);
    }
    async post(path, body) {
        return this.request('POST', path, body);
    }
    async del(path) {
        return this.request('DELETE', path);
    }
    createSseStream(path, onData, onError) {
        const url = new URL(path, this.baseUrl);
        let aborted = false;
        const connect = () => {
            if (aborted)
                return;
            http.get(url.toString(), (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() ?? '';
                    for (const block of lines) {
                        const dataLine = block.split('\n').find(l => l.startsWith('data: '));
                        if (dataLine) {
                            try {
                                onData(JSON.parse(dataLine.slice(6)));
                            }
                            catch { }
                        }
                    }
                });
                res.on('end', () => { if (!aborted)
                    setTimeout(connect, 2000); });
                res.on('error', (err) => { onError?.(err); if (!aborted)
                    setTimeout(connect, 5000); });
            }).on('error', (err) => { onError?.(err); if (!aborted)
                setTimeout(connect, 5000); });
        };
        connect();
        return () => { aborted = true; };
    }
    request(method, path, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
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
                        resolve(JSON.parse(data));
                    }
                    catch {
                        resolve(data);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
            if (body)
                req.write(JSON.stringify(body));
            req.end();
        });
    }
}
exports.DispatchClient = DispatchClient;
//# sourceMappingURL=client.js.map
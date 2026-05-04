import * as vscode from 'vscode';
import { DispatchClient } from '../client';

function errorMessage(err: any, fallback: string): string {
  if (err?.message && String(err.message).trim().length > 0) return String(err.message);
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return fallback;
}

export function showDispatchChat(client: DispatchClient) {
  const panel = vscode.window.createWebviewPanel(
    'dispatchChat',
    'Dispatch Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const refreshModel = async () => {
    const modelInfo: any = await client.get('/api/chat/model');
    await panel.webview.postMessage({ command: 'model', model: modelInfo.model, override: modelInfo.override, defaultModel: modelInfo.defaultModel });
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'ready') {
      try { await refreshModel(); } catch {}
      return;
    }

    if (msg.command === 'changeModel') {
      try {
        const modelInfo: any = await client.get('/api/chat/model');
        const picked = await vscode.window.showQuickPick(
          [
            {
              label: `Follow default (${modelInfo.defaultModel})`,
              description: modelInfo.override ? 'Clear Dispatch Chat model override' : 'Current setting',
              model: 'default',
            },
            ...modelInfo.available.map((model: any) => ({
              label: model.id,
              description: `${model.provider} · ${model.tier}${model.id === modelInfo.model ? ' · active' : ''}`,
              detail: model.name,
              model: model.id,
            })),
          ],
          { placeHolder: `Dispatch Chat model: ${modelInfo.model}` },
        );
        if (!picked) return;
        const updated: any = await client.post('/api/chat/model', { model: picked.model });
        vscode.window.showInformationMessage(updated.message ?? `Dispatch Chat model set to ${updated.model}`);
        await refreshModel();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to change Dispatch Chat model: ${errorMessage(err, 'The daemon did not return an error message.')}`);
      }
      return;
    }

    if (msg.command === 'resetSession') {
      try {
        const result: any = await client.del(`/api/chat/session?speaker=${encodeURIComponent(vscode.env.machineId)}`);
        await panel.webview.postMessage({ command: 'reply', response: result.removed ? 'Dispatch Chat session reset. The next message will start a fresh Copilot CLI session.' : 'No active Dispatch Chat session was found to reset.' });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to reset Dispatch Chat session: ${errorMessage(err, 'The daemon did not return an error message.')}`);
      }
      return;
    }

    if (msg.command !== 'send' || !msg.message) return;
    try {
      await panel.webview.postMessage({ command: 'pending', pending: true });
      const result: any = await client.post('/api/chat', {
        message: msg.message,
        channel: 'vscode',
        speaker: vscode.env.machineId,
      }, { timeoutMs: 900_000 });
      await panel.webview.postMessage({ command: 'reply', response: result.response });
    } catch (err: any) {
      await panel.webview.postMessage({ command: 'reply', response: `Error: ${errorMessage(err, 'Dispatch Chat failed without an error message. Check the daemon logs or change the chat model.')}` });
    } finally {
      await panel.webview.postMessage({ command: 'pending', pending: false });
    }
  });

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);margin:0;height:100vh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--vscode-input-border);background:var(--vscode-sideBar-background)}
  #model{font-size:12px;opacity:.85}
  #log{flex:1;min-height:0;overflow:auto;padding:16px;box-sizing:border-box}
  .msg{margin:0 0 12px;padding:10px;border-radius:6px;white-space:pre-wrap;line-height:1.4}
  .user{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}
  .bot{background:var(--vscode-editor-inactiveSelectionBackground)}
  .status{background:transparent;border:1px dashed var(--vscode-input-border);opacity:.8;font-size:12px}
  form{display:flex;align-items:flex-end;gap:8px;padding:12px;border-top:1px solid var(--vscode-input-border)}
  textarea{flex:1;min-height:34px;max-height:180px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:8px;box-sizing:border-box;font:inherit;line-height:1.4;resize:none;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:8px 14px;cursor:pointer}
  #changeModel{padding:5px 10px}
  #resetSession{padding:5px 10px}
  button:disabled,textarea:disabled{opacity:.6;cursor:wait}
  button:hover{background:var(--vscode-button-hoverBackground)}
  .hint{opacity:.7;font-size:12px;margin-bottom:12px}
</style></head><body>
<header>
  <div id="model">Model: loading...</div>
  <div>
    <button id="changeModel" type="button">Change Model</button>
    <button id="resetSession" type="button">Reset Session</button>
  </div>
</header>
<div id="log">
  <div class="hint">Ask Dispatch to create teams, generate agents, install skills, create tasks, switch models, inspect files, run CLI commands, or summarize system features. This is a persistent Copilot CLI session with Dispatch tools. Long-running actions may take several minutes.</div>
</div>
<form id="form"><textarea id="input" rows="1" placeholder="Chat with Dispatch..." autofocus></textarea><button>Send</button></form>
<script>
const vscode = acquireVsCodeApi();
const log = document.getElementById('log');
const input = document.getElementById('input');
const button = document.querySelector('form button');
const model = document.getElementById('model');
const changeModel = document.getElementById('changeModel');
const resetSession = document.getElementById('resetSession');
let pendingNotice = false;
function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}
function add(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  add('user', message);
  input.value = '';
  resizeInput();
  vscode.postMessage({ command: 'send', message });
});
input.addEventListener('input', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('form').requestSubmit();
  }
});
changeModel.addEventListener('click', () => {
  vscode.postMessage({ command: 'changeModel' });
});
resetSession.addEventListener('click', () => {
  vscode.postMessage({ command: 'resetSession' });
});
window.addEventListener('message', (event) => {
  if (event.data.command === 'reply') add('bot', event.data.response);
  if (event.data.command === 'model') {
    const suffix = event.data.override ? 'override' : 'default';
    model.textContent = 'Model: ' + event.data.model + ' (' + suffix + ')';
  }
  if (event.data.command === 'pending') {
    input.disabled = event.data.pending;
    button.disabled = event.data.pending;
    button.textContent = event.data.pending ? 'Working...' : 'Send';
    changeModel.disabled = event.data.pending;
    resetSession.disabled = event.data.pending;
    if (event.data.pending && !pendingNotice) {
      pendingNotice = true;
      add('status', 'Working: planning the request, running allowed Dispatch actions, and collecting progress/results...');
    }
    if (!event.data.pending) pendingNotice = false;
  }
});
vscode.postMessage({ command: 'ready' });
</script></body></html>`;
}

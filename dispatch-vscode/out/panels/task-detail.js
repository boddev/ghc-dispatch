"use strict";
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
exports.showTaskDetail = showTaskDetail;
const vscode = __importStar(require("vscode"));
function showTaskDetail(client, taskId) {
    const panel = vscode.window.createWebviewPanel('dispatchTaskDetail', `Task: ${taskId.slice(-8)}`, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const apiBase = client.baseUrl ?? 'http://localhost:7878';
    panel.webview.onDidReceiveMessage(async (msg) => {
        try {
            if (msg.command === 'cancel')
                await client.post(`/api/tasks/${msg.taskId}/cancel`);
            if (msg.command === 'retry')
                await client.post(`/api/tasks/${msg.taskId}/retry`);
            if (msg.command === 'enqueue')
                await client.post(`/api/tasks/${msg.taskId}/enqueue`);
            vscode.window.showInformationMessage(`Task ${msg.taskId}: ${msg.command} done`);
        }
        catch (err) {
            vscode.window.showErrorMessage(err.message);
        }
    });
    panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:16px;margin:0}
  h1{font-size:18px;margin-bottom:4px}.meta{font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:16px}
  .f{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:8px}
  .fl{font-size:10px;text-transform:uppercase;opacity:.6;margin-bottom:2px}.fv{font-size:14px;font-weight:600}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500;color:#fff}
  .b-running{background:#f57c00}.b-completed{background:#2e7d32}.b-failed{background:#d32f2f}.b-pending{background:#616161}.b-queued{background:#1976d2}.b-cancelled{background:#757575}.b-paused{background:#7b1fa2}
  .ev{font-size:12px;padding:4px 0;border-bottom:1px solid var(--vscode-input-border);font-family:var(--vscode-editor-font-family)}
  .et{color:var(--vscode-descriptionForeground);margin-right:8px}
  .act{display:flex;gap:8px;margin-top:16px}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer}
  button:hover{background:var(--vscode-button-hoverBackground)}button.d{background:#d32f2f}
  .res{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:12px;margin-top:16px;white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;max-height:300px;overflow-y:auto}
</style></head><body>
<div id="c">Loading...</div>
<script>
const vsc=acquireVsCodeApi(),API='${apiBase}',TID='${taskId}';
function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function act(c){vsc.postMessage({command:c,taskId:TID});setTimeout(load,500)}
async function load(){try{
  const[t,ev]=await Promise.all([fetch(API+'/api/tasks/'+TID).then(r=>r.json()),fetch(API+'/api/tasks/'+TID+'/events').then(r=>r.json())]);
  document.getElementById('c').innerHTML=
    '<h1>'+esc(t.title)+'</h1><div class="meta">'+t.id+'</div>'+
    '<div class="grid">'+
    '<div class="f"><div class="fl">Status</div><div class="fv"><span class="badge b-'+t.status+'">'+t.status+'</span></div></div>'+
    '<div class="f"><div class="fl">Agent</div><div class="fv">'+esc(t.agent)+'</div></div>'+
    '<div class="f"><div class="fl">Priority</div><div class="fv">'+t.priority+'</div></div>'+
    '<div class="f"><div class="fl">Created</div><div class="fv">'+new Date(t.createdAt).toLocaleString()+'</div></div>'+
    '<div class="f"><div class="fl">Retries</div><div class="fv">'+t.retryCount+'/'+t.maxRetries+'</div></div>'+
    '<div class="f"><div class="fl">By</div><div class="fv">'+esc(t.createdBy)+'</div></div></div>'+
    (t.description?'<p>'+esc(t.description)+'</p>':'')+
    (t.result?'<div class="res">'+esc(JSON.stringify(t.result,null,2))+'</div>':'')+
    '<div class="act">'+
    (['pending','queued','running','paused'].includes(t.status)?'<button class="d" onclick="act(\\'cancel\\')">Cancel</button>':'')+
    (t.status==='failed'?'<button onclick="act(\\'retry\\')">Retry</button>':'')+
    (t.status==='pending'?'<button onclick="act(\\'enqueue\\')">Enqueue</button>':'')+
    '<button onclick="load()">Refresh</button></div>'+
    '<h3 style="margin-top:16px">Events ('+ev.length+')</h3>'+
    ev.map(e=>'<div class="ev"><span class="et">'+new Date(e.timestamp).toLocaleTimeString()+'</span>'+esc(e.payload.type)+(e.payload.content?' — '+esc(String(e.payload.content).slice(0,120)):'')+' </div>').join('');
}catch(e){document.getElementById('c').textContent='Error: '+e.message}}
load();setInterval(load,10000);
</script></body></html>`;
}
//# sourceMappingURL=task-detail.js.map
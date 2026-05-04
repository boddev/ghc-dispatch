import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export function showTaskDetail(client: DispatchClient, taskId: string) {
  if (typeof taskId !== 'string') {
    vscode.window.showErrorMessage('Cannot open task detail: invalid task id');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'dispatchTaskDetail',
    `Task: ${taskId.slice(-8)}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const load = async () => {
    const details = await client.get(`/api/tasks/${taskId}/details`);
    await panel.webview.postMessage({ command: 'data', details });
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.command === 'load') {
        await load();
        return;
      }
      if (msg.command === 'openFile' && msg.path) {
        await vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        return;
      }
      if (msg.command === 'edit') {
        await vscode.commands.executeCommand('dispatch.editTask', taskId);
        return;
      }
      if (msg.command === 'cancel') await client.post(`/api/tasks/${taskId}/cancel`);
      if (msg.command === 'retry') await client.post(`/api/tasks/${taskId}/retry`);
      if (msg.command === 'setCancellationReason') {
        await client.post(`/api/tasks/${taskId}/cancellation-reason`, { reason: msg.reason ?? '' });
        vscode.window.showInformationMessage('Cancellation reason saved.');
      }
      if (msg.command === 'delete') {
        const confirm = await vscode.window.showWarningMessage(
          'Permanently delete this task? This removes its Dispatch record, approvals, checkpoints, events, and captured artifacts.',
          { modal: true },
          'Delete',
        );
        if (confirm !== 'Delete') return;
        try {
          await client.del(`/api/tasks/${taskId}`);
        } catch (err: any) {
          const message = err?.message ?? String(err);
          if (!message.includes('subtask')) throw err;
          const recursiveConfirm = await vscode.window.showWarningMessage(
            `${message} Delete this task and all of its subtasks?`,
            { modal: true },
            'Delete All',
          );
          if (recursiveConfirm !== 'Delete All') return;
          await client.del(`/api/tasks/${taskId}?recursive=true`);
        }
        vscode.window.showInformationMessage(`Deleted task ${taskId}`);
        await vscode.commands.executeCommand('dispatch.refreshTasks');
        panel.dispose();
        return;
      }
      if (msg.command === 'enqueue') {
        const result: any = await client.post(`/api/tasks/${taskId}/enqueue`);
        if (result?.approvalRequired) {
          vscode.window.showWarningMessage(result.message ?? 'Approval required before execution.');
        }
      }
      if (msg.command === 'approve' && msg.approvalId) {
        await client.post(`/api/approvals/${msg.approvalId}/approve`, { decidedBy: 'vscode-user' });
      }
      if (msg.command === 'reject' && msg.approvalId) {
        await client.post(`/api/approvals/${msg.approvalId}/reject`, { decidedBy: 'vscode-user' });
      }
      await load();
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
      await panel.webview.postMessage({ command: 'error', message: err.message });
    }
  });

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:16px;margin:0}
  h1{font-size:18px;margin-bottom:4px}.meta{font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:16px}
  .f{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:8px;overflow:hidden}
  .fl{font-size:10px;text-transform:uppercase;opacity:.6;margin-bottom:2px}.fv{font-size:13px;font-weight:600;word-break:break-all}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500;color:#fff}
  .b-running{background:#f57c00}.b-completed{background:#2e7d32}.b-failed{background:#d32f2f}.b-pending{background:#616161}.b-queued{background:#1976d2}.b-cancelled{background:#757575}.b-paused{background:#7b1fa2}
  .ev,.row{font-size:12px;padding:5px 0;border-bottom:1px solid var(--vscode-input-border);font-family:var(--vscode-editor-font-family)}
  .et{color:var(--vscode-descriptionForeground);margin-right:8px}.act{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer}
  button:hover{background:var(--vscode-button-hoverBackground)}button.d{background:#d32f2f}
  .res{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:12px;margin-top:16px;white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;max-height:300px;overflow-y:auto}
  a{color:var(--vscode-textLink-foreground);cursor:pointer}
  .reasonRow{display:flex;gap:8px;margin-top:8px}
  .reasonRow input{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:3px;padding:6px 8px;font-family:var(--vscode-editor-font-family);font-size:12px}
</style></head><body>
<div id="c">Loading...</div>
<script>
const vsc=acquireVsCodeApi();
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function post(command, data={}){vsc.postMessage({command,...data})}
function saveReason(){const el=document.getElementById('cancelReason');if(el)post('setCancellationReason',{reason:el.value})}
function field(label,value){return '<div class="f"><div class="fl">'+esc(label)+'</div><div class="fv">'+esc(value||'—')+'</div></div>'}
function fileRow(path){return '<div class="row"><a onclick="post(\\'openFile\\',{path:'+JSON.stringify(path).replace(/"/g,'&quot;')+'})">'+esc(path)+'</a></div>'}
function render(details){
  const t=details.task, ev=details.events||[], approvals=details.approvals||[];
  const pendingApprovals=approvals.filter(a=>a.status==='pending');
  const cancelEvent=ev.slice().reverse().find(e=>e.payload?.type==='task.cancelled');
  const cancelReason = (t.metadata && typeof t.metadata.cancellationReason === 'string' && t.metadata.cancellationReason)
    || (cancelEvent && cancelEvent.payload && cancelEvent.payload.reason)
    || '';
  const cancelReasonBlock = t.status==='cancelled'
    ? '<h3>Cancellation reason</h3><div class="reasonRow"><input id="cancelReason" type="text" value="'+esc(cancelReason)+'" placeholder="Add a reason for cancelling this task" /><button onclick="saveReason()">Save reason</button></div>'
    : '';
  document.getElementById('c').innerHTML=
    '<h1>'+esc(t.title)+'</h1><div class="meta">'+esc(t.id)+'</div>'+
    '<div class="grid">'+
    field('Status','<span class="badge b-'+t.status+'">'+t.status+'</span>').replace(esc('<span class="badge b-'+t.status+'">'+t.status+'</span>'),'<span class="badge b-'+t.status+'">'+t.status+'</span>')+
    field('Agent',t.agent)+field('Team',t.metadata?.teamName || t.metadata?.teamId)+field('Priority',t.priority)+field('Created',new Date(t.createdAt).toLocaleString())+
    field('Retries',t.retryCount+'/'+t.maxRetries)+field('Created By',t.createdBy)+
    field('Working Directory',details.locations?.workingDirectory)+field('Directory Type',details.locations?.workingDirectorySource)+field('Repository',details.locations?.repository)+
    '</div>'+
    (t.description?'<p>'+esc(t.description)+'</p>':'')+
    '<div class="act">'+
    (t.status!=='running'?'<button onclick="post(\\'edit\\')">Edit Task</button>':'')+
    (['pending','queued','running','paused'].includes(t.status)?'<button class="d" onclick="post(\\'cancel\\')">Cancel</button>':'')+
    (t.status!=='running'?'<button class="d" onclick="post(\\'delete\\')">Delete Task</button>':'')+
    (['failed','cancelled','paused'].includes(t.status)?'<button onclick="post(\\'retry\\')">Retry</button>':'')+
    (t.status==='pending'?'<button onclick="post(\\'enqueue\\')">Request/Start Execution</button>':'')+
    '<button onclick="post(\\'load\\')">Refresh</button></div>'+
    cancelReasonBlock+
    (t.result?'<h3>Result</h3><div class="res">'+esc(JSON.stringify(t.result,null,2))+'</div>':'')+
    '<h3>Plan files</h3>'+(details.planPaths?.length?details.planPaths.map(fileRow).join(''):'<div class="row">No plan.md found in the task worktree or artifacts.</div>')+
    '<h3>Markdown documents</h3>'+(details.markdownPaths?.length?details.markdownPaths.map(fileRow).join(''):'<div class="row">No markdown documents found in the task worktree or artifacts.</div>')+
    '<h3>Artifacts</h3>'+(details.artifactPaths?.length?details.artifactPaths.map(fileRow).join(''):'<div class="row">No captured artifacts yet.</div>')+
    '<h3>Approvals</h3>'+(approvals.length?approvals.map(a=>'<div class="row"><b>'+esc(a.status)+'</b> '+esc(a.description)+' '+(a.status==='pending'?'<button onclick="post(\\'approve\\',{approvalId:\\''+a.id+'\\'})">Approve</button> <button class="d" onclick="post(\\'reject\\',{approvalId:\\''+a.id+'\\'})">Reject</button>':'')+'</div>').join(''):'<div class="row">No approvals.</div>')+
    (details.latestCheckpoint?'<h3>Latest checkpoint</h3><div class="res">'+esc(JSON.stringify(details.latestCheckpoint,null,2))+'</div>':'')+
    '<h3>Events ('+ev.length+')</h3>'+
    ev.map(e=>'<div class="ev"><span class="et">'+new Date(e.timestamp).toLocaleTimeString()+'</span>'+esc(e.payload.type)+(e.payload.content?' — '+esc(String(e.payload.content).slice(0,120)):'')+'</div>').join('');
}
window.addEventListener('message', event => {
  if(event.data.command==='data') render(event.data.details);
  if(event.data.command==='error') document.getElementById('c').textContent='Error: '+event.data.message;
});
post('load');
</script></body></html>`;
}
